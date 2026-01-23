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
import {Workflow} from "../../../../../common/type/workflow";
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

@UntilDestroy()
@Component({
  templateUrl: "./scgpt-job-creation.component.html",
  styleUrls: ["./scgpt-job-creation.component.scss"]
})
export class ScGPTJobCreationComponent implements OnInit {
  public jid: number | undefined;
  public wid: number | undefined;
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;

  SCATTER_WORKFLOW_TEMPLATE = require("../../../../../../assets/workflow_templates/scatter-plot-workflow.json");
  FINAL_OPERATOR_ID = "CSVFileScan-operator";
  showDownloadButton = false;

  workflow: Workflow | undefined;
  model = {
    template: null,
    filePath: null,
    // xAxis: "",
    // yAxis: "",
    // alpha: 1,
  };
  form = new FormGroup({
    // Initialize the FormControl for the path
    template: new FormControl(this.model.template),
    filePath: new FormControl(this.model.filePath),
    // xAxis: new FormControl(this.model.xAxis),
    // yAxis: new FormControl(this.model.yAxis),
    // alpha: new FormControl(this.model.alpha),
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
    // {
    //   key: "xAxis",
    //   type: "string",
    //   props: {
    //     label: "X-Column",
    //     description: "Column in the input dataset used as X-axis in plot.",
    //     required: true,
    //   },
    // },
    // {
    //   key: "yAxis",
    //   type: "string",
    //   props: {
    //     label: "Y-Column",
    //     description: "Column in the input dataset used as Y-axis in plot.",
    //     required: true,
    //   },
    // },
    // {
    //   key: "alpha",
    //   type: "number",
    //   props: {
    //     label: "Alpha Value",
    //     description: "",
    //     required: true,
    //   }
    // }
  ];

  constructor(
    private modalService: NzModalService,
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private executeWorkflowService: ExecuteWorkflowService,
    private operatorMetadataService: OperatorMetadataService,
    private computingUnitStatusService: ComputingUnitStatusService,
    private computingUnitService: WorkflowComputingUnitManagingService,
    private workflowPersistService: WorkflowPersistService,
    private accessService: ShareAccessService,
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

  /*
    Insert user-inputted parameters into the template workflow, assign it a computing unit, and execute the workflow
   */
  private buildTemplateWorkflow(): void {
    const urlPath = "http://127.0.0.1:8019/build-scgpt";
    const token = localStorage.getItem(TOKEN_KEY) ?? "";
    const requestBody = {
      tid: this.model.template,
      filepath: this.model.filePath,
      token: token
    }
    this.http.post<any>(urlPath, requestBody)
      .pipe(untilDestroyed(this))
      .subscribe(
        (response) => {
          // this.accessService.grantAccess()this.userService.getCurrentUser()?.email
          this.wid = response.wid;
        }
      );
      // .subscribe(
      //   (response) => {
      //     console.log(response);
      //     if (response.status == "success") {
      //       this.showDownloadButton = true
      //     } else {
      //       this.notificationService.error("Workflow failed.")
      //       this.showDownloadButton = false
      //     }
      //     this.wid = response.wid
      //   }
      // );

    // this.updateAllOperatorParameters();
    // this.setComputingUnit();
  }

 //  private setComputingUnit(): void {
 //    const computingUnitName = "scGPT Computing Unit"
 //    const localComputingUnitUri = `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port}` : ""}/wsapi`;
 //    this.computingUnitService
 //      .createLocalComputingUnit(computingUnitName, localComputingUnitUri)
 //      .pipe(untilDestroyed(this))
 //      .subscribe({
 //        next: (unit: DashboardWorkflowComputingUnit) => {
 //          this.notificationService.success("Successfully created the new local compute unit");
 //
 //          // Select the newly created unit
 //          if (this.workflow) {
 //            this.computingUnitStatusService.selectComputingUnit(this.workflow.wid, unit.computingUnit.cuid);
 //            console.log("attached CU to workflow");
 //            this.executeWorkflowService.executeWorkflow(`scGPT-${this.jid}`);
 //            console.log("started workflow execution");
 //          } else {
 //            this.notificationService.error("No template workflow to associate computing unit to");
 //          }
 //        },
 //        error: (err: unknown) =>
 //          this.notificationService.error(`Failed to start local computing unit: ${extractErrorMessage(err)}`),
 //      });
 //  }
 //
 //  private updateAllOperatorParameters(): void {
 //    const parameters = {
 //      "CSVFileScan-operator": {
 //        "fileName": this.model.filePath
 //      },
 //      "Scatterplot-operator": {
 //        "alpha": this.model.alpha,
 //        "xColumn": this.model.xAxis,
 //        "yColumn": this.model.yAxis
 //      }
 //    }
 //    for (const [key, value] of Object.entries(parameters)) {
 //      this.updateSingleOperatorParameters(key, value);
 //    }
 //  }
 //
 //  // consider changing input to list of operators
 //  private updateSingleOperatorParameters(operatorId: string, params: Object): void {
 //    const workflow = this.workflowActionService.getTexeraGraph();
 //    const operator = workflow.getAllOperators().find(op => op.operatorID === operatorId);
 //    if (!operator) {
 //      console.error(`Operator with ID ${operatorId} not found`);
 //      return;
 //    }
 //
 //    const newProperty = { ...operator.operatorProperties };
 //    for (const [key, value] of Object.entries(params)) {
 //      newProperty[key] = value;
 //    }
 //    this.workflowActionService.setOperatorProperty(operatorId, newProperty);
 //  }

  /*
  Perform validation on the user-inputted parameters
 */
  validateScGPTJobForm(): void {
    // Perform validation here
    if (this.form.valid) {
      this.buildTemplateWorkflow();
    }
  }

  /*
    Event handler to fetch workflow result after completion
   */
  onClickDownloadFinalResult(): void {
    if (!this.wid) {
      this.notificationService.error("No workflow available.");
    }
    this.http.get<Workflow>(`/${AppSettings.getApiEndpoint()}/workflow/${this.wid}`)
      .pipe(untilDestroyed(this))
      .subscribe(response => {
        const workflow = {
          ...response,
          content: JSON.parse((response as any).content)
        };
        this.workflowActionService.reloadWorkflow(workflow);
        this.workflowActionService.getJointGraphWrapper()?.highlightOperators(this.FINAL_OPERATOR_ID);
        this.modalService.create({
          nzTitle: "Download Workflow Result",
          nzContent: ResultExportationComponent,
          nzData: {
            workflowName: this.workflowActionService.getWorkflowMetadata()?.name,
            sourceTriggered: "scgpt",
          },
          nzFooter: null,
          nzWidth: 600
        });
    });
  }

  ngOnInit(): void {
    // // create the template workflow in the backend
    // this.workflowPersistService.createWorkflow(this.SCATTER_WORKFLOW_TEMPLATE)
    //   .pipe(untilDestroyed(this))
    //   .subscribe((dashboardWorkflow) => {
    //     let workflow = dashboardWorkflow.workflow;
    //
    //     console.log(workflow);
    //
    //     if (!workflow.wid) {
    //       console.log("missing wid");
    //       workflow.wid = 1;
    //     }
    //
    //     // retrieve the workflow from backend
    //     this.workflowPersistService.retrieveWorkflow(workflow.wid)
    //       .pipe(untilDestroyed(this))
    //       .subscribe(
    //         (retrievedWorkflow: Workflow) => {
    //           // convert nested JSON strings to objects
    //
    //           this.workflow = retrievedWorkflow;
    //
    //           // load into frontend graph
    //           this.operatorMetadataService.getOperatorMetadata()
    //             .pipe(untilDestroyed(this))
    //             .subscribe(() => {
    //               this.workflowActionService.resetAsNewWorkflow();
    //               this.workflowActionService.setNewSharedModel(this.workflow?.wid, this.userService.getCurrentUser());
    //               this.workflowActionService.reloadWorkflow(this.workflow);
    //               this.workflowActionService.enableWorkflowModification();
    //               this.workflowReady = true;
    //
    //               console.log(this.workflow?.content);
    //               console.log("setup template workflow");
    //             });
    //         },
    //         (err) => {
    //           console.error("Failed to retrieve workflow:", err);
    //           this.notificationService.error("Failed to load workflow from backend.");
    //         }
    //       );
    //   });
    //
    // // attach event listener that listens for workflow execution completion and attaches workflow results
    // const resultDownloadLink = document.querySelector(".result-download-link");
    // if (resultDownloadLink)
    //   resultDownloadLink.addEventListener("click", this.onClickDownloadFinalResult);

    return;
  }
}
