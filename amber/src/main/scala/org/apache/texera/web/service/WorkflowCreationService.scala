package org.apache.texera.web.service

import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum
import org.apache.texera.dao.jooq.generated.tables.daos.{WorkflowDao, WorkflowOfUserDao, WorkflowUserAccessDao}
import org.apache.texera.dao.jooq.generated.tables.pojos.{User, Workflow, WorkflowOfUser, WorkflowUserAccess}
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowResource.DashboardWorkflow
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowVersionResource
import org.jooq.DSLContext

import javax.ws.rs.BadRequestException

class WorkflowCreationService(context: DSLContext) {
  final private lazy val workflowDao = new WorkflowDao(context.configuration)
  final private lazy val workflowOfUserDao = new WorkflowOfUserDao(
    context.configuration
  )
  final private lazy val workflowUserAccessDao = new WorkflowUserAccessDao(
    context.configuration()
  )

  def insertWorkflow(workflow: Workflow, user: User, privilege: PrivilegeEnum): Unit = {
    workflowDao.insert(workflow)
    workflowOfUserDao.insert(new WorkflowOfUser(user.getUid, workflow.getWid))
    workflowUserAccessDao.insert(
      new WorkflowUserAccess(
        user.getUid,
        workflow.getWid,
        privilege
      )
    )
  }

  def createWorkflow(workflow: Workflow, sessionUser: SessionUser, privilege: PrivilegeEnum=PrivilegeEnum.WRITE): DashboardWorkflow = {
    val user = sessionUser.getUser
    if (workflow.getWid != null) {
      throw new BadRequestException("Cannot create a new workflow with a provided id.")
    } else {
      this.insertWorkflow(workflow, user, privilege)
      WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = true)
      DashboardWorkflow(
        isOwner = true,
        privilege.toString,
        user.getName,
        workflowDao.fetchOneByWid(workflow.getWid),
        List[Integer](),
        user.getUid
      )
    }
  }
}
