package edu.uci.ics.texera.service.util

import java.io.{ByteArrayInputStream, OutputStream}

class MultipartUploadOutputStream(
  repoName: String,
  filePath: String,
  uploadId: String,
  partSize: Int
) extends OutputStream {

  private var currentPart = 1
  private val buffer = new Array[Byte](partSize)
  private var bufferPos = 0
  private var etags: List[(Int, String)] = Nil

  override def write(b: Int): Unit = {
    buffer(bufferPos) = b.toByte
    bufferPos += 1
    if (bufferPos >= partSize) flushBuffer()
  }

  override def write(b: Array[Byte], off: Int, len: Int): Unit = {
    var offset = off
    var remaining = len
    while (remaining > 0) {
      val space = partSize - bufferPos
      val toWrite = Math.min(space, remaining)
      System.arraycopy(b, offset, buffer, bufferPos, toWrite)
      bufferPos += toWrite
      offset += toWrite
      remaining -= toWrite
      if (bufferPos >= partSize) flushBuffer()
    }
  }

  private def flushBuffer(): Unit = {
    if (bufferPos == 0) return

    val partStream = new ByteArrayInputStream(buffer, 0, bufferPos)
    val etag = S3StorageClient.uploadPart(
      repoName,
      filePath,
      uploadId,
      currentPart,
      partStream,
      bufferPos.toLong
    )

    etags :+= (currentPart, etag)
    bufferPos = 0
    currentPart += 1
  }

  override def flush(): Unit = flushBuffer()

  override def close(): Unit = {
    flushBuffer()
    // Caller should use getEtags() after close()
  }

  def getEtags: List[(Int, String)] = etags
}
