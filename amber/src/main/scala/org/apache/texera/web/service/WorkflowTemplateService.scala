package org.apache.texera.web.service

import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_TEMPLATE
import org.apache.texera.dao.jooq.generated.tables.records.WorkflowTemplateRecord
import org.jooq.DSLContext
import play.api.libs.json.{Json, OFormat}

import javax.ws.rs.NotFoundException

case class WorkflowTemplateEntry(
                                     tid: Int,
                                     name: String,
                                     description: String,
                                     content: String,
                                     configurableParameters: String
                                   )

object WorkflowTemplateEntry {
  implicit val format: OFormat[WorkflowTemplateEntry] =
    Json.format[WorkflowTemplateEntry]
}

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
      configurableParameters = record.getConfigurableParameters
    )
  }
}
