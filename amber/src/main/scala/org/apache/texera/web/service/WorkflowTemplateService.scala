package org.apache.texera.web.service

import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_TEMPLATE
import org.apache.texera.dao.jooq.generated.tables.records.WorkflowTemplateRecord
import org.jooq.DSLContext

import java.sql.Timestamp
import javax.ws.rs.NotFoundException

case class WorkflowTemplateEntry(
                                     tid: Int,
                                     name: String,
                                     description: String,
                                     content: String,
                                     creation_time: Timestamp,
                                     last_modified_time: Timestamp,
                                     configurableParameters: String
                                   )

class WorkflowTemplateService(context: DSLContext) {
  def retrieveWorkflowTemplate(tid: Integer): WorkflowTemplateEntry = {
    val record = context
      .selectFrom(WORKFLOW_TEMPLATE)
      .where(WORKFLOW_TEMPLATE.TID.eq(tid))
      .fetchOneInto(classOf[WorkflowTemplateRecord])

    if (record == null)
      throw new NotFoundException(s"Template $tid not found")

    WorkflowTemplateEntry(
      tid = record.getTid,
      name = record.getName,
      description = record.getDescription,
      content = record.getContent,
      creation_time = record.getCreationTime,
      last_modified_time = record.getLastModifiedTime,
      configurableParameters = record.getConfigurableParameters
    )
  }
}
