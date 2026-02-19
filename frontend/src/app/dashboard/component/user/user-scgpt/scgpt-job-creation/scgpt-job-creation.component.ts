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
import {AfterViewInit, Component, OnInit} from "@angular/core";
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
import {WorkflowTemplate} from "../../../../../common/type/workflow-template";
import {switchMap} from "rxjs/operators";
import {ActivatedRoute} from "@angular/router";

@UntilDestroy()
@Component({
  templateUrl: "./scgpt-job-creation.component.html",
  styleUrls: ["./scgpt-job-creation.component.scss"]
})
export class ScGPTJobCreationComponent implements AfterViewInit, OnInit {
  public tid: number | undefined;
  public wid: number | undefined;
  public template: WorkflowContent | undefined;
  public operatorIndexToId: string[] = [];
  public operatorIndexToForm: Record<string, any>[] = [];
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;
  public workflowInitialized: boolean = false;
  public configurableProperties: string | undefined;

  workflow: Workflow | undefined;
  model = {
    filePath: null,
    nHVG: null,
  };
  form = new FormGroup({
    filePath: new FormControl(this.model.filePath),
    nHVG: new FormControl(this.model.nHVG),
  });
  fields: FormlyFieldConfig[] = [
    {
      key: "filePath",
      type: "inputautocomplete",
      props: {
        label: "Dataset File (.h5ad)",
        // description: "File containing data to plot.",
        required: true,
      },
    },
    {
      key: "nHVG",
      type: "input",
      props: {
        type: "number",
        label: "Number of Highly Variable Genes",
        required: true,
        min: 1,
        step: 1
      },
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
    private route: ActivatedRoute,
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
      // this.updateOperator().pipe(untilDestroyed(this)).subscribe();
    }
  }

  private createTemplatedWorkflow(): Observable<number> {
    // const parameters = {
    //   "CSVFileScan-operator": {
    //     "fileName": this.model.filePath
    //   },
    //   "Limit-operator": {
    //     "limit": this.model.nHVG
    //   }
    // };
    const parameters = {
      "TextInput-operator-4e1b277d-75a9-4299-af22-8b76fcb633da": {
        "textInput": `file_path=${this.model.filePath}\nn_hvg=${this.model.nHVG}`
      }
    }
    return this.http.post<number>(`${AppSettings.getApiEndpoint()}/templated-workflow/build?tid=${this.tid}`, {
      parameters: parameters
    })
  }

  // move to workflow-template.service.ts
  private getWorkflowTemplateContent(): Observable<WorkflowContent> {
    return this.http.get<WorkflowTemplate>(
      `${AppSettings.getApiEndpoint()}/workflow-template/${this.tid}`
    ).pipe(
      map(template => JSON.parse(template.content))
    );
  }

  // move to workflow-access.service.ts
  private setWorkflowAccess(wid: number, accessType: string): Observable<void> {
    const userEmail = this.userService.getCurrentUser()?.email
    return this.http.put<void>(`${AppSettings.getApiEndpoint()}/access/workflow/grant/${wid}/${userEmail}/${accessType}`, null)
  }

  private updateOperator(): Observable<Workflow> {
    this.updateOperatorForms();
    if (this.workflowChanged()) {
      this.updateOperatorProperties();
      const workflow = this.workflowActionService.getWorkflow();
      return this.workflowPersistService.persistWorkflow(workflow).pipe(
        tap(() => {
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
    this.operatorIndexToForm[1]["limit"] = this.model.nHVG;
  }

  private updateOperatorProperties(): void {
    this.workflowActionService.setOperatorProperty(this.operatorIndexToId[0], this.operatorIndexToForm[0])
    this.workflowActionService.setOperatorProperty(this.operatorIndexToId[1], this.operatorIndexToForm[1])
  }

  private workflowChanged(): boolean {
    const operator0 = this.workflowActionService.getTexeraGraph().getOperator(this.operatorIndexToId[0]);
    const operator1 = this.workflowActionService.getTexeraGraph().getOperator(this.operatorIndexToId[1]);
    return !isEqual(this.operatorIndexToForm[0], operator0.operatorProperties) || !isEqual(this.operatorIndexToForm[1], operator1.operatorProperties);
  }

  ngOnInit(): void {
    this.wid = undefined;
    return;
  }

  ngAfterViewInit(): void {
    this.tid = this.route.snapshot.params.tid;
    this.getWorkflowTemplateContent()
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
}
