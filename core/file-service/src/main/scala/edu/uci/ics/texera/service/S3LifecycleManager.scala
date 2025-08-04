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

package edu.uci.ics.texera.service

import scala.jdk.CollectionConverters._
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model._
import edu.uci.ics.amber.config.StorageConfig

object S3LifecycleManager {
  private val BucketName = StorageConfig.lakefsBucketName
  private val RequiredRules: List[LifecycleRule] = List(
    deleteTempZipsLifecycleRule()
  )

  def configLifecycleRules(s3Client: S3Client): Unit = {
    val existingRules = getExistingLifecycleRules(s3Client)

    val requiredIds = RequiredRules.map(_.id()).toSet
    val existingIds = existingRules.map(_.id()).toSet

    val missingAny = !requiredIds.subsetOf(existingIds)

    if (missingAny) {
      val config = BucketLifecycleConfiguration
        .builder()
        .rules(RequiredRules.asJava)
        .build()

      s3Client.putBucketLifecycleConfiguration(
        PutBucketLifecycleConfigurationRequest
          .builder()
          .bucket(BucketName)
          .lifecycleConfiguration(config)
          .build()
      )
    }
  }

  private def getExistingLifecycleRules(s3Client: S3Client): List[LifecycleRule] = {
    try {
      val response = s3Client.getBucketLifecycleConfiguration(
        GetBucketLifecycleConfigurationRequest.builder().bucket(BucketName).build()
      )
      Option(response.rules()).map(_.asScala.toList).getOrElse(Nil)
    } catch {
      case ex: S3Exception if ex.awsErrorDetails().errorCode() == "NoSuchLifecycleConfiguration" =>
        Nil
    }
  }

  private def deleteTempZipsLifecycleRule(): LifecycleRule = {
    LifecycleRule
      .builder()
      .id("delete-temp-zips")
      .filter(LifecycleRuleFilter.builder().prefix("tmp/zips/").build())
      .expiration(LifecycleExpiration.builder().days(1).build())
      .status(ExpirationStatus.ENABLED)
      .build()
  }
}
