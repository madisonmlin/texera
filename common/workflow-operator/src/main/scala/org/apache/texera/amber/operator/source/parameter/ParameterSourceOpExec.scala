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

import org.apache.texera.amber.core.executor.SourceOperatorExecutor
import org.apache.texera.amber.core.tuple.TupleLike
import org.apache.texera.amber.util.JSONUtils.objectMapper
import scala.jdk.CollectionConverters._
import scala.collection.immutable.ArraySeq

class ParameterSourceOpExec private[parameter] (descString: String) extends SourceOperatorExecutor {
  val desc: ParameterSourceOpDesc =
    objectMapper.readValue(descString, classOf[ParameterSourceOpDesc])

  private var emitted = false

  override def produceTuple(): Iterator[TupleLike] = {
    if (emitted) Iterator.empty
    else {
      emitted = true

      val fileRows =
        desc.filePairs.asScala.iterator.map { p =>
          val k = Option(p.fileKey).getOrElse("")
          val v = p.fileName.map(_.toString).getOrElse("")
          TupleLike(ArraySeq(k, v): _*)
        }

      val kvRows =
        desc.pairs.asScala.iterator.map { p =>
          val k = Option(p.key).getOrElse("")
          val v = Option(p.value).getOrElse("")
          TupleLike(ArraySeq(k, v): _*)
        }

      fileRows ++ kvRows
    }
  }
}
