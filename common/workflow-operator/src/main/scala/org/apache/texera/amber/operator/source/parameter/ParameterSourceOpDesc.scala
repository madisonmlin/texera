/*
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

package org.apache.texera.amber.operator.source.parameter

import com.fasterxml.jackson.annotation.{
  JsonCreator,
  JsonIgnoreProperties,
  JsonProperty,
  JsonPropertyDescription
}
import com.fasterxml.jackson.databind.annotation.JsonDeserialize
import com.kjetland.jackson.jsonSchema.annotations.JsonSchemaTitle
import org.apache.texera.amber.core.executor.OpExecWithClassName
import org.apache.texera.amber.core.tuple.{AttributeType, Schema}
import org.apache.texera.amber.core.virtualidentity.{ExecutionIdentity, WorkflowIdentity}
import org.apache.texera.amber.core.workflow.{OutputPort, PhysicalOp, SchemaPropagationFunc}
import org.apache.texera.amber.operator.metadata.{OperatorGroupConstants, OperatorInfo}
import org.apache.texera.amber.operator.source.SourceOperatorDescriptor
import org.apache.texera.amber.util.JSONUtils.objectMapper

import java.io.IOException
import java.net.URI

object ParameterSourceOpDesc {

  // File key/value pairs
  class FileKeyValuePair @JsonCreator() (
      @JsonProperty(value = "fileKey", required = true)
      @JsonSchemaTitle("File Key")
      var fileKey: String,
      @JsonProperty(required = true)
      @JsonSchemaTitle("File")
      @JsonDeserialize(contentAs = classOf[java.lang.String])
      var fileName: Option[String] = None
  )

  // Regular string key/value pairs
  class KeyValuePair @JsonCreator() (
      @JsonProperty(value = "key", required = true) var key: String,
      @JsonProperty(value = "value", required = true) var value: String
  )
}

@JsonIgnoreProperties(Array("fileEncoding", "fileTypeName", "Limit", "Offset"))
class ParameterSourceOpDesc extends SourceOperatorDescriptor {

  import org.apache.texera.amber.operator.source.parameter.ParameterSourceOpDesc._

  @JsonProperty(value = "filePairs", required = false)
  @JsonPropertyDescription("Multiple file key/value pairs")
  var filePairs: java.util.List[FileKeyValuePair] = new java.util.ArrayList[FileKeyValuePair]()

  @JsonProperty(value = "pairs", required = false)
  @JsonPropertyDescription("Multiple string key/value pairs")
  var pairs: java.util.List[KeyValuePair] = new java.util.ArrayList[KeyValuePair]()

  override def operatorInfo: OperatorInfo = {
    OperatorInfo(
      "Parameter",
      "Passes key/value pairs as a string",
      OperatorGroupConstants.INPUT_GROUP,
      List.empty,
      List(OutputPort()),
      supportReconfiguration = true
    )
  }

  @throws[IOException]
  override def getPhysicalOp(
      workflowId: WorkflowIdentity,
      executionId: ExecutionIdentity
  ): PhysicalOp = {

    PhysicalOp
      .sourcePhysicalOp(
        workflowId,
        executionId,
        operatorIdentifier,
        OpExecWithClassName(
          "org.apache.texera.amber.operator.source.parameter.ParameterSourceOpExec",
          objectMapper.writeValueAsString(this)
        )
      )
      .withInputPorts(operatorInfo.inputPorts)
      .withOutputPorts(operatorInfo.outputPorts)
      .withPropagateSchema(
        SchemaPropagationFunc(_ => Map(operatorInfo.outputPorts.head.id -> sourceSchema()))
      )
  }

  def setResolvedFileName(uri: URI): Unit = {
    // nothing
  }

  override def sourceSchema(): Schema = {
    Schema()
      .add("key", AttributeType.STRING)
      .add("value", AttributeType.STRING)
  }
}
