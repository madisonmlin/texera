package org.apache.texera.web.resource.dashboard.user.templated_workflow

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.tables.daos.{WorkflowDao, WorkflowOfTemplateDao}

import javax.annotation.security.RolesAllowed
import javax.ws.rs.core.MediaType
import javax.ws.rs.{BadRequestException, ForbiddenException, NotFoundException, POST, Path, PathParam, Produces, QueryParam}
import org.apache.texera.web.service.{TemplateService, WorkflowPersistService}
import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_OF_TEMPLATE
import org.apache.texera.dao.jooq.generated.tables.pojos._
import org.apache.texera.web.resource.dashboard.user.templated_workflow.TemplatedWorkflowResource._
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.module.scala.DefaultScalaModule
import com.fasterxml.jackson.databind.node.{ArrayNode, ObjectNode}
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum

import scala.jdk.CollectionConverters._
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowVersionResource

class TemplatedWorkflowConfigurablePropertiesUpdateRequest {
  var operatorProperties: Map[String, Map[String, JsonNode]] = Map.empty
}

object TemplatedWorkflowResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val workflowDao = new WorkflowDao(context.configuration)
  final private lazy val workflowOfTemplateDao = new WorkflowOfTemplateDao(
    context.configuration
  )

  private def buildTemplatedWorkflowRelation(tid: Integer, wid: Integer, parameters: String): Unit = {
    workflowOfTemplateDao.insert(new WorkflowOfTemplate(tid, wid, parameters))
  }

  private def getTemplatedWorkflowIdIfExists(tid: Integer): Option[Integer] = {
    Option(
      context
      .select(WORKFLOW_OF_TEMPLATE.WID)
      .from(WORKFLOW_OF_TEMPLATE)
      .where(WORKFLOW_OF_TEMPLATE.TID.eq(tid))
      .fetchOneInto(classOf[Integer])
    )
  }

  private def getAllowedConfigurableProperties(operatorObject: ObjectNode): Set[String] = {
    val configurablePropertiesNode = operatorObject.get("configurableProperties")

    if (configurablePropertiesNode == null || configurablePropertiesNode.isNull) {
      return Set.empty
    }

    if (!configurablePropertiesNode.isArray) {
      throw new BadRequestException("Operator configurableProperties must be an array.")
    }

    configurablePropertiesNode
      .asInstanceOf[ArrayNode]
      .elements()
      .asScala
      .map { propertyNode =>
        if (!propertyNode.isTextual) {
          throw new BadRequestException("Each configurableProperties entry must be a string.")
        }

        propertyNode.asText()
      }
      .toSet
  }

  private def getOrCreateOperatorPropertiesObject(
                                                   operatorObject: ObjectNode,
                                                   objectMapper: ObjectMapper
                                                 ): ObjectNode = {
    val operatorPropertiesNode = operatorObject.get("operatorProperties")

    if (operatorPropertiesNode == null || operatorPropertiesNode.isNull) {
      val newOperatorProperties = objectMapper.createObjectNode()
      operatorObject.set[JsonNode]("operatorProperties", newOperatorProperties)
      return newOperatorProperties
    }

    if (!operatorPropertiesNode.isObject) {
      throw new BadRequestException("operatorProperties must be an object.")
    }

    operatorPropertiesNode.asInstanceOf[ObjectNode]
  }
}

@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/templated-workflow")
class TemplatedWorkflowResource extends LazyLogging{
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()

  private val templateService = new TemplateService(context)
  private val workflowPersistService = new WorkflowPersistService(context)

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/build")
  def buildTemplatedWorkflowIfNotExists(
                                         @QueryParam("tid") tid: Integer,
                                         @Auth user: SessionUser): Integer = {
    val wid: Option[Integer] = getTemplatedWorkflowIdIfExists(tid);
    val template = templateService.retrieveTemplate(tid);
    wid match {
      case Some(wid) =>
        val workflow = workflowDao.fetchOneByWid(wid)
        if (workflow == null) {
          throw new NotFoundException(s"Templated workflow $wid does not exist.")
        }
        wid

      case None =>
        val templated_workflow = new Workflow(
          null,                                // wid
          template.name,                       // name
          template.description,                // description
          template.content,                    // content
          null,                                // creationTime
          null,                                // lastModifiedTime
          false                                // isPublic
        )
        val workflow = workflowPersistService.createWorkflow(templated_workflow, user, privilege=PrivilegeEnum.READ);
        val wid = workflow.workflow.getWid;
        buildTemplatedWorkflowRelation(tid, wid, "");
        wid;
    }
  }

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}/update")
  def updateTemplatedWorkflowConfigurableProperties(
                                                     @PathParam("wid") wid: Integer,
                                                     request: TemplatedWorkflowConfigurablePropertiesUpdateRequest,
                                                     @Auth sessionUser: SessionUser
                                                   ): Workflow = {
    val user = sessionUser.getUser
    if (user == org.apache.texera.web.auth.GuestAuthFilter.GUEST) {
      throw new ForbiddenException("Guest user does not have access to db.")
    }

    if (wid == null) {
      throw new BadRequestException("Workflow id cannot be null.")
    }

    if (request == null || request.operatorProperties == null || request.operatorProperties.isEmpty) {
      throw new BadRequestException("No configurable properties were provided.")
    }

    val workflow = workflowDao.fetchOneByWid(wid)
    if (workflow == null) {
      throw new NotFoundException(s"Workflow $wid does not exist.")
    }

//    if (!isTemplatedWorkflow(wid)) {
//      throw new ForbiddenException("Workflow is not configurable through a template.")
//    }
//
//    if (!canConfigureTemplatedWorkflow(wid, user.getUid)) {
//      throw new ForbiddenException("No sufficient access privilege.")
//    }

    val objectMapper = new ObjectMapper()
    objectMapper.registerModule(DefaultScalaModule)

    val content = objectMapper.readTree(workflow.getContent)
    if (content == null || !content.isObject) {
      throw new BadRequestException("Workflow content is invalid.")
    }

    val contentObject = content.asInstanceOf[ObjectNode]
    val operatorsNode = contentObject.get("operators")

    if (operatorsNode == null || !operatorsNode.isArray) {
      throw new BadRequestException("Workflow content does not contain operators.")
    }

    val operatorsById: Map[String, ObjectNode] = operatorsNode
      .asInstanceOf[ArrayNode]
      .elements()
      .asScala
      .map { operatorNode =>
        if (!operatorNode.isObject) {
          throw new BadRequestException("Workflow contains an invalid operator.")
        }

        val operatorObject = operatorNode.asInstanceOf[ObjectNode]
        val operatorIdNode = operatorObject.get("operatorID")

        if (operatorIdNode == null || !operatorIdNode.isTextual) {
          throw new BadRequestException("Workflow contains an operator without operatorID.")
        }

        operatorIdNode.asText() -> operatorObject
      }
      .toMap

    request.operatorProperties.foreach {
      case (operatorId, submittedProperties) =>
        val operatorObject = operatorsById.getOrElse(
          operatorId,
          throw new BadRequestException(s"Operator $operatorId does not exist in workflow $wid.")
        )

        val allowedProperties = getAllowedConfigurableProperties(operatorObject)

        if (allowedProperties.isEmpty) {
          throw new BadRequestException(s"Operator $operatorId has no configurable properties.")
        }

        if (submittedProperties == null) {
          throw new BadRequestException(s"Submitted properties for operator $operatorId cannot be null.")
        }

        val operatorPropertiesObject = getOrCreateOperatorPropertiesObject(operatorObject, objectMapper)

        submittedProperties.foreach {
          case (propertyName, propertyValue) =>
            if (!allowedProperties.contains(propertyName)) {
              throw new BadRequestException(
                s"Property $propertyName is not configurable for operator $operatorId."
              )
            }

            operatorPropertiesObject.set[JsonNode](propertyName, propertyValue)
        }
    }

    workflow.setContent(objectMapper.writeValueAsString(contentObject))

    WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = false)
    workflowDao.update(workflow)

    workflowDao.fetchOneByWid(wid)
  }
}
