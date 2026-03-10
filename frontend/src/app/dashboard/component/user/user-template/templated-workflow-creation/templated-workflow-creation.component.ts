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
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {ExecuteWorkflowService} from "../../../../../workspace/service/execute-workflow/execute-workflow.service";
import {Workflow, WorkflowContent} from "../../../../../common/type/workflow";
import {OperatorMetadataService} from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import {ComputingUnitStatusService} from "../../../../../workspace/service/computing-unit-status/computing-unit-status.service";
import {WorkflowComputingUnitManagingService} from "../../../../../workspace/service/workflow-computing-unit/workflow-computing-unit-managing.service";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {HttpClient} from "@angular/common/http";
import {isEqual} from "lodash-es";
import {map, Observable, of, tap} from "rxjs";
import {cloneDeep} from "lodash";
import {Template} from "../../../../../common/type/template";
import {switchMap} from "rxjs/operators";
import {ActivatedRoute} from "@angular/router";
import {TemplateService} from "../../../../service/user/template/template.service";

@UntilDestroy()
@Component({
  templateUrl: "./templated-workflow-creation.component.html",
  styleUrls: ["./templated-workflow-creation.component.scss"]
})
export class TemplatedWorkflowCreationComponent implements AfterViewInit, OnInit {
  public tid: number | undefined;
  public wid: number | undefined;
  public template: WorkflowContent | undefined;
  public operatorIndexToId: string[] = [];
  public operatorIndexToForm: Record<string, any>[] = [];
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;
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
    private templateService: TemplateService,
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

    if (!this.wid) {
      this.createTemplatedWorkflow().pipe(untilDestroyed(this)).subscribe((wid) => {
        this.wid = wid;
      });

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

    // const parameters = {
    //   "FileParameter-operator": {
    //     "filePairs": [
    //       {
    //         "fileKey": "file_path",
    //         "fileName": this.model.filePath,
    //       }
    //     ],
    //     "pairs": [
    //       {
    //         "key": "n_hvg",
    //         "value": this.model.nHVG,
    //       }
    //     ]
    //   }
    // }

    const parameters = {}
    return this.http.post<number>(`${AppSettings.getApiEndpoint()}/templated-workflow/build?tid=${this.tid}`, {
      parameters: parameters
    })
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
    return;
  }

  ngAfterViewInit(): void {
    this.tid = this.route.snapshot.params.tid;
    if (this.tid) {
      this.templateService.retrieveTemplate(this.tid)
        .pipe(untilDestroyed(this))
        .subscribe(
          (template) => {
            this.operatorIndexToId = template.content.operators.map(op => op.operatorID);
            this.operatorIndexToForm = template.content.operators.map(op => cloneDeep(op.operatorProperties))
            // create formly fields based on template operator parameters (operator, parameter name, field type, props)
          }
        )
    }
  }
}
