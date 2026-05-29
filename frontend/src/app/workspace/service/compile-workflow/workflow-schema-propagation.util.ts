import {OperatorLink} from "../../types/workflow-common.interface";
import {OperatorPortSchemaMap, PortSchema} from "../../types/workflow-compiling.interface";
import {serializePortIdentity} from "../../../common/util/port-identity-serde";
import {parseLogicalOperatorPortID} from "../../../common/util/logical-operator-port-serde";
import {areAllPortSchemasEqual} from "../../../common/util/workflow-compilation-utils";
import {WorkflowContent} from "../../../common/type/workflow";
import {LogicalLink, LogicalOperator, LogicalPlan} from "../../types/execute-workflow.interface";

export class WorkflowSchemaPropagationUtil {
  public static extractInputPortSchemaMap(params: {
    operatorID: string;
    inputPortCount: number;
    inputLinks: OperatorLink[];
    outputSchemas: Record<string, OperatorPortSchemaMap>;
    onSchemaConflict?: (portIndex: number, schemas: (PortSchema | undefined)[]) => void;
  }): OperatorPortSchemaMap | undefined {
    const { inputPortCount, inputLinks, outputSchemas, onSchemaConflict } = params;

    if (!inputLinks.length) {
      return undefined;
    }

    const inputPortSchemaMap = new Map<string, PortSchema | undefined>();

    for (let portIndex = 0; portIndex < inputPortCount; portIndex++) {
      const portId = serializePortIdentity({ id: portIndex, internal: false });
      inputPortSchemaMap.set(portId, undefined);

      const linksToThisPort = inputLinks.filter(link => {
        const inputPort = parseLogicalOperatorPortID(link.target.portID);
        return inputPort?.portNumber === portIndex;
      });

      if (linksToThisPort.length === 0) {
        continue;
      }

      const schemas = linksToThisPort.map(link => {
        const sourcePortSchemaMap = outputSchemas[link.source.operatorID];
        if (!sourcePortSchemaMap) {
          return undefined;
        }

        const outputPort = parseLogicalOperatorPortID(link.source.portID);
        if (!outputPort) {
          return undefined;
        }

        return sourcePortSchemaMap[
          serializePortIdentity({ id: outputPort.portNumber, internal: false })
          ];
      });

      if (schemas.length > 1 && !areAllPortSchemasEqual(schemas)) {
        onSchemaConflict?.(portIndex, schemas);
        return undefined;
      }

      inputPortSchemaMap.set(portId, schemas[0]);
    }

    return inputPortSchemaMap.size ? Object.fromEntries(inputPortSchemaMap) : undefined;
  }

  public static toLogicalLink(content: WorkflowContent, link: OperatorLink): LogicalLink | undefined {
    const source = content.operators.find(op => op.operatorID === link.source.operatorID);
    const target = content.operators.find(op => op.operatorID === link.target.operatorID);

    if (!source || !target) {
      return undefined;
    }

    const outputPortIdx = source.outputPorts.findIndex(port => port.portID === link.source.portID);
    const inputPortIdx = target.inputPorts.findIndex(port => port.portID === link.target.portID);

    if (outputPortIdx < 0 || inputPortIdx < 0) {
      return undefined;
    }

    return {
      fromOpId: link.source.operatorID,
      fromPortId: { id: outputPortIdx, internal: false },
      toOpId: link.target.operatorID,
      toPortId: { id: inputPortIdx, internal: false },
    };
  }

  public static buildLogicalPlan(
    content: WorkflowContent,
    operatorIdToProperties: Record<string, Record<string, any>>
  ): LogicalPlan {
    const operators: LogicalOperator[] = content.operators.map(op => ({
      ...(operatorIdToProperties[op.operatorID] ?? op.operatorProperties),
      operatorID: op.operatorID,
      operatorType: op.operatorType,
      inputPorts: op.inputPorts,
      outputPorts: op.outputPorts,
    }));

    const links: LogicalLink[] = content.links
      .map(link => this.toLogicalLink(content, link))
      .filter((link): link is LogicalLink => link !== undefined);

    return {
      operators,
      links,
      opsToViewResult: [],
      opsToReuseResult: [],
    };
  }
}
