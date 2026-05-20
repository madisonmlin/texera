package org.apache.texera.web.service

import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_OF_USER
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum
import org.apache.texera.dao.jooq.generated.tables.daos.{WorkflowDao, WorkflowOfUserDao, WorkflowUserAccessDao}
import org.apache.texera.dao.jooq.generated.tables.pojos.{User, Workflow, WorkflowOfUser, WorkflowUserAccess}
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowResource.{DashboardWorkflow, WorkflowWithPrivilege, context, insertWorkflow, workflowDao, workflowOfUserDao, workflowOfUserExists}
import org.apache.texera.web.resource.dashboard.user.workflow.{WorkflowAccessResource, WorkflowVersionResource}
import org.jooq.DSLContext

import javax.ws.rs.{BadRequestException, ForbiddenException}

class WorkflowPersistService(context: DSLContext) {
  final private lazy val workflowDao = new WorkflowDao(context.configuration)
  final private lazy val workflowOfUserDao = new WorkflowOfUserDao(
    context.configuration
  )
  final private lazy val workflowUserAccessDao = new WorkflowUserAccessDao(
    context.configuration()
  )

  def workflowOfUserExists(wid: Integer, uid: Integer): Boolean = {
    workflowOfUserDao.existsById(
      context
        .newRecord(WORKFLOW_OF_USER.UID, WORKFLOW_OF_USER.WID)
        .values(uid, wid)
    )
  }

  def insertWorkflow(workflow: Workflow, user: User, privilege: PrivilegeEnum=PrivilegeEnum.WRITE): Unit = {
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

  def retrieveWorkflow(wid: Integer, sessionUser: SessionUser): WorkflowWithPrivilege = {
    if (WorkflowAccessResource.hasReadAccess(wid, sessionUser.getUid)) {
      val workflow = workflowDao.fetchOneByWid(wid)
      WorkflowWithPrivilege(
        workflow.getName,
        workflow.getDescription,
        workflow.getWid,
        workflow.getContent,
        workflow.getCreationTime,
        workflow.getLastModifiedTime,
        workflow.getIsPublic,
        !WorkflowAccessResource.hasWriteAccess(wid, sessionUser.getUid)
      )
    } else {
      throw new ForbiddenException("No sufficient access privilege.")
    }
  }

  def persistWorkflow(workflow: Workflow, sessionUser: SessionUser): Workflow = {
    val user = sessionUser.getUser
    if (user == org.apache.texera.web.auth.GuestAuthFilter.GUEST) {
      throw new ForbiddenException("Guest user does not have access to db.")
    }

    if (workflowOfUserExists(workflow.getWid, user.getUid)) {
      WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = false)
      workflowDao.update(workflow)
    } else {
      if (!WorkflowAccessResource.hasReadAccess(workflow.getWid, user.getUid)) {
        // Check if this workflow exists in the database
        val workflowExistsInDb =
          workflow.getWid != null && workflowDao.existsById(workflow.getWid)
        if (workflowExistsInDb) {
          // User trying to persist an existing workflow without access - reject
          throw new ForbiddenException("No sufficient access privilege.")
        }
        // This is a new workflow being created (wid is null or doesn't exist in DB)
        workflow.setWid(null)
        insertWorkflow(workflow, user)
        WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = true)
      } else if (WorkflowAccessResource.hasWriteAccess(workflow.getWid, user.getUid)) {
        WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = false)
        // not owner but has write access
        workflowDao.update(workflow)
      } else {
        // not owner and no write access -> rejected
        throw new ForbiddenException("No sufficient access privilege.")
      }
    }

    val wid = workflow.getWid
    workflowDao.fetchOneByWid(wid)
  }
}
