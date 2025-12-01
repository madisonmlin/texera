/**
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

import { Component, inject, OnInit } from "@angular/core";
import {DASHBOARD_USER_SCGPT} from "../../../../app-routing.constant";
import {NzModalService} from "ng-zorro-antd/modal";
import {UserService} from "../../../../common/service/user/user.service";
import {Router} from "@angular/router";
import {SearchService} from "../../../service/user/search.service";
import {DatasetService} from "../../../service/user/dataset/dataset.service";
import {NzMessageService} from "ng-zorro-antd/message";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";

@UntilDestroy()
@Component({
  templateUrl: "./user-scgpt.component.html",
  styleUrls: ["./user-scgpt.component.scss"]
})
export class UserScGPTComponent implements OnInit {
  public isLogin = this.userService.isLogin();
  public currentUid = this.userService.getCurrentUser()?.uid;

  constructor(
    private modalService: NzModalService,
    private userService: UserService,
    private router: Router,
    private searchService: SearchService,
    private datasetService: DatasetService,
    private message: NzMessageService
  ) {
    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.isLogin = this.userService.isLogin();
        this.currentUid = this.userService.getCurrentUser()?.uid;
      });
  }

  ngOnInit(): void {
    return;
  }

  public onClickOpenScGPTJobAddComponent(): void {
    console.log("Clicked.");
    this.router.navigate([`${DASHBOARD_USER_SCGPT}/1`]);
    return;
  }
}
