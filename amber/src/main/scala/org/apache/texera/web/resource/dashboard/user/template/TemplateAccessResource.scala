/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package org.apache.texera.web.resource.dashboard.user.template

import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.Tables._
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum
import org.apache.texera.dao.jooq.generated.tables.daos.{
  UserDao,
  TemplateOfUserDao,
  TemplateUserAccessDao
}
import org.apache.texera.dao.jooq.generated.tables.pojos.TemplateUserAccess
import org.apache.texera.web.model.common.AccessEntry
import org.apache.texera.web.resource.dashboard.user.template.TemplateAccessResource.{
  context,
  getPrivilege,
  hasWriteAccess
}
import org.jooq.DSLContext

import java.util
import javax.annotation.security.RolesAllowed
import javax.ws.rs._
import javax.ws.rs.core.MediaType

object TemplateAccessResource {
  private def context: DSLContext =
    SqlServer
      .getInstance()
      .createDSLContext()

  /**
   * Identifies whether the given user has read-only access over the given template
   *
   * @param tid template id
   * @param uid user id, works with template id as primary keys in database
   * @return boolean value indicating yes/no
   */
  def hasReadAccess(tid: Integer, uid: Integer): Boolean = {
    getPrivilege(tid, uid).eq(PrivilegeEnum.READ) || hasWriteAccess(
      tid,
      uid
    )
  }

  /**
   * Identifies whether the given user has write access over the given template
   *
   * @param tid template id
   * @param uid user id, works with template id as primary keys in database
   * @return boolean value indicating yes/no
   */
  def hasWriteAccess(tid: Integer, uid: Integer): Boolean = {
    getPrivilege(tid, uid).eq(PrivilegeEnum.WRITE)
  }

  /**
   * @param tid template id
   * @param uid user id, works with template id as primary keys in database
   * @return PrivilegeEnum value indicating NONE/READ/WRITE
   */
  def getPrivilege(tid: Integer, uid: Integer): PrivilegeEnum = {
    val access = context
      .select()
      .from(TEMPLATE_USER_ACCESS)
      .where(TEMPLATE_USER_ACCESS.TID.eq(tid).and(TEMPLATE_USER_ACCESS.UID.eq(uid)))
      .fetchOneInto(classOf[TemplateUserAccess])

    access.getPrivilege
  }
}

@Produces(Array(MediaType.APPLICATION_JSON))
@RolesAllowed(Array("REGULAR", "ADMIN"))
@Path("/access/template")
class TemplateAccessResource() {
  final private val userDao = new UserDao(context.configuration())
  final private val templateOfUserDao = new TemplateOfUserDao(context.configuration)
  final private val templateUserAccessDao = new TemplateUserAccessDao(context.configuration)

  /**
   * This method returns the owner of a template
   *
   * @param tid ,  template id
   * @return ownerEmail,  the owner's email
   */
  @GET
  @Path("/owner/{tid}")
  def getOwner(@PathParam("tid") tid: Integer): String = {
    userDao.fetchOneByUid(templateOfUserDao.fetchByTid(tid).get(0).getUid).getEmail
  }

  /**
   * Returns information about all current shared access of the given template
   *
   * @param tid template id
   * @return a List of email/name/permission
   */
  @GET
  @Path("/list/{tid}")
  def getAccessList(
                     @PathParam("tid") tid: Integer
                   ): util.List[AccessEntry] = {
    context
      .select(
        USER.EMAIL,
        USER.NAME,
        TEMPLATE_USER_ACCESS.PRIVILEGE
      )
      .from(TEMPLATE_USER_ACCESS)
      .join(USER)
      .on(USER.UID.eq(TEMPLATE_USER_ACCESS.UID))
      .where(
        TEMPLATE_USER_ACCESS.TID
          .eq(tid)
          .and(TEMPLATE_USER_ACCESS.UID.notEqual(templateOfUserDao.fetchByTid(tid).get(0).getUid))
      )
      .fetchInto(classOf[AccessEntry])
  }

  /**
   * This method shares a template to a user with a specific access type
   *
   * @param tid       the given template
   * @param email     the email which the access is given to
   * @param privilege the type of Access given to the target user
   * @return rejection if user not permitted to share the template or Success Message
   */
  @PUT
  @Path("/grant/{tid}/{email}/{privilege}")
  def grantAccess(
                   @PathParam("tid") tid: Integer,
                   @PathParam("email") email: String,
                   @PathParam("privilege") privilege: String,
                   @Auth user: SessionUser
                 ): Unit = {
    val selfUserUid = user.getUid
    val userUid = userDao.fetchOneByEmail(email).getUid
    val templateOwnerUid = context
      .select(TEMPLATE_OF_USER.UID)
      .from(TEMPLATE_OF_USER)
      .where(TEMPLATE_OF_USER.TID.eq(tid))
      .fetchOneInto(classOf[Integer])

    // Must either have write access or be the owner to modify access levels
    if (userUid != templateOwnerUid && !hasWriteAccess(tid, user.getUid)) {
      throw new ForbiddenException(s"You do not have permission to modify template $tid")
    }

    // Must be the owner to modify the owner's access level
    if (selfUserUid != userUid && userUid == templateOwnerUid) {
      throw new ForbiddenException("You cannot modify the owner's permissions!")
    }

    try {
      templateUserAccessDao.merge(
        new TemplateUserAccess(
          userUid,
          tid,
          PrivilegeEnum.valueOf(privilege)
        )
      )
    } catch {
      case _: NullPointerException =>
        throw new BadRequestException(s"User $email Not Found!")
    }
  }

  /**
   * This method identifies the user access level of the given template
   *
   * @param tid   the given template
   * @param email the email of the use whose access is about to be removed
   * @return message indicating a success message
   */
  @DELETE
  @Path("/revoke/{tid}/{email}")
  def revokeAccess(
                    @PathParam("tid") tid: Integer,
                    @PathParam("email") email: String,
                    @Auth user: SessionUser
                  ): Unit = {
    try {
      val targetUserUid = userDao.fetchOneByEmail(email).getUid
      val templateOwnerUid = templateOfUserDao.fetchByTid(tid).get(0).getUid

      // Prevent owner from revoking their own access
      if (targetUserUid == templateOwnerUid) {
        throw new ForbiddenException("The owner cannot revoke their own access")
      }

      // Allow if: (1) user has WRITE access, OR (2) user is revoking their own access
      val isRevokingOwnAccess = targetUserUid == user.getUid
      if (!hasWriteAccess(tid, user.getUid) && !isRevokingOwnAccess) {
        throw new ForbiddenException(s"You do not have permission to modify template $tid")
      }

      context
        .delete(TEMPLATE_USER_ACCESS)
        .where(
          TEMPLATE_USER_ACCESS.UID
            .eq(targetUserUid)
            .and(TEMPLATE_USER_ACCESS.TID.eq(tid))
        )
        .execute()
    } catch {
      case _: NullPointerException =>
        throw new BadRequestException(s"User $email Not Found!")
    }
  }
}
