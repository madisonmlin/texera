package org.apache.texera.web.resource.dashboard.user.workflow_template

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.amber.core.storage.DocumentFactory
import org.apache.texera.amber.core.virtualidentity.ExecutionIdentity
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.Tables.{WORKFLOW, WORKFLOW_EXECUTIONS, WORKFLOW_TEMPLATE_OF_USER, WORKFLOW_TEMPLATE, WORKFLOW_VERSION}
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum
import org.apache.texera.dao.jooq.generated.tables.daos.{WorkflowTemplateDao, WorkflowTemplateOfUserDao, WorkflowTemplateUserAccessDao}
import org.apache.texera.dao.jooq.generated.tables.pojos.User
import org.apache.texera.dao.jooq.generated.tables.pojos._
import org.apache.texera.service.util.LargeBinaryManager
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowExecutionsResource
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowResource.{WorkflowIDs, context, workflowDao, workflowOfUserDao, workflowOfUserExists}
import org.apache.texera.web.resource.dashboard.user.workflow_template.WorkflowTemplateResource.context

import javax.ws.rs.core.MediaType
import javax.ws.rs.{BadRequestException, GET, NotFoundException, POST, Path, PathParam, Produces, QueryParam, WebApplicationException}
import scala.jdk.CollectionConverters._
import org.apache.texera.web.resource.dashboard.user.workflow_template.WorkflowTemplateResource._

import javax.annotation.security.RolesAllowed
import org.apache.texera.web.service.{WorkflowTemplateEntry, WorkflowTemplateService}

import scala.util.control.NonFatal

object WorkflowTemplateResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val workflowTemplateDao = new WorkflowTemplateDao(context.configuration)
  final private lazy val workflowTemplateOfUserDao = new WorkflowTemplateOfUserDao(context.configuration)
  final private lazy val workflowTemplateUserAccessDao = new WorkflowTemplateUserAccessDao(context.configuration())

  case class DashboardWorkflowTemplate(
                                isOwner: Boolean,
                                ownerName: String,
                                workflowTemplate: WorkflowTemplate,
                                accessLevel: String,
                                ownerId: Integer,
                              )

  case class WorkflowTemplateIDs(tids: List[Integer])

  private def workflowTemplateOfUserExists(tid: Integer, uid: Integer): Boolean = {
    workflowTemplateOfUserDao.existsById(
      context
        .newRecord(WORKFLOW_TEMPLATE_OF_USER.UID, WORKFLOW_TEMPLATE_OF_USER.TID)
        .values(uid, tid)
    )
  }

  def getWorkflowTemplateName(tid: Integer): String = {
    val workflow_template = workflowTemplateDao.fetchOneByTid(tid)
    if (workflow_template == null) {
      throw new NotFoundException(s"Workflow template with id $tid not found")
    }
    workflow_template.getName
  }

  private def insertWorkflowTemplate(workflow_template: WorkflowTemplate, user: User): Unit = {
    workflowTemplateDao.insert(workflow_template)
  }
}

@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/workflow-template")
class WorkflowTemplateResource extends LazyLogging {
  val workflowTemplateService = new WorkflowTemplateService(context);

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/add")
  def addWorkflowTemplate(workflow_template: WorkflowTemplate, @Auth sessionUser: SessionUser): Unit = {
    if (workflow_template.getTid != null) {
      throw new BadRequestException("Cannot create a new template with a provided id.")
    }
    workflowTemplateDao.insert(workflow_template)
    workflowTemplateOfUserDao.insert(new WorkflowTemplateOfUser(sessionUser.getUid, workflow_template.getTid))
    workflowTemplateUserAccessDao.insert(
      new WorkflowTemplateUserAccess(
        sessionUser.getUid,
        workflow_template.getTid,
        PrivilegeEnum.READ
      )
    )
  }

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/delete")
  def deleteWorkflowTemplate(workflowTemplateIDs: WorkflowTemplateIDs, @Auth sessionUser: SessionUser): Unit = {
    val user = sessionUser.getUser

    try {
      context.transaction { _ =>
        for (tid <- workflowTemplateIDs.tids) {
          if (workflowTemplateOfUserExists(tid, user.getUid)) {
            workflowTemplateDao.deleteById(tid)
          } else {
            throw new BadRequestException("The workflow template does not exist.")
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
  def retrieveWorkflowTemplate(@Auth sessionUser: SessionUser): List[Map[String, Any]] = {
    context
      .select(WORKFLOW_TEMPLATE.TID, WORKFLOW_TEMPLATE.NAME)
      .from(WORKFLOW_TEMPLATE)
      .fetch()
      .asScala
      .map(record => Map(
        "tid" -> record.get(WORKFLOW_TEMPLATE.TID),
        "name" -> record.get(WORKFLOW_TEMPLATE.NAME)
      ))
      .toList
  }

  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{tid}")
  def retrieveWorkflowTemplate(@PathParam("tid") tid: Integer, @Auth sessionUser: SessionUser): WorkflowTemplateEntry = {
    this.workflowTemplateService.retrieveWorkflowTemplate(tid);
  }

  @GET
  @Path("/size")
  @Produces(Array(MediaType.APPLICATION_JSON))
  def getSize(@QueryParam("tid") tids: java.util.List[Integer]): java.util.Map[Integer, Int] = {
    val result = new java.util.HashMap[Integer, Int]()
    if (tids != null && !tids.isEmpty) {
      workflowTemplateDao.ctx
        .selectFrom(WORKFLOW_TEMPLATE)
        .where(WORKFLOW_TEMPLATE.TID.in(tids))
        .fetch()
        .asScala
        .foreach { wf =>
          result.put(wf.getTid, wf.getContent.length)
        }
    }
    result
  }
}