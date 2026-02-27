package org.apache.texera.web.resource.dashboard.user.templated_workflow

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.tables.daos.WorkflowOfTemplateDao

import javax.annotation.security.RolesAllowed
import javax.ws.rs.core.MediaType
import javax.ws.rs.{POST, Path, Produces, QueryParam}
import org.apache.texera.web.service.{WorkflowCreationService, WorkflowTemplateService}
import org.apache.texera.dao.jooq.generated.tables.pojos._
import org.apache.texera.web.resource.dashboard.user.templated_workflow.TemplatedWorkflowResource._
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.scala.DefaultScalaModule
import com.fasterxml.jackson.databind.node.ObjectNode

case class BuildTemplatedWorkflowRequest(
                                          parameters: Map[String, Map[String, Any]]
                                        )

object TemplatedWorkflowResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val workflowOfTemplateDao = new WorkflowOfTemplateDao(
    context.configuration
  )

  private val mapper = new ObjectMapper().registerModule(DefaultScalaModule)

  private def applyParameters(
                               content: String,
                               params: Map[String, Map[String, Any]]
                             ): String = {

    val root = mapper.readTree(content)

    val operators = root.get("operators")

    operators.forEach { op =>
      val opId = op.get("operatorID").asText()
      print(opId);

      params.get(opId).foreach { paramMap =>
        val props = op.get("operatorProperties").asInstanceOf[ObjectNode]

        paramMap.foreach { case (key, value) =>
          props.putPOJO(key, value)
        }
      }
    }
    mapper.writeValueAsString(root)
  }

  private def buildTemplatedWorkflowRelation(tid: Integer, wid: Integer, parameters: String): Unit = {
    workflowOfTemplateDao.insert(new WorkflowOfTemplate(tid, wid, parameters))
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
  def buildTemplatedWorkflow(
                              @QueryParam("tid")tid: Integer,
                              request: BuildTemplatedWorkflowRequest,
                              @Auth user: SessionUser): Integer = {
    val template = workflowTemplateService.retrieveWorkflowTemplate(tid);
    val content = applyParameters(template.content, request.parameters);
    val workflow_template = new Workflow(
      null,                                // wid
      template.name,                       // name
      template.description,                // description
      content,                             // content
      null,                                // creationTime
      null,                                // lastModifiedTime
      false                                // isPublic
    )
    val workflow = workflowCreationService.createWorkflow(workflow_template, user);
    val wid = workflow.workflow.getWid;
    val mapper = new ObjectMapper().registerModule(DefaultScalaModule);
    val parameters = mapper.writeValueAsString(request.parameters);
    buildTemplatedWorkflowRelation(tid, wid, parameters);
    wid;
  }
}
