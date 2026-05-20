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
import { catchError, debounceTime, forkJoin, merge, Observable, of, Subscription, tap } from "rxjs";
import { cloneDeep } from "lodash";
import { ActivatedRoute } from "@angular/router";
import { TemplateService } from "../../../../service/user/template/template.service";
import { OperatorMetadataService } from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import { OperatorPredicate, OperatorLink } from "../../../../../workspace/types/workflow-common.interface";
import { WorkflowCompilingService, WORKFLOW_COMPILATION_ENDPOINT } from "../../../../../workspace/service/compile-workflow/workflow-compiling.service";
import { OperatorPortSchemaMap, PortSchema, WorkflowCompilationResponse } from "../../../../../workspace/types/workflow-compiling.interface";
import { OperatorSchema } from "../../../../../workspace/types/operator-schema.interface";
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
  styleUrls: ["./templated-workflow-creation.component.scss"]
})
export class TemplatedWorkflowCreationComponent implements AfterViewInit, OnInit {
  public tid: number | undefined;
  public wid: number | undefined;
  public template: WorkflowContent | undefined;
  // operatorID -> snapshot of that operator's full properties (mutated as the user edits)
  public operatorIdToProperties: Record<string, Record<string, any>> = {};
  public sections: ConfigurableSection[] = [];
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;

  workflow: Workflow | undefined;

  // Used to skip redundant rebuilds when a value change doesn't alter any operator's
  // enriched schema (e.g. typing into a non-schema-affecting numeric field).
  private currentSchemasFingerprint: string = "";
  // Subscription that fans in value-changes from every section's form and triggers
  // a debounced recompile. Recreated whenever sections are rebuilt.
  private formChangesSub: Subscription | undefined;

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private templateService: TemplateService,
    private workflowPersistService: WorkflowPersistService,
    private operatorMetadataService: OperatorMetadataService,
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
      this.createTemplatedWorkflow().pipe(untilDestroyed(this)).subscribe(wid => {
        this.wid = wid;
      });
    } else {
      this.applyJobFormToOperators().pipe(untilDestroyed(this)).subscribe();
    }
  }

  public onWorkspaceReady(): void {
    this.applyJobFormToOperators().pipe(untilDestroyed(this)).subscribe();
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
      this.operatorIdToProperties[section.operatorID] = {
        ...this.operatorIdToProperties[section.operatorID],
        ...section.model,
      };
    }
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
   * enums (via WorkflowCompilingService.setOperatorInputAttrs) so that attribute-selector fields
   * render as dropdowns rather than plain text inputs.
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

      const model: Record<string, any> = {};
      configurableKeys.forEach(key => {
        model[key] = cloneDeep(op.operatorProperties?.[key]);
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

  /**
   * Compile the template's workflow content via the /compile endpoint to obtain output schemas
   * for every operator. Mirrors ExecuteWorkflowService.getLogicalPlanRequest, but works off raw
   * template content (no live WorkflowGraph required).
   */
  private compileTemplate(content: WorkflowContent): Observable<WorkflowCompilationResponse | undefined> {
    const opById = new Map(content.operators.map(op => [op.operatorID, op]));

    const operators = content.operators.map(op => ({
      ...op.operatorProperties,
      operatorID: op.operatorID,
      operatorType: op.operatorType,
      inputPorts: op.inputPorts,
      outputPorts: op.outputPorts,
    }));

    const links = content.links.map((link: OperatorLink) => {
      const srcOp = opById.get(link.source.operatorID);
      const tgtOp = opById.get(link.target.operatorID);
      const fromPortIdx = srcOp?.outputPorts.findIndex(p => p.portID === link.source.portID) ?? -1;
      const toPortIdx = tgtOp?.inputPorts.findIndex(p => p.portID === link.target.portID) ?? -1;
      return {
        fromOpId: link.source.operatorID,
        fromPortId: { id: fromPortIdx, internal: false },
        toOpId: link.target.operatorID,
        toPortId: { id: toPortIdx, internal: false },
      };
    });

    const body = { operators, links, opsToReuseResult: [], opsToViewResult: [] };

    return this.http
      .post<WorkflowCompilationResponse>(
        `${AppSettings.getApiEndpoint()}/${WORKFLOW_COMPILATION_ENDPOINT}`,
        JSON.stringify(body),
        { headers: new HttpHeaders({ "Content-Type": "application/json" }) }
      )
      .pipe(
        catchError(err => {
          console.warn("template workflow compile failed; attribute dropdowns will fall back to text inputs", err);
          return of(undefined);
        })
      );
  }

  /**
   * For each operator in the template, derive its input port schema map (port-index keyed) from
   * the compile response's output schemas + the template's links, then apply
   * WorkflowCompilingService.setOperatorInputAttrs to get a schema with enum-populated
   * attribute fields ready for formly.
   */
  private buildEnrichedSchemas(
    content: WorkflowContent,
    outputSchemas: Record<string, OperatorPortSchemaMap>
  ): Map<string, OperatorSchema> {
    const enriched = new Map<string, OperatorSchema>();
    const opById = new Map(content.operators.map(op => [op.operatorID, op]));

    content.operators.forEach(op => {
      const inputLinks = content.links.filter(link => link.target.operatorID === op.operatorID);
      const inputSchemaMap: Record<string, PortSchema | undefined> = {};

      op.inputPorts.forEach((inputPort, portIndex) => {
        const portKey = serializePortIdentity({ id: portIndex, internal: false });
        const linksToThisPort = inputLinks.filter(link => link.target.portID === inputPort.portID);
        const firstLink = linksToThisPort[0];
        if (!firstLink) {
          inputSchemaMap[portKey] = undefined;
          return;
        }
        const srcOp = opById.get(firstLink.source.operatorID);
        const srcPortIdx = srcOp?.outputPorts.findIndex(p => p.portID === firstLink.source.portID) ?? -1;
        if (srcPortIdx < 0) {
          inputSchemaMap[portKey] = undefined;
          return;
        }
        const srcPortKey = serializePortIdentity({ id: srcPortIdx, internal: false });
        inputSchemaMap[portKey] = outputSchemas[firstLink.source.operatorID]?.[srcPortKey];
      });

      const baseSchema = this.operatorMetadataService.getOperatorSchema(op.operatorType);
      enriched.set(op.operatorID, WorkflowCompilingService.setOperatorInputAttrs(baseSchema, inputSchemaMap));
    });

    return enriched;
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
        template.content.operators.forEach(op => {
          this.operatorIdToProperties[op.operatorID] = cloneDeep(op.operatorProperties);
        });

        this.compileTemplate(template.content)
          .pipe(untilDestroyed(this))
          .subscribe(response => {
            const outputSchemas = response?.operatorOutputSchemas ?? {};
            const enriched = this.buildEnrichedSchemas(template.content, outputSchemas);
            this.currentSchemasFingerprint = this.fingerprintSchemas(enriched);
            this.rebuildSections(template.content, enriched);
          });
      });
  }

  /**
   * Replace sections with freshly-built ones (preserving user-entered model values via
   * `buildLiveContent`, which is what the caller feeds in as `content`) and re-attach the
   * form-change listener to the new section forms.
   */
  private rebuildSections(content: WorkflowContent, enriched: Map<string, OperatorSchema>): void {
    this.formChangesSub?.unsubscribe();
    this.sections = this.buildSectionsFromTemplate({ content }, enriched);
    this.subscribeToFormChanges();
  }

  /**
   * Listen for any value change across all section forms. On change, re-run /compile with the
   * live (model-merged) operator properties so downstream operators get fresh input schemas.
   * Skips the rebuild if the new enriched schemas are identical to the current ones, which
   * also stops the initial control-init valueChanges burst from causing rebuild loops.
   */
  private subscribeToFormChanges(): void {
    if (this.sections.length === 0) return;
    this.formChangesSub = merge(...this.sections.map(s => s.form.valueChanges))
      .pipe(debounceTime(400), untilDestroyed(this))
      .subscribe(() => this.recompileAndRebuild());
  }

  private recompileAndRebuild(): void {
    if (!this.template) return;
    const liveContent = this.buildLiveContent(this.template);
    this.compileTemplate(liveContent)
      .pipe(untilDestroyed(this))
      .subscribe(response => {
        const outputSchemas = response?.operatorOutputSchemas ?? {};
        const enriched = this.buildEnrichedSchemas(liveContent, outputSchemas);
        const fingerprint = this.fingerprintSchemas(enriched);
        if (fingerprint === this.currentSchemasFingerprint) return;
        this.currentSchemasFingerprint = fingerprint;
        this.rebuildSections(liveContent, enriched);
      });
  }

  /**
   * Project the user's current section-model values back onto the loaded template content so
   * that downstream schema propagation sees the latest configurable values (e.g. the file the
   * user just picked in a CSVFileScan).
   */
  private buildLiveContent(base: WorkflowContent): WorkflowContent {
    const modelByOp = new Map(this.sections.map(s => [s.operatorID, s.model]));
    return {
      ...base,
      operators: base.operators.map(op => {
        const live = modelByOp.get(op.operatorID);
        if (!live) return op;
        return { ...op, operatorProperties: { ...op.operatorProperties, ...live } };
      }),
    };
  }

  private fingerprintSchemas(enriched: Map<string, OperatorSchema>): string {
    return JSON.stringify(Array.from(enriched.entries()).map(([id, s]) => [id, s.jsonSchema]));
  }
}
