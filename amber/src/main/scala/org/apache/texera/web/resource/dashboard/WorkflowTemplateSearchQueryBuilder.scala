package org.apache.texera.web.resource.dashboard

import org.apache.texera.dao.jooq.generated.Tables.{USER, WORKFLOW_TEMPLATE}
import org.apache.texera.dao.jooq.generated.tables.pojos.WorkflowTemplate
import org.apache.texera.web.resource.dashboard.DashboardResource.DashboardClickableFileEntry
import org.apache.texera.web.resource.dashboard.FulltextSearchQueryUtils.{getContainsFilter, getDateFilter, getFullTextSearchFilter, getOperatorsFilter}
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
      tid = WORKFLOW_TEMPLATE.TID,
    )
  }

  override protected def constructFromClause(
                                              uid: Integer,
                                              params: DashboardResource.SearchQueryParams,
                                              includePublic: Boolean = false
                                            ): TableLike[_] = {
    val baseQuery = WORKFLOW_TEMPLATE
    baseQuery
  }

  override protected def constructWhereClause(
                                               uid: Integer,
                                               params: DashboardResource.SearchQueryParams
                                             ): Condition = {
    val splitKeywords = params.keywords.asScala
      .flatMap(_.split("[+\\-()<>~*@\"]"))
      .filter(_.nonEmpty)
      .toSeq
    getContainsFilter(params.workflowTemplateIds, WORKFLOW_TEMPLATE.TID)
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
      WORKFLOW_TEMPLATE.TID,
    )
  }

  override def toEntryImpl(
                            uid: Integer,
                            record: Record
                          ): DashboardResource.DashboardClickableFileEntry = {
    val dwt = DashboardWorkflowTemplate(
      true,
      record.into(USER).getName,
      record.into(WORKFLOW_TEMPLATE).into(classOf[WorkflowTemplate]),
      "READ",
      record.into(USER).getUid
    )
    DashboardClickableFileEntry(SearchQueryBuilder.WORKFLOW_TEMPLATE_RESOURCE_TYPE, workflowTemplate = Some(dwt))
  }
}
