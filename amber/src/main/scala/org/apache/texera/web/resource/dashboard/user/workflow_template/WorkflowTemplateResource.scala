package org.apache.texera.web.resource.dashboard.user.workflow_template

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_TEMPLATES
import org.apache.texera.dao.jooq.generated.tables.daos.WorkflowTemplatesDao
import org.apache.texera.dao.jooq.generated.tables.pojos.User
import org.apache.texera.dao.jooq.generated.tables.pojos._

import javax.ws.rs.core.MediaType
import javax.ws.rs.{GET, NotFoundException, POST, Path, PathParam, Produces}
import scala.jdk.CollectionConverters._
import org.apache.texera.web.resource.dashboard.user.workflow_template.WorkflowTemplateResource._

import javax.annotation.security.RolesAllowed
import org.apache.texera.web.service.{WorkflowTemplate, WorkflowTemplateService}

object WorkflowTemplateResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val workflowTemplatesDao = new WorkflowTemplatesDao(context.configuration)

  def getWorkflowTemplateName(tid: Integer): String = {
    val workflow_template = workflowTemplatesDao.fetchOneByTid(tid)
    if (workflow_template == null) {
      throw new NotFoundException(s"Workflow template with id $tid not found")
    }
    workflow_template.getName
  }

  private def insertWorkflow(workflow_template: WorkflowTemplates, user: User): Unit = {
    workflowTemplatesDao.insert(workflow_template)
  }
}

@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/workflow-template")
class WorkflowTemplateResource extends LazyLogging {
  val workflowTemplateService = new WorkflowTemplateService(context);

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/add")
  def addWorkflowTemplate(workflow_template: WorkflowTemplates, @Auth sessionUser: SessionUser): Unit = {
    workflow_template.setTid(null)
    workflowTemplatesDao.insert(workflow_template)
  }

  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/list")
  def retrieveWorkflowTemplates(@Auth sessionUser: SessionUser): List[Map[String, Any]] = {
    context
      .select(WORKFLOW_TEMPLATES.TID, WORKFLOW_TEMPLATES.NAME)
      .from(WORKFLOW_TEMPLATES)
      .fetch()
      .asScala
      .map(record => Map(
        "tid" -> record.get(WORKFLOW_TEMPLATES.TID),
        "name" -> record.get(WORKFLOW_TEMPLATES.NAME)
      ))
      .toList
  }

  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{tid}")
  def retrieveWorkflowTemplate(@PathParam("tid") tid: Integer, @Auth sessionUser: SessionUser): WorkflowTemplate = {
    this.workflowTemplateService.retrieveWorkflowTemplate(tid);
  }
}