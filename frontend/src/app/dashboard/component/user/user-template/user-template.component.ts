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

import {AfterViewInit, Component, inject, OnInit, ViewChild} from "@angular/core";
import {DASHBOARD_USER_TEMPLATE} from "../../../../app-routing.constant";
import {NzModalService} from "ng-zorro-antd/modal";
import {UserService} from "../../../../common/service/user/user.service";
import {Router} from "@angular/router";
import {SearchService} from "../../../service/user/search.service";
import {DatasetService} from "../../../service/user/dataset/dataset.service";
import {NzMessageService} from "ng-zorro-antd/message";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {DashboardEntry} from "../../../type/dashboard-entry";
import {SearchResultsComponent} from "../search-results/search-results.component";
import {FiltersComponent} from "../filters/filters.component";
import {SortMethod} from "../../../type/sort-method";
import {firstValueFrom} from "rxjs";
import {map} from "rxjs/operators";
import workflow from "../../../../../assets/workflow_templates/scGPT_FINAL.json";
import {TemplateService} from "../../../service/user/template/template.service";

@UntilDestroy()
@Component({
  templateUrl: "./user-template.component.html",
  styleUrls: ["./user-template.component.scss"]
})
export class UserTemplateComponent implements OnInit, AfterViewInit {
  private _searchResultsComponent?: SearchResultsComponent;
  public isLogin = this.userService.isLogin();
  private includePublic = false;
  public currentUid = this.userService.getCurrentUser()?.uid;
  @ViewChild(SearchResultsComponent) get searchResultsComponent(): SearchResultsComponent {
    if (this._searchResultsComponent) {
      return this._searchResultsComponent;
    }
    throw new Error("Property cannot be accessed before it is initialized.");
  }
  set searchResultsComponent(value: SearchResultsComponent) {
    this._searchResultsComponent = value;
  }
  private _filters?: FiltersComponent;
  @ViewChild(FiltersComponent) get filters(): FiltersComponent {
    if (this._filters) {
      return this._filters;
    }
    throw new Error("Property cannot be accessed before it is initialized.");
  }
  set filters(value: FiltersComponent) {
    value.masterFilterListChange.pipe(untilDestroyed(this)).subscribe({ next: () => this.search() });
    this._filters = value;
  }
  private masterFilterList: ReadonlyArray<string> | null = null;

  public sortMethod = SortMethod.EditTimeDesc;
  lastSortMethod: SortMethod | null = null;

  constructor(
    private modalService: NzModalService,
    private userService: UserService,
    private router: Router,
    private searchService: SearchService,
    private datasetService: DatasetService,
    private templateService: TemplateService,
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

  async search(forced: Boolean = false): Promise<void> {
    const sameList =
      this.masterFilterList !== null &&
      this.filters.masterFilterList.length === this.masterFilterList.length &&
      this.filters.masterFilterList.every((v, i) => v === this.masterFilterList![i]);
    if (!forced && sameList && this.sortMethod === this.lastSortMethod) {
      // If the filter lists are the same, do no make the same request again.
      return;
    }
    this.lastSortMethod = this.sortMethod;
    this.masterFilterList = this.filters.masterFilterList;
    let filterParams = this.filters.getSearchFilterParameters();

    this.searchResultsComponent.reset((start, count) => {
      return firstValueFrom(
        this.searchService
          .executeSearch(
            this.filters.getSearchKeywords(),
            filterParams,
            start,
            count,
            "template",
            this.sortMethod,
            this.isLogin,
            this.includePublic
          )
          .pipe(map(({ entries, more }) => ({ entries, more })))
      );
    });
    await this.searchResultsComponent.loadMore();
  }

  public selectionTooltip: string = "Select all";

  public updateTooltip(): void {
    const entries = this.searchResultsComponent.entries;
    const allSelected = entries.every(entry => entry.checked);
    this.selectionTooltip = allSelected ? "Unselect all" : "Select all";
  }

  ngAfterViewInit() {
    // const newTemplate = {
    //   tid: undefined,
    //   name: "scGPT_FINAL",
    //   description: "",
    //   content: JSON.stringify(workflow),
    //   configurableParameters: JSON.stringify({
    //     "TextInput-operator-4e1b277d-75a9-4299-af22-8b76fcb633da": ["textInput"],
    //   }),
    //   creationTime: undefined,
    //   lastModifiedTime: undefined,
    //   isPublished: 0,
    //   readonly: true,
    // }
    // this.templateService.addTemplate(newTemplate);
    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => this.search());
  }

  public async onClickDuplicateWorkflowTemplate(entry: DashboardEntry): Promise<void> {}

  public deleteWorkflowTemplate(entry: DashboardEntry): void {
    if (entry.template.template.tid == undefined) {
      return;
    }
    this.templateService
      .deleteTemplate([entry.template.template.tid])
      .pipe(untilDestroyed(this))
      .subscribe(_ => {
        this.searchResultsComponent.entries = this.searchResultsComponent.entries.filter(
          templateEntry => templateEntry.template.template.tid !== entry.template.template.tid
        );
      });
  }

  ngOnInit(): void {
    return;
  }

  public onClickOpenScGPTJobAddComponent(): void {
    this.router.navigate([`${DASHBOARD_USER_TEMPLATE}/1`]);
    return;
  }

  public refreshSearchResult() {
    void this.search(true);
  }
}
