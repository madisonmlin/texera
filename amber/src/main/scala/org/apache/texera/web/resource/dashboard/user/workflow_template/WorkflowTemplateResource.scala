package org.apache.texera.web.resource.dashboard.user.workflow_template

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_TEMPLATE
import org.apache.texera.dao.jooq.generated.tables.daos.WorkflowTemplateDao
import org.apache.texera.dao.jooq.generated.tables.pojos.User
import org.apache.texera.dao.jooq.generated.tables.pojos._

import javax.ws.rs.core.MediaType
import javax.ws.rs.{GET, NotFoundException, POST, Path, PathParam, Produces}
import scala.jdk.CollectionConverters._
import org.apache.texera.web.resource.dashboard.user.workflow_template.WorkflowTemplateResource._

import javax.annotation.security.RolesAllowed
import org.apache.texera.web.service.{WorkflowTemplateEntry, WorkflowTemplateService}

object WorkflowTemplateResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val workflowTemplateDao = new WorkflowTemplateDao(context.configuration)

  def getWorkflowTemplateName(tid: Integer): String = {
    val workflow_template = workflowTemplateDao.fetchOneByTid(tid)
    if (workflow_template == null) {
      throw new NotFoundException(s"Workflow template with id $tid not found")
    }
    workflow_template.getName
  }

  private def insertWorkflow(workflow_template: WorkflowTemplate, user: User): Unit = {
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
    workflow_template.setTid(null)
    workflowTemplateDao.insert(workflow_template)
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
}