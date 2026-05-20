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
import { HttpClient } from "@angular/common/http";
import { isEqual } from "lodash-es";
import { debounceTime, forkJoin, merge, Observable, of, Subscription, tap } from "rxjs";
import { cloneDeep } from "lodash";
import { ActivatedRoute } from "@angular/router";
import { TemplateService } from "../../../../service/user/template/template.service";
import { OperatorMetadataService } from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import { OperatorPredicate } from "../../../../../workspace/types/workflow-common.interface";
import { WorkflowCompilingService } from "../../../../../workspace/service/compile-workflow/workflow-compiling.service";
import { DynamicSchemaService } from "../../../../../workspace/service/dynamic-schema/dynamic-schema.service";
import { OperatorSchema } from "../../../../../workspace/types/operator-schema.interface";

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

  // Subscription that fans in value-changes from every section's form and pushes them into
  // workflowActionService so the regular WorkflowCompilingService → DynamicSchemaService
  // pipeline takes care of recompiling + propagating schemas. Recreated whenever sections
  // are rebuilt because each rebuild creates new FormGroup instances.
  private formChangesSub: Subscription | undefined;
  // Re-entrancy guard: when we push our model values into workflowActionService, the resulting
  // schema-change events would otherwise cause us to rebuild sections (and re-emit value
  // changes that we'd push back in). Set during the push, cleared after a microtask.
  private suppressFormPropagation = false;

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private templateService: TemplateService,
    private workflowPersistService: WorkflowPersistService,
    private operatorMetadataService: OperatorMetadataService,
    private dynamicSchemaService: DynamicSchemaService,
    // injected to ensure the singleton WorkflowCompilingService is instantiated (it subscribes
    // to texera graph streams in its constructor, which is what triggers /compile + schema
    // propagation when we reloadWorkflow / setOperatorProperty below)
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

      // Seed the model from the live graph (which holds the user's latest pushed values),
      // not the original template — otherwise rebuilds triggered by schema-change events
      // would reset the user's just-picked file/value back to the saved template value.
      const livePropsSource: Record<string, any> = this.workflowActionService.getTexeraGraph().hasOperator(op.operatorID)
        ? this.workflowActionService.getTexeraGraph().getOperator(op.operatorID).operatorProperties
        : op.operatorProperties;
      const model: Record<string, any> = {};
      configurableKeys.forEach(key => {
        model[key] = cloneDeep(livePropsSource?.[key]);
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
        template.content.operators.forEach(op => {
          this.operatorIdToProperties[op.operatorID] = cloneDeep(op.operatorProperties);
        });

        // Hand the template content to the same plumbing the live editor uses:
        // WorkflowActionService owns the texera graph, WorkflowCompilingService listens to
        // it and re-compiles on every property change, and DynamicSchemaService stores the
        // resulting enum-populated dynamic schema for each operator. We subscribe to that
        // stream to know when to rebuild our configurable-properties form so attribute
        // dropdowns reflect the latest upstream schema.
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

        this.dynamicSchemaService
          .getOperatorDynamicSchemaChangedStream()
          .pipe(debounceTime(50), untilDestroyed(this))
          .subscribe(() => this.rebuildSectionsFromDynamicSchemas());
      });
  }

  /**
   * Re-create the configurable-section list using whatever DynamicSchemaService currently has
   * for each operator. After a /compile cycle completes, the dynamic schema for each operator
   * has the latest enum (e.g. column names from the upstream CSVFileScan) baked into the
   * attribute-selector properties — so reconverting via FormlyJsonschema yields select-typed
   * formly fields without any custom enum injection.
   */
  private rebuildSectionsFromDynamicSchemas(): void {
    if (!this.template) return;
    this.formChangesSub?.unsubscribe();
    const enriched = new Map<string, OperatorSchema>();
    this.template.operators.forEach(op => {
      if (this.dynamicSchemaService.dynamicSchemaExists(op.operatorID)) {
        enriched.set(op.operatorID, this.dynamicSchemaService.getDynamicSchema(op.operatorID));
      }
    });
    this.sections = this.buildSectionsFromTemplate({ content: this.template }, enriched);
    this.subscribeToFormChanges();
  }

  /**
   * Pipe user edits from each section's form into workflowActionService.setOperatorProperty,
   * which triggers the regular compile pipeline. We suppress propagation during the push
   * itself so the resulting dynamic-schema-changed events don't bounce back into another
   * setOperatorProperty round-trip.
   */
  private subscribeToFormChanges(): void {
    if (this.sections.length === 0) return;
    this.formChangesSub = merge(...this.sections.map(s => s.form.valueChanges))
      .pipe(debounceTime(300), untilDestroyed(this))
      .subscribe(() => this.pushFormChangesToGraph());
  }

  private pushFormChangesToGraph(): void {
    this.suppressFormPropagation = true;
    try {
      this.sections.forEach(section => {
        const graphOp = this.workflowActionService.getTexeraGraph().getOperator(section.operatorID);
        if (!graphOp) return;
        const merged = { ...graphOp.operatorProperties, ...section.model };
        if (!isEqual(graphOp.operatorProperties, merged)) {
          this.workflowActionService.setOperatorProperty(section.operatorID, merged);
        }
      });
    } finally {
      Promise.resolve().then(() => (this.suppressFormPropagation = false));
    }
  }
}
