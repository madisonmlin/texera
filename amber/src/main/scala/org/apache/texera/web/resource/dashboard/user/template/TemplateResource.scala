package org.apache.texera.web.resource.dashboard.user.template

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.Tables.{TEMPLATE, TEMPLATE_OF_USER}
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum
import org.apache.texera.dao.jooq.generated.tables.daos.{TemplateDao, TemplateOfUserDao, TemplateUserAccessDao}
import org.apache.texera.dao.jooq.generated.tables.pojos.User
import org.apache.texera.dao.jooq.generated.tables.pojos._
import org.apache.texera.web.resource.dashboard.user.template.TemplateResource.{context, templateDao, templateOfUserDao}

import javax.ws.rs.core.MediaType
import javax.ws.rs.{BadRequestException, Consumes, ForbiddenException, GET, NotFoundException, POST, Path, PathParam, Produces, QueryParam, WebApplicationException}
import scala.jdk.CollectionConverters._
import org.apache.texera.web.resource.dashboard.user.template.TemplateResource._
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowAccessResource
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowAccessResource.hasReadAccess
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowResource.{DashboardWorkflow, WorkflowIDs, assignNewOperatorIds, context, workflowDao, workflowOfProjectDao, workflowOfProjectExists}

import javax.annotation.security.RolesAllowed
import org.apache.texera.web.service.{TemplateEntry, TemplateService}

import scala.collection.mutable.ListBuffer
import scala.util.control.NonFatal

object TemplateResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val templateDao = new TemplateDao(context.configuration)
  final private lazy val templateOfUserDao = new TemplateOfUserDao(context.configuration)
  final private lazy val templateUserAccessDao = new TemplateUserAccessDao(context.configuration())

  case class DashboardTemplate(
                                isOwner: Boolean,
                                ownerName: String,
                                template: Template,
                                accessLevel: String,
                                ownerId: Integer,
                              )

  case class TemplateIDs(tids: List[Integer])

  private def templateOfUserExists(tid: Integer, uid: Integer): Boolean = {
    templateOfUserDao.existsById(
      context
        .newRecord(TEMPLATE_OF_USER.UID, TEMPLATE_OF_USER.TID)
        .values(uid, tid)
    )
  }

  def getTemplateName(tid: Integer): String = {
    val template = templateDao.fetchOneByTid(tid)
    if (template == null) {
      throw new NotFoundException(s"Template with id $tid not found")
    }
    template.getName
  }

  private def insertTemplate(template: Template, user: User): Unit = {
    templateDao.insert(template)
  }
}

@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/template")
class TemplateResource extends LazyLogging {
  val templateService = new TemplateService(context);

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/create")
  def createTemplate(template: Template, @Auth sessionUser: SessionUser): DashboardTemplate = {
    val user = sessionUser.getUser
    if (template.getTid != null) {
      throw new BadRequestException("Cannot create a new template with a provided id.")
    }
    templateDao.insert(template)
    templateOfUserDao.insert(new TemplateOfUser(user.getUid, template.getTid))
    templateUserAccessDao.insert(
      new TemplateUserAccess(
        user.getUid,
        template.getTid,
        PrivilegeEnum.READ
      )
    )
    DashboardTemplate(
      isOwner = true,
      user.getName,
      templateDao.fetchOneByTid(template.getTid),
      PrivilegeEnum.WRITE.toString,
      user.getUid
    )
  }

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/delete")
  def deleteTemplate(templateIDs: TemplateIDs, @Auth sessionUser: SessionUser): Unit = {
    val user = sessionUser.getUser

    try {
      context.transaction { _ =>
        for (tid <- templateIDs.tids) {
          if (templateOfUserExists(tid, user.getUid)) {
            templateDao.deleteById(tid)
          } else {
            throw new BadRequestException("The template does not exist.")
          }
        }
      }
    } catch {
      case _: BadRequestException =>
      case NonFatal(exception)    => throw new WebApplicationException(exception)
    }
  }

  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/list")
  def retrieveTemplates(@Auth sessionUser: SessionUser): List[Map[String, Any]] = {
    context
      .select(TEMPLATE.TID, TEMPLATE.NAME)
      .from(TEMPLATE)
      .fetch()
      .asScala
      .map(record => Map(
        "tid" -> record.get(TEMPLATE.TID),
        "name" -> record.get(TEMPLATE.NAME)
      ))
      .toList
  }

  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{tid}")
  def retrieveTemplate(@PathParam("tid") tid: Integer, @Auth sessionUser: SessionUser): TemplateEntry = {
    this.templateService.retrieveTemplate(tid);
  }

  @POST
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/persist")
  def persistTemplate(template: Template, @Auth sessionUser: SessionUser): Template = {
    val user = sessionUser.getUser
    if (user == org.apache.texera.web.auth.GuestAuthFilter.GUEST) {
      throw new ForbiddenException("Guest user does not have access to db.")
    }

    if (templateOfUserExists(template.getTid, user.getUid)) {
//      TemplateVersionResource.insertVersion(template, insertingNewTemplate = false)
      templateDao.update(template)
    } else {
      if (!TemplateAccessResource.hasReadAccess(template.getTid, user.getUid)) {
        // Check if this template exists in the database
        val templateExistsInDb =
          template.getTid != null && templateDao.existsById(template.getTid)
        if (templateExistsInDb) {
          // User trying to persist an existing template without access - reject
          throw new ForbiddenException("No sufficient access privilege.")
        }
        // This is a new template being created (wid is null or doesn't exist in DB)
        template.setTid(null)
        insertTemplate(template, user)
//        TemplateVersionResource.insertVersion(template, insertingNewTemplate = true)
      } else if (TemplateAccessResource.hasWriteAccess(template.getTid, user.getUid)) {
//        TemplateVersionResource.insertVersion(template, insertingNewTemplate = false)
        // not owner but has write access
        templateDao.update(template)
      } else {
        // not owner and no write access -> rejected
        throw new ForbiddenException("No sufficient access privilege.")
      }
    }

    val tid = template.getTid
    templateDao.fetchOneByTid(tid)
  }

  /**
   * This method duplicates the target template, the new template name is appended with `_copy`
   *
   * @param template , a template to be duplicated
   * @return Template, which contains the generated tid if not provided
   */
  @POST
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/duplicate")
  def duplicateTemplate(
                         templateIDs: TemplateIDs,
                         @Auth sessionUser: SessionUser
                       ): List[DashboardTemplate] = {

    val user = sessionUser.getUser
    // do the permission check first
    for (tid <- templateIDs.tids) {
      if (!TemplateAccessResource.hasReadAccess(tid, user.getUid)) {
        throw new ForbiddenException("No sufficient access privilege.")
      }
    }

    val resultTemplates: ListBuffer[DashboardTemplate] = ListBuffer()
    // then start a transaction and do the duplication
    try {
      context.transaction { txConfig =>
        for (tid <- templateIDs.tids) {
          val oldTemplate: Template = templateDao.fetchOneByTid(tid)
          val newTemplate = createTemplate(
            new Template(
              null,
              oldTemplate.getName + "_copy",
              oldTemplate.getDescription,
              assignNewOperatorIds(oldTemplate.getContent),
              null,
              null,
              ""    // configurableParameters (no isPublic value, unlike Workflow)
            ),
            sessionUser
          )
          resultTemplates += newTemplate
        }
      }
    } catch {
      case _: BadRequestException | _: ForbiddenException =>
      case NonFatal(exception) =>
        throw new WebApplicationException(exception)
    }
    resultTemplates.toList
  }


  @GET
  @Path("/size")
  @Produces(Array(MediaType.APPLICATION_JSON))
  def getSize(@QueryParam("tid") tids: java.util.List[Integer]): java.util.Map[Integer, Int] = {
    val result = new java.util.HashMap[Integer, Int]()
    if (tids != null && !tids.isEmpty) {
      templateDao.ctx
        .selectFrom(TEMPLATE)
        .where(TEMPLATE.TID.in(tids))
        .fetch()
        .asScala
        .foreach { wf =>
          result.put(wf.getTid, wf.getContent.length)
        }
    }
    result
  }
}