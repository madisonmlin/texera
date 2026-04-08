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
import {Workflow, WorkflowContent} from "../../../../../common/type/workflow";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {HttpClient} from "@angular/common/http";
import {isEqual} from "lodash-es";
import {Observable, of, tap} from "rxjs";
import {cloneDeep} from "lodash";
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
  public operatorIdToProperties: Record<string, any> = {};
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;
  public configurableProperties: string | undefined;
  private readonly PARAMETER_OP_ID: string = "FileParameter-operator-affac615-2387-4495-a51f-b7d9a5957f1d"

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
      this.updateOperator().pipe(untilDestroyed(this)).subscribe();
    }
  }

  private createTemplatedWorkflow(): Observable<number> {
    const parameters = {
      [this.PARAMETER_OP_ID]: {
        "filePairs": [
          {
            "fileKey": "file_path",
            "fileName": this.model.filePath
          }
        ],
        "pairs": [
          {
            "key": "n_hvg",
            "value": String(this.model.nHVG)
          }
        ]
      }
    }

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
    this.operatorIdToProperties[this.PARAMETER_OP_ID]["filePairs"][0]["fileName"] = this.model.filePath;
    this.operatorIdToProperties[this.PARAMETER_OP_ID]["pairs"][0]["value"] = String(this.model.nHVG);
  }

  private updateOperatorProperties(): void {
    this.workflowActionService.setOperatorProperty(this.PARAMETER_OP_ID, this.operatorIdToProperties[this.PARAMETER_OP_ID]);
  }

  private workflowChanged(): boolean {
    const operator = this.workflowActionService.getTexeraGraph().getOperator(this.PARAMETER_OP_ID);
    return !isEqual(this.operatorIdToProperties[this.PARAMETER_OP_ID], operator.operatorProperties);
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
            this.operatorIdToProperties = {};
            template.content.operators.forEach(op => {
              this.operatorIdToProperties[op.operatorID] = cloneDeep(op.operatorProperties);
            });
            // create formly fields based on template operator parameters (operator, parameter name, field type, props)
          }
        )
    }
  }
}
