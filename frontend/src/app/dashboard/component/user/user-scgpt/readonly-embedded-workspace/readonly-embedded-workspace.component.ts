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

import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {
  AfterViewInit,
  Component,
  HostListener,
  Input, OnChanges,
  OnDestroy,
  OnInit, SimpleChanges,
  ViewChild,
  ViewContainerRef
} from "@angular/core";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowCompilingService} from "../../../../../workspace/service/compile-workflow/workflow-compiling.service";
import {WorkflowConsoleService} from "../../../../../workspace/service/workflow-console/workflow-console.service";
import {
  OperatorReuseCacheStatusService
} from "../../../../../workspace/service/workflow-status/operator-reuse-cache-status.service";
import {UndoRedoService} from "../../../../../workspace/service/undo-redo/undo-redo.service";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {OperatorMetadataService} from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import {NzMessageService} from "ng-zorro-antd/message";
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {CodeEditorService} from "../../../../../workspace/service/code-editor/code-editor.service";
import {Workflow} from "../../../../../common/type/workflow";
import {checkIfWorkflowBroken} from "../../../../../common/util/workflow-check";
import {isDefined} from "../../../../../common/util/predicate";

export const SAVE_DEBOUNCE_TIME_IN_MS = 5000;

@UntilDestroy()
@Component({
  selector: "texera-readonly-embedded-workspace",
  templateUrl: "./readonly-embedded-workspace.component.html",
  styleUrls: ["./readonly-embedded-workspace.component.scss"],
  providers: [
    // uncomment this line for manual testing without opening backend server
    // { provide: OperatorMetadataService, useClass: StubOperatorMetadataService },
  ],
})
export class ReadonlyEmbeddedWorkspaceComponent implements AfterViewInit, OnInit, OnChanges, OnDestroy {
  @Input() wid!: number;
  public writeAccess: boolean = false;
  public isLoading: boolean = false;
  @ViewChild("codeEditor", { read: ViewContainerRef }) codeEditorViewRef!: ViewContainerRef;

  constructor(
    private userService: UserService,
    // list additional 3 services in constructor so they are initialized even if no one use them directly
    // TODO: make their lifecycle better
    private workflowCompilingService: WorkflowCompilingService,
    private workflowConsoleService: WorkflowConsoleService,
    private operatorReuseCacheStatusService: OperatorReuseCacheStatusService,
    // end of additional services
    private undoRedoService: UndoRedoService,
    private workflowPersistService: WorkflowPersistService,
    private workflowActionService: WorkflowActionService,
    private operatorMetadataService: OperatorMetadataService,
    private message: NzMessageService,
    private notificationService: NotificationService,
    private codeEditorService: CodeEditorService,
  ) {}

  ngOnInit() {
    /** Highlight operators on hover */
    this.workflowActionService.setHighlightingEnabled(true);
  }

  ngAfterViewInit(): void {
    // clear the current workspace, reset as `WorkflowActionService.DEFAULT_WORKFLOW`
    this.workflowActionService.resetAsNewWorkflow();
    // if a workflow id is present, display loading spinner immediately while loading
    if (this.wid) {
      this.isLoading = true;
    }
    this.registerLoadOperatorMetadata();
    this.codeEditorService.vc = this.codeEditorViewRef;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["wid"] && isDefined(this.wid)) {
      this.loadWorkflowWithId();
    }
  }

  @HostListener("window:beforeunload")
  ngOnDestroy() {
    if (this.userService.isLogin() && this.workflowPersistService.isWorkflowPersistEnabled()) {
      const workflow = this.workflowActionService.getWorkflow();
      this.workflowPersistService.persistWorkflow(workflow).pipe(untilDestroyed(this)).subscribe();
    }

    this.codeEditorViewRef.clear();
    this.workflowActionService.clearWorkflow();
  }

  loadWorkflowWithId(): void {
    if (!this.wid) {
      return;
    }

    // disable the workspace until the workflow is fetched from the backend
    this.isLoading = true;
    this.workflowActionService.disableWorkflowModification();
    this.workflowPersistService
      .retrieveWorkflow(this.wid)
      .pipe(untilDestroyed(this))
      .subscribe(
        (workflow: Workflow) => {
          if (checkIfWorkflowBroken(workflow)) {
            this.notificationService.error(
              "Sorry! The workflow is broken and cannot be persisted. Please contact the system admin."
            );
            this.isLoading = false;
            return;
          }

          this.workflowActionService.setNewSharedModel(this.wid, this.userService.getCurrentUser());

          // load the fetched workflow
          this.workflowActionService.reloadWorkflow(workflow);

          // clear stack
          this.undoRedoService.clearUndoStack();
          this.undoRedoService.clearRedoStack();
          this.isLoading = false;
          this.triggerCenter();
        },
        () => {
          this.workflowActionService.resetAsNewWorkflow();
          // clear stack
          this.undoRedoService.clearUndoStack();
          this.undoRedoService.clearRedoStack();
          this.isLoading = false;
          this.message.error("You don't have access to this workflow, please log in with an appropriate account");
        }
      );
  }

  registerLoadOperatorMetadata() {
    this.operatorMetadataService
      .getOperatorMetadata()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        if (isDefined(this.wid)) {
          // show loading spinner right away while waiting for workflow to load
          this.isLoading = true;
          // temporarily disable modification to prevent editing an empty workflow before real data is loaded
          this.workflowActionService.disableWorkflowModification();
          // load the wid from the backend once the user info is ready
          this.userService
            .userChanged()
            .pipe(untilDestroyed(this))
            .subscribe(() => {
              this.loadWorkflowWithId();
            });
        }
      });
  }

  public triggerCenter(): void {
    /** Center the workflow graph in the viewport */
    this.workflowActionService.getTexeraGraph().triggerCenterEvent();
  }
}
