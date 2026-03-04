package org.apache.texera.web.resource.dashboard

import org.apache.texera.dao.jooq.generated.Tables.{USER, TEMPLATE, TEMPLATE_OF_USER, TEMPLATE_USER_ACCESS}
import org.apache.texera.dao.jooq.generated.tables.pojos.Template
import org.apache.texera.web.resource.dashboard.DashboardResource.DashboardClickableFileEntry
import org.apache.texera.web.resource.dashboard.FulltextSearchQueryUtils.{getContainsFilter, getDateFilter, getFullTextSearchFilter}
import org.apache.texera.web.resource.dashboard.user.template.TemplateResource.DashboardTemplate
import org.jooq.{Condition, GroupField, Record, TableLike}
import org.jooq.impl.DSL

import scala.jdk.CollectionConverters.CollectionHasAsScala

object TemplateSearchQueryBuilder extends SearchQueryBuilder {

  override val mappedResourceSchema: UnifiedResourceSchema = {
    UnifiedResourceSchema(
      resourceType = DSL.inline(SearchQueryBuilder.TEMPLATE_RESOURCE_TYPE),
      name = TEMPLATE.NAME,
      description = TEMPLATE.DESCRIPTION,
      creationTime = TEMPLATE.CREATION_TIME,
      tid = TEMPLATE.TID,
      lastModifiedTime = TEMPLATE.LAST_MODIFIED_TIME,
      templateUserAccess = TEMPLATE_USER_ACCESS.PRIVILEGE,
      uid = TEMPLATE_OF_USER.UID,
      ownerId = TEMPLATE_OF_USER.UID,
      userName = USER.NAME,
    )
  }

  override protected def constructFromClause(
                                              uid: Integer,
                                              params: DashboardResource.SearchQueryParams,
                                              includePublic: Boolean = false
                                            ): TableLike[_] = {
    val baseQuery = TEMPLATE
      .leftJoin(TEMPLATE_USER_ACCESS)
      .on(TEMPLATE_USER_ACCESS.TID.eq(TEMPLATE.TID))
      .leftJoin(TEMPLATE_OF_USER)
      .on(TEMPLATE_OF_USER.TID.eq(TEMPLATE.TID))
      .leftJoin(USER)
      .on(USER.UID.eq(TEMPLATE_OF_USER.UID))

    var condition: Condition = DSL.trueCondition()

    if (uid == null) {
      condition = DSL.falseCondition()
    } else {
      condition = TEMPLATE_USER_ACCESS.UID.eq(uid)
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
        TEMPLATE.CREATION_TIME
      )
      .and(
        getDateFilter(
          params.modifiedStartDate,
          params.modifiedEndDate,
          TEMPLATE.LAST_MODIFIED_TIME
        )
      )
      .and(getContainsFilter(params.templateIds, TEMPLATE.TID))
      .and(
        getFullTextSearchFilter(
          splitKeywords,
          List(TEMPLATE.NAME, TEMPLATE.DESCRIPTION, TEMPLATE.CONTENT)
        )
      )
  }

  override protected def getGroupByFields: Seq[GroupField] = {
    Seq(
      TEMPLATE.NAME,
      TEMPLATE.DESCRIPTION,
      TEMPLATE.CREATION_TIME,
      TEMPLATE.TID,
      TEMPLATE.LAST_MODIFIED_TIME,
      TEMPLATE_USER_ACCESS.PRIVILEGE,
      TEMPLATE_OF_USER.UID,
      USER.NAME
    )
  }

  override def toEntryImpl(
                            uid: Integer,
                            record: Record
                          ): DashboardResource.DashboardClickableFileEntry = {
    val dwt = DashboardTemplate(
      record.into(TEMPLATE_OF_USER).getUid.eq(uid),
      record.into(USER).getName,
      record.into(TEMPLATE).into(classOf[Template]),
      record
        .get(TEMPLATE_USER_ACCESS.PRIVILEGE)
        .toString,
      record.into(USER).getUid
    )
    DashboardClickableFileEntry(SearchQueryBuilder.TEMPLATE_RESOURCE_TYPE, template = Some(dwt))
  }
}
