/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { FormlyFieldConfig } from "@ngx-formly/core";
import { FormGroup, FormControl } from "@angular/forms";
import { Component, OnInit } from "@angular/core";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {NzModalService} from "ng-zorro-antd/modal";
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {ExecuteWorkflowService} from "../../../../../workspace/service/execute-workflow/execute-workflow.service";
import {Workflow, WorkflowContent} from "../../../../../common/type/workflow";
import {OperatorMetadataService} from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import {ResultExportationComponent} from "../../../../../workspace/component/result-exportation/result-exportation.component";
import {ComputingUnitStatusService} from "../../../../../workspace/service/computing-unit-status/computing-unit-status.service";
import {DashboardWorkflowComputingUnit} from "../../../../../workspace/types/workflow-computing-unit";
import {extractErrorMessage} from "../../../../../common/util/error";
import {WorkflowComputingUnitManagingService} from "../../../../../workspace/service/workflow-computing-unit/workflow-computing-unit-managing.service";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {WorkflowResultDownloadabilityResponse} from "../../../../service/user/download/download.service";
import {HttpClient} from "@angular/common/http";
import {TOKEN_KEY} from "../../../../../common/service/user/auth.service";
import {ShareAccessService} from "../../../../service/user/share-access/share-access.service";
import {isEqual} from "lodash-es";
import {map, Observable, of, tap} from "rxjs";
import {cloneDeep} from "lodash";
import {WorkflowTemplate} from "../../../../type/workflow-template";
import {switchMap} from "rxjs/operators";

@UntilDestroy()
@Component({
  templateUrl: "./scgpt-job-creation.component.html",
  styleUrls: ["./scgpt-job-creation.component.scss"]
})
export class ScGPTJobCreationComponent implements OnInit {
  public jid: number | undefined;
  public wid: number | undefined;
  public tid: number | undefined;
  public template: WorkflowContent | undefined;
  public operatorIndexToId: string[] = [];
  public operatorIndexToForm: Record<string, any>[] = [];
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;
  public workflowInitialized: boolean = false;
  public populated: boolean = false;

  public configurableProperties: Set<string> = new Set(["fileName", "fileEncoding"])

  workflow: Workflow | undefined;
  model = {
    template: null,
    filePath: null,
  };
  form = new FormGroup({
    template: new FormControl(this.model.template),
    filePath: new FormControl(this.model.filePath),
  });
  fields: FormlyFieldConfig[] = [
    {
      key: "template",
      type: "workflowtemplateselection",
      props: {
        label: "Template",
        description: "Template to generate workflow from.",
        required: true,
      },
      hooks: {
        onInit: field => {
          field.formControl!.valueChanges
            .pipe(untilDestroyed(this))
            .subscribe(tid => {
              if (tid == null) {
                return;
              }
              this.tid = tid;
              this.onWorkflowTemplateSelected(tid);
            });
        },
      },
    },
    {
      key: "filePath",
      type: "inputautocomplete",
      props: {
        label: "Dataset File",
        description: "File containing data to plot.",
        required: true,
      },
      expressions: {
        hide: field => field.model?.template === null
      }
    },
  ];

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private executeWorkflowService: ExecuteWorkflowService,
    private operatorMetadataService: OperatorMetadataService,
    private computingUnitStatusService: ComputingUnitStatusService,
    private computingUnitService: WorkflowComputingUnitManagingService,
    private workflowPersistService: WorkflowPersistService,
    private http: HttpClient
  ) {
    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.currentUid = this.userService.getCurrentUser()?.uid;
        this.isLogin = this.userService.isLogin();
      });
  }

  onWorkflowTemplateSelected(tid: number): void {
    this.getWorkflowTemplateContent(tid)
      .pipe(untilDestroyed(this))
      .subscribe(
        (response) => {
          this.template = response;
          this.operatorIndexToId = response.operators.map(op => op.operatorID);
          this.operatorIndexToForm = response.operators.map(op => cloneDeep(op.operatorProperties))
          // create formly fields based on workflow template operator parameters (operator, parameter name, field type, props)
        }
      )
  }

  onJobFormValidated(): void {
    if (!this.form.valid) {
      this.notificationService.error("Invalid form.")
      return;
    }

    if (!this.workflowInitialized) {
      this.createTemplatedWorkflow().pipe(
        switchMap((wid) => {
          this.wid = wid;
          return this.setWorkflowAccess(wid, "READ");
        }),
        tap(() => {
          this.workflowInitialized = true;
        }),
        untilDestroyed(this)
      ).subscribe();

    } else {
      this.updateOperator().pipe(untilDestroyed(this)).subscribe();
    }
  }

  private createTemplatedWorkflow(): Observable<number> {
    const parameters = {
      "CSVFileScan-operator": {
        "fileName": this.model.filePath
      }
    };
    return this.http.post<number>(`${AppSettings.getApiEndpoint()}/templated-workflow/build?tid=${this.tid}`, {
      parameters: parameters
    })
  }

  // move to workflow-template.service.ts
  private getWorkflowTemplateContent(templateId: number): Observable<WorkflowContent> {
    return this.http.get<WorkflowTemplate>(
      `${AppSettings.getApiEndpoint()}/workflow-template/${templateId}`
    ).pipe(
      map(template => JSON.parse(template.content))
    );
  }

  // move to workflow-access.service.ts
  private setWorkflowAccess(wid: number, accessType: string): Observable<void> {
    return this.http.put<void>(`${AppSettings.getApiEndpoint()}/access/workflow/update-self/${wid}/${accessType}`, null)
  }

  private updateOperator(): Observable<Workflow> {
    this.updateOperatorForms();
    if (this.workflowChanged()) {
      this.updateOperatorProperties();
      const workflow = this.workflowActionService.getWorkflow();
      return this.workflowPersistService.persistWorkflow(workflow).pipe(
        tap(() => {
          this.populated = true;
          this.notificationService.success("Workflow updated.");
        })
      );
    } else {
      this.notificationService.info("No changes made to the workflow.")
      return of(this.workflowActionService.getWorkflow());
    }
  }

  private updateOperatorForms(): void {
    this.operatorIndexToForm[0]["fileName"] = this.model.filePath;
  }

  private updateOperatorProperties(): void {
    this.workflowActionService.setOperatorProperty(this.operatorIndexToId[0], this.operatorIndexToForm[0])
  }

  private workflowChanged(): boolean {
    const operator = this.workflowActionService.getTexeraGraph().getOperator(this.operatorIndexToId[0]);
    return !isEqual(this.operatorIndexToForm[0], operator.operatorProperties);
  }

  ngOnInit(): void {
    this.wid = undefined;
    return;
  }
}
