package org.apache.texera.web.service

import org.apache.texera.dao.jooq.generated.Tables.TEMPLATE
import org.apache.texera.dao.jooq.generated.tables.records.TemplateRecord
import org.jooq.DSLContext

import java.sql.Timestamp
import javax.ws.rs.NotFoundException

case class TemplateEntry(
                                     tid: Int,
                                     name: String,
                                     description: String,
                                     content: String,
                                     creation_time: Timestamp,
                                     last_modified_time: Timestamp,
                                     configurableParameters: String
                                   )

class TemplateService(context: DSLContext) {
  def retrieveTemplate(tid: Integer): TemplateEntry = {
    val record = context
      .selectFrom(TEMPLATE)
      .where(TEMPLATE.TID.eq(tid))
      .fetchOneInto(classOf[TemplateRecord])

    if (record == null)
      throw new NotFoundException(s"Template $tid not found")

    TemplateEntry(
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
