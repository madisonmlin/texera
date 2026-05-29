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
import { FormlyJsonschema } from "@ngx-formly/core/json-schema";
import { FormGroup } from "@angular/forms";
import { AfterViewInit, Component, OnInit } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NotificationService } from "../../../../../common/service/notification/notification.service";
import { UserService } from "../../../../../common/service/user/user.service";
import { WorkflowActionService } from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import { Workflow, WorkflowContent } from "../../../../../common/type/workflow";
import { WorkflowPersistService } from "../../../../../common/service/workflow-persist/workflow-persist.service";
import { AppSettings } from "../../../../../common/app-setting";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { isEqual } from "lodash-es";
import { catchError, debounceTime, EMPTY, forkJoin, merge, Observable, of, Subscription, tap } from "rxjs";
import { filter, map, switchMap } from "rxjs/operators";
import { cloneDeep } from "lodash";
import { ActivatedRoute } from "@angular/router";
import { TemplateService } from "../../../../service/user/template/template.service";
import { OperatorMetadataService } from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import { OperatorLink, OperatorPredicate } from "../../../../../workspace/types/workflow-common.interface";
import {
  WORKFLOW_COMPILATION_ENDPOINT,
  WorkflowCompilingService,
} from "../../../../../workspace/service/compile-workflow/workflow-compiling.service";
import { DynamicSchemaService } from "../../../../../workspace/service/dynamic-schema/dynamic-schema.service";
import { OperatorSchema } from "../../../../../workspace/types/operator-schema.interface";
import { LogicalLink, LogicalOperator, LogicalPlan } from "../../../../../workspace/types/execute-workflow.interface";
import {
  OperatorPortSchemaMap,
  PortSchema,
  WorkflowCompilationResponse,
} from "../../../../../workspace/types/workflow-compiling.interface";
import { parseLogicalOperatorPortID } from "../../../../../common/util/logical-operator-port-serde";
import { serializePortIdentity } from "../../../../../common/util/port-identity-serde";

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
})
export class TemplatedWorkflowCreationComponent implements AfterViewInit, OnInit {
  public tid: number | undefined;
  public wid: number | undefined;
  public template: WorkflowContent | undefined;

  // operatorID -> staged snapshot of that operator's full properties.
  // This is mutated while the user edits the configurable form, but it is not
  // copied into WorkflowActionService until SUBMIT.
  public operatorIdToProperties: Record<string, Record<string, any>> = {};

  public sections: ConfigurableSection[] = [];
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;

  workflow: Workflow | undefined;

  // Recreated whenever sections are rebuilt because each rebuild creates new FormGroup instances.
  private formChangesSub: Subscription | undefined;

  // Draft-only dynamic schemas produced by compiling staged operator properties.
  // These are used for Formly dropdown rebuilding before SUBMIT.
  private draftDynamicSchemas = new Map<string, OperatorSchema>();

  // The first submit creates the workflow. Then the embedded workspace loads the newly created
  // workflow and emits workspaceReady. This flag makes sure workspaceReady applies staged values
  // only as part of that explicit submit/create flow.
  private pendingApplyAfterCreate = false;

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private templateService: TemplateService,
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
  }

  public get formValid(): boolean {
    return this.sections.every(s => s.form.valid);
  }

  public onJobFormSubmitted(): void {
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
        .subscribe();
    }
  }

  public onWorkspaceReady(loadedWid?: number): void {
    if (!this.pendingApplyAfterCreate) {
      return;
    }

    if (Number(loadedWid) !== Number(this.wid)) {
      return;
    }

    this.pendingApplyAfterCreate = false;

    this.applyJobFormToOperators()
      .pipe(untilDestroyed(this))
      .subscribe();
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
    } else {
      this.notificationService.info("No changes made to the workflow.");
      return of(this.workflowActionService.getWorkflow());
    }
  }

  private mergeFormValuesIntoOperatorProperties(): void {
    for (const section of this.sections) {
      this.mergeSectionFormValuesIntoOperatorProperties(section);
    }
  }

  private mergeSectionFormValuesIntoOperatorProperties(section: ConfigurableSection): void {
    this.operatorIdToProperties[section.operatorID] = {
      ...this.operatorIdToProperties[section.operatorID],
      ...cloneDeep(section.model),
    };
  }

  private writeOperatorPropertiesToGraph(): void {
    for (const section of this.sections) {
      this.workflowActionService.setOperatorProperty(
        section.operatorID,
        this.operatorIdToProperties[section.operatorID]
      );
    }
  }

  private workflowChanged(): boolean {
    return this.sections.some(section => {
      const operator = this.workflowActionService.getTexeraGraph().getOperator(section.operatorID);
      return !isEqual(this.operatorIdToProperties[section.operatorID], operator.operatorProperties);
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
        this.operatorIdToProperties[op.operatorID] ?? op.operatorProperties;

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

  ngOnInit(): void {
    return;
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
        this.operatorIdToProperties = {};
        this.draftDynamicSchemas.clear();
        this.pendingApplyAfterCreate = false;

        template.content.operators.forEach(op => {
          this.operatorIdToProperties[op.operatorID] = cloneDeep(op.operatorProperties);
        });

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
          readonly: false,
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
      if (this.draftDynamicSchemas.has(op.operatorID)) {
        enriched.set(op.operatorID, this.draftDynamicSchemas.get(op.operatorID) as OperatorSchema);
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
        map(nextModel => this.hasSchemaDrivingChange(section, nextModel)),
        tap(() => this.mergeSectionFormValuesIntoOperatorProperties(section)),
        filter(hasSchemaDrivingChange => hasSchemaDrivingChange)
      )
    );

    this.formChangesSub = merge(...valueChangeStreams)
      .pipe(
        debounceTime(300),
        switchMap(() => this.compileDraftWorkflowForDynamicSchemas()),
        untilDestroyed(this)
      )
      .subscribe(response => {
        this.applyDraftSchemaPropagationResult(response.operatorOutputSchemas);
      });
  }

  private hasSchemaDrivingChange(section: ConfigurableSection, nextModel: Record<string, any>): boolean {
    const draftFileName = this.operatorIdToProperties[section.operatorID]?.fileName;

    return (
      nextModel.fileName !== undefined &&
      nextModel.fileName !== "" &&
      nextModel.fileName !== draftFileName
    );
  }

  private compileDraftWorkflowForDynamicSchemas(): Observable<WorkflowCompilationResponse> {
    const logicalPlan = this.getDraftLogicalPlan();

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

  private getDraftLogicalPlan(): LogicalPlan {
    if (!this.template) {
      return { operators: [], links: [], opsToViewResult: [], opsToReuseResult: [] };
    }

    const operators: LogicalOperator[] = this.template.operators.map(op => ({
      ...(this.operatorIdToProperties[op.operatorID] ?? op.operatorProperties),
      operatorID: op.operatorID,
      operatorType: op.operatorType,
      inputPorts: op.inputPorts,
      outputPorts: op.outputPorts,
    }));

    const links: LogicalLink[] = this.template.links
      .map(link => this.toLogicalLink(link))
      .filter((link): link is LogicalLink => link !== undefined);

    return { operators, links, opsToViewResult: [], opsToReuseResult: [] };
  }

  /**
   * Kept intentionally close to the existing implementation because changing port-ID
   * conversion requires checking Texera's OperatorLink/LogicalLink conventions elsewhere.
   */
  private toLogicalLink(link: OperatorLink): LogicalLink | undefined {
    if (!this.template) return undefined;

    const source = this.template.operators.find(op => op.operatorID === link.source.operatorID);
    const target = this.template.operators.find(op => op.operatorID === link.target.operatorID);

    if (!source || !target) return undefined;

    const outputPortIdx = source.outputPorts.findIndex(port => port.portID === link.source.portID);
    const inputPortIdx = target.inputPorts.findIndex(port => port.portID === link.target.portID);

    if (outputPortIdx < 0 || inputPortIdx < 0) return undefined;

    return {
      fromOpId: link.source.operatorID,
      fromPortId: { id: outputPortIdx, internal: false },
      toOpId: link.target.operatorID,
      toPortId: { id: inputPortIdx, internal: false },
    };
  }

  private applyDraftSchemaPropagationResult(outputSchemas: Record<string, OperatorPortSchemaMap>): void {
    if (!this.template) return;

    this.template.operators.forEach(op => {
      const currentDynamicSchema =
        this.draftDynamicSchemas.get(op.operatorID) ??
        (this.dynamicSchemaService.dynamicSchemaExists(op.operatorID)
          ? this.dynamicSchemaService.getDynamicSchema(op.operatorID)
          : this.operatorMetadataService.getOperatorSchema(op.operatorType));

      const inputSchema = this.extractOperatorInputPortSchemaMap(op, outputSchemas);

      const newDynamicSchema = inputSchema
        ? WorkflowCompilingService.setOperatorInputAttrs(currentDynamicSchema, inputSchema)
        : currentDynamicSchema.additionalMetadata.inputPorts.length > 0
          ? WorkflowCompilingService.restoreOperatorInputAttrs(currentDynamicSchema)
          : currentDynamicSchema;

      this.draftDynamicSchemas.set(op.operatorID, newDynamicSchema);
    });

    this.rebuildSectionsFromDynamicSchemas();
  }

  private extractOperatorInputPortSchemaMap(
    operator: OperatorPredicate,
    outputSchemas: Record<string, OperatorPortSchemaMap>
  ): OperatorPortSchemaMap | undefined {
    if (!this.template) return undefined;

    const inputLinks = this.template.links.filter(link => link.target.operatorID === operator.operatorID);
    if (!inputLinks.length) return undefined;

    const inputPortSchemaMap = new Map<string, PortSchema | undefined>();

    operator.inputPorts.forEach((_, portIndex) => {
      const portId = serializePortIdentity({ id: portIndex, internal: false });

      const linksToThisPort = inputLinks.filter(link => {
        const inputPort = parseLogicalOperatorPortID(link.target.portID);
        return inputPort?.portNumber === portIndex;
      });

      if (linksToThisPort.length === 0) {
        inputPortSchemaMap.set(portId, undefined);
        return;
      }

      const schemas = linksToThisPort.map(link => {
        const sourcePort = parseLogicalOperatorPortID(link.source.portID);
        if (!sourcePort) return undefined;

        return outputSchemas[link.source.operatorID]?.[
          serializePortIdentity({ id: sourcePort.portNumber, internal: false })
          ];
      });

      inputPortSchemaMap.set(portId, schemas[0]);
    });

    if (!inputPortSchemaMap.size) return undefined;

    return Object.fromEntries(inputPortSchemaMap);
  }
}
