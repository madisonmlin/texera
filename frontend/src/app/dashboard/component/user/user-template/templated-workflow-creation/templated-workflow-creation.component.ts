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

import {FormlyFieldConfig, FormlyModule} from "@ngx-formly/core";
import {FormlyJsonschema} from "@ngx-formly/core/json-schema";
import {FormGroup, ReactiveFormsModule} from "@angular/forms";
import {AfterViewInit, Component} from "@angular/core";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {Workflow, WorkflowContent} from "../../../../../common/type/workflow";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {HttpClient, HttpHeaders} from "@angular/common/http";
import {catchError, debounceTime, EMPTY, forkJoin, merge, Observable, of, Subscription, tap} from "rxjs";
import {filter, finalize, map, switchMap} from "rxjs/operators";
import {cloneDeep} from "lodash";
import {ActivatedRoute} from "@angular/router";
import {TemplateService} from "../../../../service/user/template/template.service";
import {OperatorMetadataService} from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import {OperatorPredicate} from "../../../../../workspace/types/workflow-common.interface";
import {
  WORKFLOW_COMPILATION_ENDPOINT,
  WorkflowCompilingService,
} from "../../../../../workspace/service/compile-workflow/workflow-compiling.service";
import {DynamicSchemaService} from "../../../../../workspace/service/dynamic-schema/dynamic-schema.service";
import {OperatorSchema} from "../../../../../workspace/types/operator-schema.interface";
import {
  OperatorPortSchemaMap,
  WorkflowCompilationResponse,
} from "../../../../../workspace/types/workflow-compiling.interface";
import {TemplatedWorkflowDraftService} from "./service/templated-workflow-draft.service";
import {ExecuteWorkflowService} from "../../../../../workspace/service/execute-workflow/execute-workflow.service";
import {ExecutionState} from "../../../../../workspace/types/execute-workflow.interface";
import {CommonModule} from "@angular/common";
import {NzButtonModule} from "ng-zorro-antd/button";
import {NzTooltipModule} from "ng-zorro-antd/tooltip";
import {WorkspaceComponent} from "../../../../../workspace/component/workspace.component";

interface ConfigurableSection {
  operatorID: string;
  label: string;
  fields: FormlyFieldConfig[];
  form: FormGroup;
  model: Record<string, any>;
}

@UntilDestroy()
@Component({
  templateUrl: "./templated-workflow-creation.component.html",
  styleUrls: ["./templated-workflow-creation.component.scss"],
  providers: [TemplatedWorkflowDraftService],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormlyModule,
    NzButtonModule,
    NzTooltipModule,
    WorkspaceComponent,
  ],
})
export class TemplatedWorkflowCreationComponent implements AfterViewInit {
  public tid: number | undefined;
  public wid: number | undefined;
  public template: WorkflowContent | undefined;

  public sections: ConfigurableSection[] = [];
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;
  public executionState: ExecutionState = ExecutionState.Uninitialized;
  public ExecutionState = ExecutionState;

  // Recreated whenever sections are rebuilt because each rebuild creates new FormGroup instances.
  private formChangesSub: Subscription | undefined;

  // The first submit creates the workflow. Then the embedded workspace loads the newly created
  // workflow and emits workspaceReady. This flag makes sure workspaceReady applies staged values
  // only as part of that explicit submit/create flow.
  private pendingApplyAfterCreate = false;

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private templateService: TemplateService,
    private templatedWorkflowDraftService: TemplatedWorkflowDraftService,
    private executeWorkflowService: ExecuteWorkflowService,
    private workflowPersistService: WorkflowPersistService,
    private operatorMetadataService: OperatorMetadataService,
    private dynamicSchemaService: DynamicSchemaService,
    // injected to ensure the singleton WorkflowCompilingService is instantiated
    private workflowCompilingService: WorkflowCompilingService,
    private formlyJsonschema: FormlyJsonschema,
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

    this.executionState = this.executeWorkflowService.getExecutionState().state;
    this.executeWorkflowService
      .getExecutionStateStream()
      .pipe(untilDestroyed(this))
      .subscribe(event => {
        this.executionState = event.current.state;
      });
  }

  public get formValid(): boolean {
    return this.sections.every(s => s.form.valid);
  }

  public get isWorkflowExecutionActive(): boolean {
    return [
      ExecutionState.Initializing,
      ExecutionState.Running,
      ExecutionState.Pausing,
      ExecutionState.Paused,
      ExecutionState.Resuming,
      ExecutionState.Recovering,
    ].includes(this.executionState);
  }

  public get submitDisabled(): boolean {
    return !this.formValid || this.isWorkflowExecutionActive;
  }

  public onJobFormSubmitted(): void {
    if (this.isWorkflowExecutionActive) {
      this.notificationService.warning(
        "Cannot submit template properties while the workflow is running. Stop or wait for the workflow to finish before submitting changes."
      );
      return;
    }

    if (!this.formValid) {
      this.notificationService.error("Invalid form.");
      return;
    }

    if (!this.wid) {
      this.pendingApplyAfterCreate = true;

      this.createTemplatedWorkflow()
        .pipe(untilDestroyed(this))
        .subscribe({
          next: wid => {
            this.wid = wid;
          },
          error: err => {
            this.pendingApplyAfterCreate = false;
            console.warn("Failed to create templated workflow", err);
            this.notificationService.error("Failed to create workflow from template.");
          },
        });
    } else {
      this.applyJobFormToOperators()
        .pipe(untilDestroyed(this))
        .subscribe({
          error: err => {
            console.warn("Failed to update templated workflow", err);
            this.notificationService.error("Failed to update workflow.");
          },
        });
    }
  }

  public onWorkspaceReady(loadedWid?: number): void {
    if (!this.pendingApplyAfterCreate) {
      return;
    }

    if (Number(loadedWid) !== Number(this.wid)) {
      return;
    }

    this.applyJobFormToOperators()
      .pipe(
        finalize(() => {
          this.pendingApplyAfterCreate = false;
        }),
        untilDestroyed(this)
      )
      .subscribe({
        error: err => {
          console.warn("Failed to apply templated workflow properties", err);
          this.notificationService.error("Failed to apply workflow properties.");
        },
      });
  }

  private createTemplatedWorkflow(): Observable<number> {
    return this.http.post<number>(`${AppSettings.getApiEndpoint()}/templated-workflow/build?tid=${this.tid}`, {});
  }

  private applyJobFormToOperators(): Observable<Workflow> {
    this.mergeFormValuesIntoOperatorProperties();

    if (this.workflowChanged()) {
      this.writeOperatorPropertiesToGraph();

      const workflow = this.workflowActionService.getWorkflow();
      return this.workflowPersistService.persistWorkflow(workflow).pipe(
        tap(() => {
          this.notificationService.success("Workflow updated.");
        })
      );
    }

    if (!this.pendingApplyAfterCreate) {
      this.notificationService.info("No changes made to the workflow.");
    }
    return of(this.workflowActionService.getWorkflow());
  }

  private mergeFormValuesIntoOperatorProperties(): void {
    for (const section of this.sections) {
      this.mergeSectionFormValuesIntoOperatorProperties(section);
    }
  }

  private mergeSectionFormValuesIntoOperatorProperties(section: ConfigurableSection): void {
    this.templatedWorkflowDraftService.mergeSectionModel(section.operatorID, section.model);
  }

  private writeOperatorPropertiesToGraph(): void {
    for (const section of this.sections) {
      this.workflowActionService.setOperatorProperty(
        section.operatorID,
        this.templatedWorkflowDraftService.getOperatorProperties(section.operatorID)
      );
    }
  }

  private workflowChanged(): boolean {
    return this.sections.some(section => {
      const liveOperator = this.workflowActionService.getTexeraGraph().getOperator(section.operatorID);

      return this.templatedWorkflowDraftService.operatorPropertiesChanged(
        section.operatorID,
        liveOperator.operatorProperties
      );
    });
  }

  /**
   * Build one section per operator that has configurableProperties, by reusing the operator's
   * own JSON schema → formly conversion and filtering to only the configurable top-level keys.
   *
   * `enrichedSchemas` maps operatorID → schema with upstream input attributes already injected as
   * enums so that attribute-selector fields render as dropdowns rather than plain text inputs.
   */
  private buildSectionsFromTemplate(
    template: { content: WorkflowContent },
    enrichedSchemas: Map<string, OperatorSchema>
  ): ConfigurableSection[] {
    const sections: ConfigurableSection[] = [];

    template.content.operators.forEach((op: OperatorPredicate) => {
      const configurableKeys = op.configurableProperties ?? [];
      if (configurableKeys.length === 0) return;

      const schema = enrichedSchemas.get(op.operatorID) ?? this.operatorMetadataService.getOperatorSchema(op.operatorType);

      const fullField = this.formlyJsonschema.toFieldConfig(cloneDeep(schema.jsonSchema) as any, {
        map: mappedField => {
          if (mappedField.key === "fileName") {
            mappedField.type = "inputautocomplete";
          }
          return mappedField;
        },
      });

      const allChildren = fullField.fieldGroup ?? [];
      const configurableSet = new Set(configurableKeys);
      const fields = allChildren.filter(
        child => typeof child.key === "string" && configurableSet.has(child.key)
      );

      if (fields.length === 0) return;

      // Seed the model from the staged draft, not the live graph.
      // This preserves unsaved user edits across schema-triggered form rebuilds.
      const draftPropsSource: Record<string, any> =
        this.templatedWorkflowDraftService.getOperatorProperties(op.operatorID) ?? op.operatorProperties;

      const model: Record<string, any> = {};
      configurableKeys.forEach(key => {
        model[key] = cloneDeep(draftPropsSource?.[key]);
      });

      sections.push({
        operatorID: op.operatorID,
        label: op.customDisplayName?.trim() ? op.customDisplayName : op.operatorType,
        fields,
        form: new FormGroup({}),
        model,
      });
    });

    return sections;
  }

  ngAfterViewInit(): void {
    this.tid = this.route.snapshot.params.tid;
    if (!this.tid) return;

    forkJoin({
      template: this.templateService.retrieveTemplate(this.tid),
      metadata: this.operatorMetadataService.getOperatorMetadata(),
    })
      .pipe(untilDestroyed(this))
      .subscribe(({ template }) => {
        this.template = template.content;
        this.pendingApplyAfterCreate = false;
        this.templatedWorkflowDraftService.initialize(template.content);

        // Load the template into WorkflowActionService for initial preview/schema setup.
        // User form edits after this point should use compileDraftWorkflowForDynamicSchemas()
        // and should not call setOperatorProperty() until SUBMIT.
        this.workflowActionService.destroySharedModel();
        this.workflowActionService.setNewSharedModel(undefined, this.userService.getCurrentUser());
        this.workflowActionService.reloadWorkflow({
          wid: undefined,
          name: "template-preview",
          description: undefined,
          creationTime: undefined,
          lastModifiedTime: undefined,
          isPublished: 0,
          readonly: true,
          content: template.content,
        });

        this.rebuildSectionsFromDynamicSchemas();

        // Do not suppress this stream. Texera's existing schema propagation may still
        // populate/enrich DynamicSchemaService, especially during initial template loading.
        this.dynamicSchemaService
          .getOperatorDynamicSchemaChangedStream()
          .pipe(debounceTime(50), untilDestroyed(this))
          .subscribe(() => this.rebuildSectionsFromDynamicSchemas());
      });
  }

  /**
   * Re-create the configurable-section list.
   *
   * Prefer draftDynamicSchemas when they exist because those reflect unsaved form edits.
   * Fall back to global DynamicSchemaService schemas for initial template schemas and any
   * existing Texera schema propagation.
   */
  private rebuildSectionsFromDynamicSchemas(): void {
    if (!this.template) return;

    this.formChangesSub?.unsubscribe();

    const enriched = new Map<string, OperatorSchema>();

    this.template.operators.forEach(op => {
      if (this.templatedWorkflowDraftService.hasDraftDynamicSchema(op.operatorID)) {
        enriched.set(op.operatorID, this.templatedWorkflowDraftService.getDraftDynamicSchema(op.operatorID) as OperatorSchema);
      } else if (this.dynamicSchemaService.dynamicSchemaExists(op.operatorID)) {
        enriched.set(op.operatorID, this.dynamicSchemaService.getDynamicSchema(op.operatorID));
      }
    });

    this.sections = this.buildSectionsFromTemplate({ content: this.template }, enriched);
    this.subscribeToFormChanges();
  }

  /**
   * Pipe user edits from each section's form into a draft compile.
   *
   * This keeps downstream dynamic dropdowns responsive without mutating the shared workflow graph
   * before SUBMIT. For now, only fileName is treated as schema-driving because that is the known
   * required propagation path.
   */
  private subscribeToFormChanges(): void {
    if (this.sections.length === 0) return;

    const valueChangeStreams = this.sections.map(section =>
      section.form.valueChanges.pipe(
        map(nextModel =>
          this.templatedWorkflowDraftService.mergeSectionModelIfChanged(
            section.operatorID,
            nextModel
          )
        ),
        filter(changed => changed)
      )
    );

    this.formChangesSub = merge(...valueChangeStreams)
      .pipe(
        debounceTime(300),
        switchMap(() => this.compileDraftWorkflowForDynamicSchemas()),
        untilDestroyed(this)
      )
      .subscribe(response => {
        if (!response.operatorOutputSchemas) {
          return;
        }
        this.applyDraftSchemaPropagationResult(response.operatorOutputSchemas);
      });
  }

  private compileDraftWorkflowForDynamicSchemas(): Observable<WorkflowCompilationResponse> {
    if (!this.template) {
      return EMPTY;
    }

    const logicalPlan = this.templatedWorkflowDraftService.buildDraftLogicalPlan(this.template);

    const body = {
      operators: logicalPlan.operators,
      links: logicalPlan.links,
      opsToReuseResult: [],
      opsToViewResult: [],
    };

    return this.http
      .post<WorkflowCompilationResponse>(
        `${AppSettings.getApiEndpoint()}/${WORKFLOW_COMPILATION_ENDPOINT}`,
        JSON.stringify(body),
        {
          headers: new HttpHeaders({
            "Content-Type": "application/json",
          }),
        }
      )
      .pipe(
        catchError((err: unknown) => {
          console.warn("compile draft workflow API returns error", err);
          return EMPTY;
        })
      );
  }

  private applyDraftSchemaPropagationResult(outputSchemas: Record<string, OperatorPortSchemaMap>): void {
    if (!this.template) return;

    this.templatedWorkflowDraftService.applyDraftSchemaPropagationResult({
      content: this.template,
      outputSchemas,
      getBaseSchema: op => this.getBaseSchemaForOperator(op),
    });

    this.rebuildSectionsFromDynamicSchemas();
  }

  private getBaseSchemaForOperator(op: OperatorPredicate): OperatorSchema {
    if (this.dynamicSchemaService.dynamicSchemaExists(op.operatorID)) {
      return this.dynamicSchemaService.getDynamicSchema(op.operatorID);
    }

    return this.operatorMetadataService.getOperatorSchema(op.operatorType);
  }
}
