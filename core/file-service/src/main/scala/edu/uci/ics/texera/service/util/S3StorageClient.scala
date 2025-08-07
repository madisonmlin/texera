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

package edu.uci.ics.texera.service.util

import edu.uci.ics.amber.config.StorageConfig
import edu.uci.ics.amber.core.storage.util.LakeFSStorageClient.{branchName, experimentalApi}
import io.lakefs.clients.sdk.model.{AbortPresignMultipartUpload, CompletePresignMultipartUpload, ObjectStats, PresignMultipartUpload, UploadPart}
import software.amazon.awssdk.auth.credentials.{AwsBasicCredentials, StaticCredentialsProvider}
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.{S3Client, S3Configuration}
import software.amazon.awssdk.services.s3.model._
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.UploadPartRequest

import java.io.InputStream
import java.net.URI
import java.time.Duration
import java.security.MessageDigest
import scala.jdk.CollectionConverters._

/**
  * S3Storage provides an abstraction for S3-compatible storage (e.g., MinIO).
  * - Uses credentials and endpoint from StorageConfig.
  * - Supports object upload, download, listing, and deletion.
  */
object S3StorageClient {
  val MINIMUM_NUM_OF_MULTIPART_S3_PART: Long = 5L * 1024 * 1024 // 5 MiB
  val MAXIMUM_NUM_OF_MULTIPART_S3_PARTS = 10_000
  val s3Credentials = AwsBasicCredentials.create(StorageConfig.s3Username, StorageConfig.s3Password)
  val lakefsCredentials = AwsBasicCredentials.create(StorageConfig.lakefsUsername, StorageConfig.lakefsPassword)

  // Initialize MinIO-compatible S3 Client
  private lazy val s3Client: S3Client = {
    S3Client
      .builder()
      .credentialsProvider(StaticCredentialsProvider.create(s3Credentials))
      .region(Region.of(StorageConfig.s3Region))
      .endpointOverride(java.net.URI.create(StorageConfig.s3Endpoint)) // MinIO URL
      .serviceConfiguration(
        S3Configuration.builder().pathStyleAccessEnabled(true).build()
      )
      .build()
  }

  val lakefsFullUri = new URI(StorageConfig.lakefsEndpoint)
  val lakefsBaseUri = new URI(
    lakefsFullUri.getScheme,
    null,
    lakefsFullUri.getHost,
    lakefsFullUri.getPort,
    null,
    null,
    null
  ) // Extract just the base (scheme + host + port)

  // Initialize S3-compatible S3 Client
  private lazy val s3LakefsClient: S3Client = {
    S3Client
      .builder()
      .credentialsProvider(StaticCredentialsProvider.create(lakefsCredentials))
      .region(Region.of(StorageConfig.s3Region))
      .endpointOverride(lakefsBaseUri) // LakeFS base URL ("http://localhost:8000" on local)
      .serviceConfiguration(
        S3Configuration.builder().pathStyleAccessEnabled(true).build()
      )
      .build()
  }

  // Initialize S3-compatible presigner for LakeFS S3 Gateway
  private lazy val s3Presigner: S3Presigner = {
    S3Presigner
      .builder()
      .credentialsProvider(StaticCredentialsProvider.create(s3Credentials))
      .region(Region.of(StorageConfig.s3Region))
      .endpointOverride(lakefsBaseUri) // LakeFS base URL ("http://localhost:8000" on local)
      .serviceConfiguration(
        S3Configuration.builder().pathStyleAccessEnabled(true).build()
      )
      .build()
  }

  /**
    * Checks if a directory (prefix) exists within an S3 bucket.
    *
    * @param bucketName The bucket name.
    * @param directoryPrefix The directory (prefix) to check (must end with `/`).
    * @return True if the directory contains at least one object, False otherwise.
    */
  def directoryExists(bucketName: String, directoryPrefix: String): Boolean = {
    // Ensure the prefix ends with `/` to correctly match directories
    val normalizedPrefix =
      if (directoryPrefix.endsWith("/")) directoryPrefix else directoryPrefix + "/"

    val listRequest = ListObjectsV2Request
      .builder()
      .bucket(bucketName)
      .prefix(normalizedPrefix)
      .maxKeys(1) // Only check if at least one object exists
      .build()

    val listResponse = s3Client.listObjectsV2(listRequest)
    !listResponse.contents().isEmpty // If contents exist, directory exists
  }

  /**
    * Creates an S3 bucket if it does not already exist.
    *
    * @param bucketName The name of the bucket to create.
    */
  def createBucketIfNotExist(bucketName: String): Unit = {
    try {
      // Check if the bucket already exists
      s3Client.headBucket(HeadBucketRequest.builder().bucket(bucketName).build())
    } catch {
      case _: NoSuchBucketException | _: S3Exception =>
        // If the bucket does not exist, create it
        val createBucketRequest = CreateBucketRequest.builder().bucket(bucketName).build()
        s3Client.createBucket(createBucketRequest)
        println(s"Bucket '$bucketName' created successfully.")
    }
  }

  /**
    * Deletes a directory (all objects under a given prefix) from a bucket.
    *
    * @param bucketName Target S3/MinIO bucket.
    * @param directoryPrefix The directory to delete (must end with `/`).
    */
  def deleteDirectory(bucketName: String, directoryPrefix: String): Unit = {
    // Ensure the directory prefix ends with `/` to avoid accidental deletions
    val prefix = if (directoryPrefix.endsWith("/")) directoryPrefix else directoryPrefix + "/"

    // List objects under the given prefix
    val listRequest = ListObjectsV2Request
      .builder()
      .bucket(bucketName)
      .prefix(prefix)
      .build()

    val listResponse = s3Client.listObjectsV2(listRequest)

    // Extract object keys
    val objectKeys = listResponse.contents().asScala.map(_.key())

    if (objectKeys.nonEmpty) {
      val objectsToDelete =
        objectKeys.map(key => ObjectIdentifier.builder().key(key).build()).asJava

      val deleteRequest = Delete
        .builder()
        .objects(objectsToDelete)
        .build()

      // Compute MD5 checksum for MinIO if required
      val md5Hash = MessageDigest
        .getInstance("MD5")
        .digest(deleteRequest.toString.getBytes("UTF-8"))

      // Convert object keys to S3 DeleteObjectsRequest format
      val deleteObjectsRequest = DeleteObjectsRequest
        .builder()
        .bucket(bucketName)
        .delete(deleteRequest)
        .build()

      // Perform batch deletion
      s3Client.deleteObjects(deleteObjectsRequest)
    }
  }

  /**
    * Retrieves file content from a specific commit and path.
    *
    * @param repoName            Repository name.
    * @param commitHash          Commit hash of the version.
    * @param filePath            Path to the file in the repository.
    * @param fileName            Name of the file downloaded via the presigned URL.
    * @param contentType         Type of the file downloaded via the presigned URL.
    * @param expirationMinutes   Duration in minutes that the presigned URL is valid.
    */
  def getFilePresignedUrl(
      repoName: String,
      commitHash: String,
      filePath: String,
      fileName: String,
      contentType: String,
      expirationMinutes: Long
  ): String = {
    val getObjectRequest = GetObjectRequest
      .builder()
      .bucket(repoName)
      .key(s"$commitHash/$filePath")
      .responseContentDisposition(s"attachment; filename='$fileName'")
      .responseContentType(contentType)
      .build()

    val presignRequest = GetObjectPresignRequest
      .builder()
      .signatureDuration(Duration.ofMinutes(expirationMinutes))
      .getObjectRequest(getObjectRequest)
      .build()

    val presignedUrl = s3Presigner.presignGetObject(presignRequest).url().toString
    s3Presigner.close()
    presignedUrl
  }

  /**
   * Initiates a presigned multipart upload for a file in LakeFS.
   *
   * @param repoName     Repository name.
   * @param filePath     File path within the repository.
   * @return             Multipart upload information.
   */
  def initiateMultipartUploads(
   repoName: String,
   filePath: String
  ): String = {

    val req = CreateMultipartUploadRequest.builder()
      .bucket(repoName)
      .key(filePath)
      .build()

    val res = s3LakefsClient.createMultipartUpload(req)
    res.uploadId()
  }

  /**
   * Uploads a part in a previously initiated multipart upload.
   *
   * @param repoName      Repository name.
   * @param filePath      File path within the repository.
   * @param uploadId      Upload ID of the previously initiated multipart upload.
   * @param partNumber    Number of the part being uploaded.
   * @param data          File data being uploaded in the part.
   * @param size          Size of the part.
   * @return              eTag of the uploaded part.
   */
  def uploadPart(
    repoName: String,
    filePath: String,
    uploadId: String,
    partNumber: Int,
    data: InputStream,
    size: Long
  ): String = {

    val req = UploadPartRequest.builder()
      .bucket(repoName)
      .key(filePath)
      .uploadId(uploadId)
      .partNumber(partNumber)
      .contentLength(size)
      .build()

    val res = s3LakefsClient.uploadPart(req, software.amazon.awssdk.core.sync.RequestBody.fromInputStream(data, size))
    res.eTag()
  }

  /**
   * Completes a previously initiated multipart upload.
   *
   * @param repoName        Repository name.
   * @param filePath        File path within the repository.
   * @param uploadId        Multipart upload ID.
   * @param partsList       List of (part number, ETag) pairs.
   * @return                Object metadata after completion.
   */
  def completeMultipartUploads(
    repoName: String,
    filePath: String,
    uploadId: String,
    partsList: List[(Int, String)]
  ): CompleteMultipartUploadResponse = {

    val completedParts = partsList.map { case (num, etag) =>
      CompletedPart.builder()
        .partNumber(num)
        .eTag(etag)
        .build()
    }

    val compReq = CompletedMultipartUpload.builder()
      .parts(completedParts: _*)
      .build()

    val req = CompleteMultipartUploadRequest.builder()
      .bucket(repoName)
      .key(filePath)
      .uploadId(uploadId)
      .multipartUpload(compReq)
      .build()

    s3LakefsClient.completeMultipartUpload(req)
  }

  /**
   * Aborts a multipart upload operation for a given file.
   *
   * @param repoName        Repository name.
   * @param filePath        File path within the repository.
   * @param uploadId        Multipart upload ID.
   * @param physicalAddress Physical address of the file.
   */
  def abortPresignedMultipartUploads(
    repoName: String,
    filePath: String,
    uploadId: String,
    physicalAddress: String
  ): Unit = {

    val req = AbortMultipartUploadRequest.builder()
      .bucket(repoName)
      .key(filePath)
      .uploadId(uploadId)
      .build()

    s3LakefsClient.abortMultipartUpload(req)
  }
}
