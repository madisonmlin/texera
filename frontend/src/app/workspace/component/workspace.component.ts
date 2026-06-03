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

import { Location, NgIf } from "@angular/common";
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  ViewContainerRef,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { UserService } from "../../common/service/user/user.service";
import { WorkflowPersistService } from "../../common/service/workflow-persist/workflow-persist.service";
import { Workflow } from "../../common/type/workflow";
import { OperatorMetadataService } from "../service/operator-metadata/operator-metadata.service";
import { UndoRedoService } from "../service/undo-redo/undo-redo.service";
import { WorkflowActionService } from "../service/workflow-graph/model/workflow-action.service";
import { NzMessageService } from "ng-zorro-antd/message";
import { debounceTime, distinctUntilChanged, filter, switchMap, throttleTime } from "rxjs/operators";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { combineLatest, map, Observable, forkJoin, of } from "rxjs";
import { isDefined } from "../../common/util/predicate";
import { NotificationService } from "src/app/common/service/notification/notification.service";
import { WorkflowConsoleService } from "../service/workflow-console/workflow-console.service";
import { OperatorReuseCacheStatusService } from "../service/workflow-status/operator-reuse-cache-status.service";
import { CodeEditorService } from "../service/code-editor/code-editor.service";
import { WorkflowMetadata } from "src/app/dashboard/type/workflow-metadata.interface";
import { EntityType, HubService } from "../../hub/service/hub.service";
import { THROTTLE_TIME_MS } from "../../hub/component/workflow/detail/hub-workflow-detail.component";
import { WorkflowCompilingService } from "../service/compile-workflow/workflow-compiling.service";
import { USER_TEMPLATE, USER_WORKSPACE } from "../../app-routing.constant";
import { GuiConfigService } from "../../common/service/gui-config.service";
import { NzSpinComponent } from "ng-zorro-antd/spin";
import { ResultPanelComponent } from "./result-panel/result-panel.component";
import { WorkflowEditorComponent } from "./workflow-editor/workflow-editor.component";
import { MenuComponent } from "./menu/menu.component";
import { MiniMapComponent } from "./workflow-editor/mini-map/mini-map.component";
import { LeftPanelComponent } from "./left-panel/left-panel.component";
import { AgentPanelComponent } from "./agent/agent-panel/agent-panel.component";
import { PropertyEditorComponent } from "./property-editor/property-editor.component";
import { FormlyRepeatDndComponent } from "../../common/formly/repeat-dnd/repeat-dnd.component";
import {TemplateService} from "../../dashboard/service/user/template/template.service";
import {Template} from "../../common/type/template";
import {checkIfGraphBroken} from "../../common/util/graph-check";

export const SAVE_DEBOUNCE_TIME_IN_MS = 5000;

type WorkspaceMode = "workflow" | "template";

interface WorkspaceContext {
  mode: WorkspaceMode;
  id: number;
  pid?: number;
}

@UntilDestroy()
@Component({
  selector: "texera-workspace",
  templateUrl: "./workspace.component.html",
  styleUrls: ["./workspace.component.scss"],
  providers: [
    // uncomment this line for manual testing without opening backend server
    // { provide: OperatorMetadataService, useClass: StubOperatorMetadataService },
  ],
  imports: [
    NzSpinComponent,
    ResultPanelComponent,
    WorkflowEditorComponent,
    MenuComponent,
    MiniMapComponent,
    LeftPanelComponent,
    NgIf,
    AgentPanelComponent,
    PropertyEditorComponent,
    FormlyRepeatDndComponent,
  ],
})
export class WorkspaceComponent implements OnInit, AfterViewInit, OnDestroy {
  public pid?: number = undefined;
  public writeAccess: boolean = false;
  public isLoading: boolean = false;
  @Input() tid?: number = undefined;
  @Input() wid?: number = undefined;
  @Input() mode?: "workflow" | "template";
  @Input() isEmbedded: boolean = false;
  @Output() workspaceReady = new EventEmitter<number | undefined>();
  @ViewChild("codeEditor", { read: ViewContainerRef }) codeEditorViewRef!: ViewContainerRef;

  /**
   * Optional agent ID to activate when the workspace loads.
   * When provided (from agent dashboard), the agent panel will open
   * and connect to this agent automatically.
   */
  @Input() agentIdToActivate?: string;

  context$ = combineLatest([
    this.route.paramMap,
    this.route.queryParamMap,
  ]).pipe(
    map(([params, queryParams]) => ({
      mode: params.get("mode") as WorkspaceMode,
      id: Number(params.get("id")),
      pid: queryParams.get("pid")
        ? Number(queryParams.get("pid"))
        : undefined,
    })),
  );

  /**
   * Flag to ensure auto persist is registered only once.  This prevents multiple
   * subscriptions and avoids accidental persistence of an empty workflow
   * before the actual workflow is loaded from backend.
   */
  private autoPersistRegistered = false;

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
    private templateService: TemplateService,
    private location: Location,
    private route: ActivatedRoute,
    private operatorMetadataService: OperatorMetadataService,
    private message: NzMessageService,
    private router: Router,
    private notificationService: NotificationService,
    private hubService: HubService,
    private codeEditorService: CodeEditorService,
    private config: GuiConfigService,
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  private reloadWorkspace(context: WorkspaceContext): void {
    this.cleanupWorkspaceState();
    this.initWorkspaceState(context);
  }

  private cleanupWorkspaceState(): void {
    this.isLoading = false;
    this.autoPersistRegistered = false;

    this.codeEditorViewRef?.clear();

    this.undoRedoService.clearUndoStack();
    this.undoRedoService.clearRedoStack();

    this.workflowActionService.clearWorkflow();
    this.workflowActionService.disableWorkflowModification();
  }

  private initWorkspaceState(context: WorkspaceContext): void {
    /**
     * On initialization of the workspace, there are two possibilities regarding which component has
     * routed to this component:
     *
     * 1. Routed to this component from within UserProjectSection component
     *    - track the pid identifying that project
     *    - upon persisting of a workflow, must also ensure it is also added to the project
     *
     * 2. Routed to this component from SavedWorkflowSection component
     *    - there is no related project, parseInt will return NaN.
     *    - NaN || undefined will result in undefined.
     */
    this.mode = context.mode;
    this.wid = context.mode === "workflow" ? Number(context.id) : undefined;
    this.tid = context.mode === "template" ? Number(context.id) : undefined;
    this.pid = context.pid;

    this.workflowActionService.setHighlightingEnabled(true);

    /**
     * On initialization of the workspace, there could be two cases:
     *
     * 1. Accessed by URL `/`, no workflow is in the URL (Cold Start):
     -    - A new `WorkflowActionService.DEFAULT_WORKFLOW` is created, which is an empty workflow with undefined id.
     *    - After an Auto-persist being triggered by a WorkflowAction event, it will create a new workflow in the database
     *    and update the URL with its new ID from database.
     * 2. Accessed by URL `/workflow/:id` (refresh manually, or redirected from dashboard workflow list):
     *    - It will retrieve the workflow from database with the given ID. Because it has an ID, it will be linked to the database
     *    - Auto-persist will be triggered upon all workspace events.
     *
     * WorkflowActionService is the single source of the workflow representation. WorkflowPersistService reflects
     * changes from WorkflowActionService.
     */

    // clear the current workspace, reset as `WorkflowActionService.DEFAULT_WORKFLOW`
    this.workflowActionService.resetAsNewWorkflow();
    // if an id is present in the route, display loading spinner immediately while loading
    if (this.wid || this.tid) {
      this.isLoading = true;
      this.workflowActionService.disableWorkflowModification();
    }

    this.updateViewCount();
    this.onWIDChange();
    this.registerLoadOperatorMetadata();
  }

  private getEmbeddedWorkspaceContext(): WorkspaceContext {
    return {
      mode: this.mode!,
      id: this.wid ?? this.tid!,
      pid: this.pid,
    };
  }

  ngOnInit() {
    this.context$
      .pipe(untilDestroyed(this))
      .subscribe(context => {
        if (this.isEmbedded) {
          this.reloadWorkspace(this.getEmbeddedWorkspaceContext());
        } else {
          this.reloadWorkspace(context);
        }
      });
  }

  ngAfterViewInit() {
    this.codeEditorService.vc = this.codeEditorViewRef;
  }

  @HostListener("window:beforeunload")
  ngOnDestroy() {
    if (this.userService.isLogin() && this.persistEnabled()) {
     this.persistEntity().pipe(untilDestroyed(this)).subscribe();
    }

    this.codeEditorViewRef.clear();
    this.workflowActionService.clearWorkflow();
  }

  registerAutoPersistWorkflow(): void {
    // make sure it is only registered once
    if (this.autoPersistRegistered) {
      return;
    }
    this.autoPersistRegistered = true;

    this.workflowActionService
      .workflowChanged()
      .pipe(debounceTime(SAVE_DEBOUNCE_TIME_IN_MS))
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        if (this.userService.isLogin() && this.persistEnabled()) {
          this.persistEntity()
            .pipe(untilDestroyed(this))
            .subscribe(entity => {
              // to sync up with the updated information, such as workflow.wid
              this.handlePersistSuccess(entity);
            });
        }
      });
  }

  loadWorkflowWithId(wid: number): void {
    // disable the workspace until the workflow is fetched from the backend
    this.isLoading = true;
    this.workflowActionService.disableWorkflowModification();
    forkJoin({
      operatorMetadata: this.operatorMetadataService.getOperatorMetadata(),
      workflow: this.workflowPersistService.retrieveWorkflow(wid),
    })
      .pipe(untilDestroyed(this))
      .subscribe(
        ({workflow}) => {
          this.loadWorkflowIntoWorkspace(workflow);
        },
        () => {
          this.workflowActionService.resetAsNewWorkflow();
          // enable workspace for modification
          this.workflowActionService.enableWorkflowModification();
          // clear stack
          this.undoRedoService.clearUndoStack();
          this.undoRedoService.clearRedoStack();
          this.message.error("You don't have access to this workflow, please log in with an appropriate account");
          this.isLoading = false;
        }
      );
  }

  loadTemplateWithId(tid: number): void {
    this.isLoading = true;
    this.workflowActionService.disableWorkflowModification();
    this.templateService
      .retrieveTemplate(tid)
      .pipe(untilDestroyed(this))
      .subscribe(
        (template: Template) => {
          let workspaceWorkflow = this.createWorkflowFromTemplate(template);
          this.loadWorkflowIntoWorkspace(workspaceWorkflow);
        },
        () => {
          this.workflowActionService.resetAsNewWorkflow();
          // enable workspace for modification
          this.workflowActionService.enableWorkflowModification();
          // clear stack
          this.undoRedoService.clearUndoStack();
          this.undoRedoService.clearRedoStack();
          this.message.error("You don't have access to this template, please log in with an appropriate account");
          this.isLoading = false;
        }
      );
  }

  loadWorkflowIntoWorkspace(workflow: Workflow): void {
    if (checkIfGraphBroken(workflow.content)) {
      this.notificationService.error(
        "Sorry! The workflow is broken and cannot be persisted. Please contact the system admin."
      );
    }

    if (this.isWorkflowMode()) {
      this.workflowActionService.setNewSharedModel(this.wid, this.userService.getCurrentUser());
    } else if (this.isTemplateMode()) {
      this.workflowActionService.setNewSharedModel(undefined, this.userService.getCurrentUser());
    }

    // load the fetched workflow
    this.workflowActionService.reloadWorkflow(workflow);

    if (workflow.readonly || this.isTemplateMode()) {
      this.workflowActionService.disableWorkflowModification();
    } else {
      this.workflowActionService.enableWorkflowModification();
    }

    // remember URL fragment
    const fragment = this.route.snapshot.fragment;

    // set the URL fragment to previous value
    // because reloadWorkflow will highlight/unhighlight all elements
    // which will change the URL fragment
    this.router.navigate([], {
      relativeTo: this.route,
      fragment: fragment !== null ? fragment : undefined,
      preserveFragment: false,
    });
    // highlight the operator, comment box, or link in the URL fragment
    if (fragment) {
      if (this.workflowActionService.getTexeraGraph().hasElementWithID(fragment)) {
        this.workflowActionService.highlightElements(false, fragment);
      } else {
        this.notificationService.error(`Element ${fragment} doesn't exist`);
        // remove the fragment from the URL
        this.router.navigate([], { relativeTo: this.route });
      }
    }
    // clear stack
    this.undoRedoService.clearUndoStack();
    this.undoRedoService.clearRedoStack();
    this.setLoadingState(false);
    this.registerAutoPersistWorkflow();
    this.triggerCenter();

    this.workspaceReady.emit(workflow.wid ?? this.wid);
  }

  createWorkflowFromTemplate(template: Template): Workflow {
    return {
      name: template.name,
      description: template.description,
      wid: undefined,
      creationTime: template.creationTime,
      lastModifiedTime: template.lastModifiedTime,
      isPublished: template.isPublished,
      readonly: template.readonly,
      content: template.content,
    }
  }

  createTemplateFromWorkflow(workflow: Workflow): Template {
    return {
      tid: this.tid,
      name: workflow.name,
      description: workflow.description,
      content: workflow.content,
      creationTime: workflow.creationTime,
      lastModifiedTime: workflow.lastModifiedTime,
      isPublished: workflow.isPublished,
      readonly: workflow.readonly,
      configurableParameters: "",
    }
  }

  registerLoadOperatorMetadata() {
    let id = Number(this.wid ?? this.route.snapshot.params.id);
    // load workflow with wid if presented in the URL
    if (id) {
      // show loading spinner right away while waiting for workflow to load
      this.isLoading = true;
      // temporarily disable modification to prevent editing an empty workflow before real data is loaded
      this.workflowActionService.disableWorkflowModification();
      if (this.isWorkflowMode()) {
        this.loadWorkflowWithId(id);
      } else if (this.isTemplateMode()) {
        this.loadTemplateWithId(id);
      }
      return;
    }

    this.operatorMetadataService
      .getOperatorMetadata()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        // no workflow to load; directly register auto persist for brand-new workflow
        this.registerAutoPersistWorkflow();
      });
  }
  onWIDChange() {
    this.workflowActionService
      .workflowMetaDataChanged()
      .pipe(
        switchMap(() => of(this.workflowActionService.getWorkflowMetadata())),
        filter((metadata: WorkflowMetadata) => isDefined(metadata.wid)),
        distinctUntilChanged()
      )
      .pipe(untilDestroyed(this))
      .subscribe((metadata: WorkflowMetadata) => {
        this.writeAccess = !metadata.readonly;
      });
  }
  updateViewCount() {
    if (!this.isWorkflowMode()) return;

    let wid = this.wid ?? this.route.snapshot.params.id;
    let uid = this.userService.getCurrentUser()?.uid;
    this.hubService
      .postView(wid, uid ? uid : 0, EntityType.Workflow)
      .pipe(throttleTime(THROTTLE_TIME_MS))
      .pipe(untilDestroyed(this))
      .subscribe();
  }
  public triggerCenter(): void {
    this.workflowActionService.getTexeraGraph().triggerCenterEvent();
  }

  private setLoadingState(isLoading: boolean): void {
    this.isLoading = isLoading;
    this.changeDetectorRef.detectChanges();
  }

  public get copilotEnabled(): boolean {
    return this.config.env.copilotEnabled;
  }

  private persistEnabled(): boolean {
    if (this.isWorkflowMode()) {
      return this.workflowPersistService.isWorkflowPersistEnabled();
    } else if (this.isTemplateMode()) {
      return this.templateService.isTemplatePersistEnabled();
    }

    return false;
  }

  private persistEntity(): Observable<Template | Workflow> {
    const workflow = this.workflowActionService.getWorkflow();
    if (this.isWorkflowMode()) {
      return this.workflowPersistService.persistWorkflow(workflow);

    } else {
      const template = this.createTemplateFromWorkflow(workflow);
      return this.templateService.persistTemplate(template);
    }
  }

  private handlePersistSuccess(entity: Workflow | Template): void {
    if (this.isWorkflowMode()) {
      const updatedWorkflow = entity as Workflow;

      if (this.wid !== updatedWorkflow.wid && !this.isEmbedded) {
        this.wid = updatedWorkflow.wid;
        this.location.go(`${USER_WORKSPACE}/${updatedWorkflow.wid}`);
      }

      this.workflowActionService.setWorkflowMetadata(updatedWorkflow);

    } else if (this.isTemplateMode()) {
      const updatedTemplate = entity as Template;

      if (this.tid !== updatedTemplate.tid) {
        this.tid = updatedTemplate.tid;
        this.location.go(`${USER_TEMPLATE}/${updatedTemplate.tid}`);
      }

      // normalize into UI workflow metadata
      this.workflowActionService.setWorkflowMetadata({
        wid: undefined,
        name: updatedTemplate.name,
        description: updatedTemplate.description,
        creationTime: updatedTemplate.creationTime,
        lastModifiedTime: updatedTemplate.lastModifiedTime,
        readonly: updatedTemplate.readonly,
        isPublished: updatedTemplate.isPublished,
      });
    }
  }

  private isWorkflowMode(): boolean {
    return this.mode === "workflow";
  }

  private isTemplateMode(): boolean {
    return this.mode === "template";
  }
}
