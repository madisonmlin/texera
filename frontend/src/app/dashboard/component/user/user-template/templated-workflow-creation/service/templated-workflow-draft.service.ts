import {Injectable} from "@angular/core";
import {OperatorSchema} from "../../../../../../workspace/types/operator-schema.interface";
import {WorkflowContent} from "../../../../../../common/type/workflow";
import {cloneDeep} from "lodash";
import {LogicalPlan} from "../../../../../../workspace/types/execute-workflow.interface";
import {OperatorPortSchemaMap} from "../../../../../../workspace/types/workflow-compiling.interface";
import {OperatorPredicate} from "../../../../../../workspace/types/workflow-common.interface";
import {
  WorkflowCompilingService
} from "../../../../../../workspace/service/compile-workflow/workflow-compiling.service";
import {
  WorkflowSchemaPropagationUtil
} from "../../../../../../workspace/service/compile-workflow/workflow-schema-propagation.util";
import {isEqual} from "lodash-es";

@Injectable()
export class TemplatedWorkflowDraftService {
  public operatorIdToProperties: Record<string, Record<string, any>> = {};
  public draftDynamicSchemas = new Map<string, OperatorSchema>();

  public initialize(content: WorkflowContent): void {
    this.operatorIdToProperties = {};
    this.draftDynamicSchemas.clear();

    content.operators.forEach(op => {
      this.operatorIdToProperties[op.operatorID] = cloneDeep(op.operatorProperties);
    });
  }

  public getOperatorProperties(operatorID: string): Record<string, Record<string, any>> {
    return this.operatorIdToProperties[operatorID];
  }

  public operatorPropertiesChanged(operatorID: string, operatorProperties: Record<string, any>): boolean {
    return !isEqual(this.operatorIdToProperties[operatorID], operatorProperties);
  }

  public getDraftDynamicSchema(operatorID: string): OperatorSchema | undefined {
    return this.draftDynamicSchemas.get(operatorID);
  }

  public hasDraftDynamicSchema(operatorID: string): boolean {
    return this.draftDynamicSchemas.has(operatorID);
  }

  public mergeSectionModel(operatorID: string, model: Record<string, any>): void {
    this.operatorIdToProperties[operatorID] = {
      ...this.operatorIdToProperties[operatorID],
      ...cloneDeep(model),
    };
  }

  public mergeSectionModelIfChanged(operatorID: string, model: Record<string, any>): boolean {
    const current = this.operatorIdToProperties[operatorID] ?? {};

    const next = {
      ...current,
      ...cloneDeep(model),
    };

    if (isEqual(current, next)) {
      return false;
    }

    this.operatorIdToProperties[operatorID] = next;
    return true;
  }

  public buildDraftLogicalPlan(content: WorkflowContent): LogicalPlan {
    return WorkflowSchemaPropagationUtil.buildLogicalPlan(content, this.operatorIdToProperties);
  }

  public applyDraftSchemaPropagationResult(params: {
    content: WorkflowContent;
    outputSchemas: Record<string, OperatorPortSchemaMap>;
    getBaseSchema: (op: OperatorPredicate) => OperatorSchema;
  }): Map<string, OperatorSchema> {
    const { content, outputSchemas, getBaseSchema } = params;

    content.operators.forEach(op => {
      const currentDynamicSchema =
        this.draftDynamicSchemas.get(op.operatorID) ?? getBaseSchema(op);

      const inputLinks = content.links.filter(
        link => link.target.operatorID === op.operatorID
      );

      const inputSchema = WorkflowSchemaPropagationUtil.extractInputPortSchemaMap({
        operatorID: op.operatorID,
        inputPortCount: op.inputPorts.length,
        inputLinks,
        outputSchemas,
      });

      const newDynamicSchema = inputSchema
        ? WorkflowCompilingService.setOperatorInputAttrs(currentDynamicSchema, inputSchema)
        : currentDynamicSchema.additionalMetadata.inputPorts.length > 0
          ? WorkflowCompilingService.restoreOperatorInputAttrs(currentDynamicSchema)
          : currentDynamicSchema;

      this.draftDynamicSchemas.set(op.operatorID, newDynamicSchema);
    });

    return this.draftDynamicSchemas;
  }
}
