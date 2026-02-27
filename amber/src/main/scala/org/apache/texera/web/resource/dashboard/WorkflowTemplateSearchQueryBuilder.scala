package org.apache.texera.web.resource.dashboard

import org.apache.texera.dao.jooq.generated.Tables.{USER, WORKFLOW, WORKFLOW_TEMPLATE, WORKFLOW_TEMPLATE_OF_USER, WORKFLOW_TEMPLATE_USER_ACCESS}
import org.apache.texera.dao.jooq.generated.tables.pojos.WorkflowTemplate
import org.apache.texera.web.resource.dashboard.DashboardResource.DashboardClickableFileEntry
import org.apache.texera.web.resource.dashboard.FulltextSearchQueryUtils.{getContainsFilter, getDateFilter, getFullTextSearchFilter}
import org.apache.texera.web.resource.dashboard.user.workflow_template.WorkflowTemplateResource.DashboardWorkflowTemplate
import org.jooq.{Condition, GroupField, Record, TableLike}
import org.jooq.impl.DSL

import scala.jdk.CollectionConverters.CollectionHasAsScala

object WorkflowTemplateSearchQueryBuilder extends SearchQueryBuilder {

  override val mappedResourceSchema: UnifiedResourceSchema = {
    UnifiedResourceSchema(
      resourceType = DSL.inline(SearchQueryBuilder.WORKFLOW_TEMPLATE_RESOURCE_TYPE),
      name = WORKFLOW_TEMPLATE.NAME,
      description = WORKFLOW_TEMPLATE.DESCRIPTION,
      creationTime = WORKFLOW_TEMPLATE.CREATION_TIME,
      tid = WORKFLOW_TEMPLATE.TID,
      lastModifiedTime = WORKFLOW_TEMPLATE.LAST_MODIFIED_TIME,
      workflowTemplateUserAccess = WORKFLOW_TEMPLATE_USER_ACCESS.PRIVILEGE,
      uid = WORKFLOW_TEMPLATE_OF_USER.UID,
      ownerId = WORKFLOW_TEMPLATE_OF_USER.UID,
      userName = USER.NAME,
    )
  }

  override protected def constructFromClause(
                                              uid: Integer,
                                              params: DashboardResource.SearchQueryParams,
                                              includePublic: Boolean = false
                                            ): TableLike[_] = {
    val baseQuery = WORKFLOW_TEMPLATE
      .leftJoin(WORKFLOW_TEMPLATE_USER_ACCESS)
      .on(WORKFLOW_TEMPLATE_USER_ACCESS.TID.eq(WORKFLOW_TEMPLATE.TID))
      .leftJoin(WORKFLOW_TEMPLATE_OF_USER)
      .on(WORKFLOW_TEMPLATE_OF_USER.TID.eq(WORKFLOW_TEMPLATE.TID))
      .leftJoin(USER)
      .on(USER.UID.eq(WORKFLOW_TEMPLATE_OF_USER.UID))

    var condition: Condition = DSL.trueCondition()

    if (uid == null) {
      condition = DSL.falseCondition()
    } else {
      condition = WORKFLOW_TEMPLATE_USER_ACCESS.UID.eq(uid)
    }

    baseQuery.where(condition)
  }

  override protected def constructWhereClause(
                                               uid: Integer,
                                               params: DashboardResource.SearchQueryParams
                                             ): Condition = {
    val splitKeywords = params.keywords.asScala
      .flatMap(_.split("[+\\-()<>~*@\"]"))
      .filter(_.nonEmpty)
      .toSeq
      getDateFilter(
        params.creationStartDate,
        params.creationEndDate,
        WORKFLOW_TEMPLATE.CREATION_TIME
      )
      .and(
        getDateFilter(
          params.modifiedStartDate,
          params.modifiedEndDate,
          WORKFLOW_TEMPLATE.LAST_MODIFIED_TIME
        )
      )
      .and(getContainsFilter(params.workflowTemplateIds, WORKFLOW_TEMPLATE.TID))
      .and(
        getFullTextSearchFilter(
          splitKeywords,
          List(WORKFLOW_TEMPLATE.NAME, WORKFLOW_TEMPLATE.DESCRIPTION, WORKFLOW_TEMPLATE.CONTENT)
        )
      )
  }

  override protected def getGroupByFields: Seq[GroupField] = {
    Seq(
      WORKFLOW_TEMPLATE.NAME,
      WORKFLOW_TEMPLATE.DESCRIPTION,
      WORKFLOW_TEMPLATE.CREATION_TIME,
      WORKFLOW_TEMPLATE.TID,
      WORKFLOW_TEMPLATE.LAST_MODIFIED_TIME,
      WORKFLOW_TEMPLATE_USER_ACCESS.PRIVILEGE,
      WORKFLOW_TEMPLATE_OF_USER.UID,
      USER.NAME
    )
  }

  override def toEntryImpl(
                            uid: Integer,
                            record: Record
                          ): DashboardResource.DashboardClickableFileEntry = {
    val dwt = DashboardWorkflowTemplate(
      record.into(WORKFLOW_TEMPLATE_OF_USER).getUid.eq(uid),
      record.into(USER).getName,
      record.into(WORKFLOW_TEMPLATE).into(classOf[WorkflowTemplate]),
      record
        .get(WORKFLOW_TEMPLATE_USER_ACCESS.PRIVILEGE)
        .toString,
      record.into(USER).getUid
    )
    DashboardClickableFileEntry(SearchQueryBuilder.WORKFLOW_TEMPLATE_RESOURCE_TYPE, workflowTemplate = Some(dwt))
  }
}
