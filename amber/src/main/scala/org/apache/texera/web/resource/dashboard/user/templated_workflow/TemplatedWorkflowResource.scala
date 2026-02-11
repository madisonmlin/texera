package org.apache.texera.web.resource.dashboard.user.templated_workflow

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.tables.daos.WorkflowToTemplateDao

import javax.annotation.security.RolesAllowed
import javax.ws.rs.core.MediaType
import javax.ws.rs.{POST, Path, Produces, QueryParam}
import org.apache.texera.web.service.{WorkflowCreationService, WorkflowTemplateService}
import org.apache.texera.dao.jooq.generated.tables.pojos._
import org.apache.texera.web.resource.dashboard.user.templated_workflow.TemplatedWorkflowResource._

object TemplatedWorkflowResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val workflowToTemplateDao = new WorkflowToTemplateDao(
    context.configuration
  )

  private def buildTemplatedWorkflowRelation(tid: Integer, wid: Integer): Unit = {
    workflowToTemplateDao.insert(new WorkflowToTemplate(tid, wid))
  }
}

@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/templated-workflow")
class TemplatedWorkflowResource extends LazyLogging{
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()

  private val workflowTemplateService = new WorkflowTemplateService(context)
  private val workflowCreationService = new WorkflowCreationService(context)

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/build")
  def buildTemplatedWorkflow(@QueryParam("tid")tid: Integer, @Auth user: SessionUser): Integer = {
    val template = workflowTemplateService.retrieveWorkflowTemplate(tid);
    val workflow_template = new Workflow(
      null,                                // wid
      "scgpt_template",                    // name
      "",                                  // description
      template.content,                    // content
      null,                                // creationTime
      null,                                // lastModifiedTime
      false                                // isPublic
    )
    val workflow = workflowCreationService.createWorkflow(workflow_template, user);
    val wid = workflow.workflow.getWid
    buildTemplatedWorkflowRelation(tid, wid);
    wid;
  }
}
