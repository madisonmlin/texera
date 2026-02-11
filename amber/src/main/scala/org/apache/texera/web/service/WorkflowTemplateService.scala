package org.apache.texera.web.service

import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_TEMPLATES
import org.jooq.DSLContext
import play.api.libs.json.{Json, OFormat}

import javax.ws.rs.NotFoundException

case class WorkflowTemplate(
                                     tid: Int,
                                     name: String,
                                     description: String,
                                     content: String
                                   )

object WorkflowTemplate {
  implicit val format: OFormat[WorkflowTemplate] =
    Json.format[WorkflowTemplate]
}

class WorkflowTemplateService(context: DSLContext) {
  def retrieveWorkflowTemplate(tid: Integer): WorkflowTemplate = {
    val record = context
      .selectFrom(WORKFLOW_TEMPLATES)
      .where(WORKFLOW_TEMPLATES.TID.eq(tid))
      .fetchOne()

    if (record == null)
      throw new NotFoundException(s"Template $tid not found")

    WorkflowTemplate(
      tid = record.getTid,
      name = record.getName,
      description = record.getDescription,
      content = record.getContent
    )
  }
}
