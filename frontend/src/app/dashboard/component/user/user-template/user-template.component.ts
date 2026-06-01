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

import {AfterViewInit, Component, OnInit, ViewChild} from "@angular/core";
import {DASHBOARD_USER_TEMPLATE} from "../../../../app-routing.constant";
import {NzModalService} from "ng-zorro-antd/modal";
import {UserService} from "../../../../common/service/user/user.service";
import {Router} from "@angular/router";
import {SearchService} from "../../../service/user/search.service";
import {DatasetService} from "../../../service/user/dataset/dataset.service";
import {NzMessageService} from "ng-zorro-antd/message";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {DashboardEntry, UserInfo} from "../../../type/dashboard-entry";
import {SearchResultsComponent} from "../search-results/search-results.component";
import {FiltersComponent} from "../filters/filters.component";
import {SortMethod} from "../../../type/sort-method";
import {firstValueFrom, from, lastValueFrom, Observable, of} from "rxjs";
import {map, mergeMap, switchMap, tap} from "rxjs/operators";
import {DEFAULT_TEMPLATE_NAME, TemplateService} from "../../../service/user/template/template.service";
import {NzUploadFile, NzUploadModule} from "ng-zorro-antd/upload";
import {NotificationService} from "../../../../common/service/notification/notification.service";
import {WorkflowContent} from "../../../../common/type/workflow";
import JSZip from "jszip";
import {DownloadService} from "../../../service/user/download/download.service";
import {DashboardTemplate} from "../../../type/dashboard-template.interface";
import {GuiConfigService} from "../../../../common/service/gui-config.service";
import {CommonModule} from "@angular/common";
import {FormsModule} from "@angular/forms";
import {NzButtonModule} from "ng-zorro-antd/button";
import {NzCardModule} from "ng-zorro-antd/card";
import {NzIconModule} from "ng-zorro-antd/icon";
import {NzPopconfirmModule} from "ng-zorro-antd/popconfirm";
import {NzSelectModule} from "ng-zorro-antd/select";
import {SortButtonComponent} from "../sort-button/sort-button.component";
import {FiltersInstructionsComponent} from "../filters-instructions/filters-instructions.component";
import {NzTooltipModule} from "ng-zorro-antd/tooltip";
import {NzDropdownModule} from "ng-zorro-antd/dropdown";
import {NzSpaceCompactComponent} from "ng-zorro-antd/space";

@UntilDestroy()
@Component({
  templateUrl: "./user-template.component.html",
  styleUrls: ["./user-template.component.scss"],
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzSpaceCompactComponent,
    NzCardModule,
    NzIconModule,
    NzPopconfirmModule,
    NzSelectModule,
    NzTooltipModule,
    NzUploadModule,
    NzDropdownModule,
    SortButtonComponent,
    FiltersComponent,
    FiltersInstructionsComponent,
    SearchResultsComponent,
  ],
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
    private notificationService: NotificationService,
    private router: Router,
    private downloadService: DownloadService,
    private searchService: SearchService,
    private datasetService: DatasetService,
    private templateService: TemplateService,
    private message: NzMessageService,
    private config: GuiConfigService
  ) {
    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.isLogin = this.userService.isLogin();
        this.currentUid = this.userService.getCurrentUser()?.uid;
      });
  }

  public multiTemplatesOperationButtonEnabled(): boolean {
    if (this._searchResultsComponent) {
      return this.searchResultsComponent?.entries.filter(i => i.checked).length > 0;
    } else {
      return false;
    }
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

  public onClickCreateNewTemplateFromDashboard(): void {
    const emptyTemplateContent: WorkflowContent = {
      operators: [],
      commentBoxes: [],
      links: [],
      operatorPositions: {},
      settings: {
        dataTransferBatchSize: this.config.env.defaultDataTransferBatchSize,
        executionMode: this.config.env.defaultExecutionMode,
      },
    };

    this.templateService
      .createTemplate(emptyTemplateContent, DEFAULT_TEMPLATE_NAME)
      .pipe(
        tap(createdTemplate => {
          if (!createdTemplate.template.tid) {
            throw new Error("Template creation failed.");
          }
        }),
        mergeMap(createdTemplate => {
            return of(createdTemplate.template.tid);
        }),
        untilDestroyed(this)
      )
      .subscribe({
        next: (tid: number | undefined) => {
          // Use the tid here for navigation
          this.router.navigate([DASHBOARD_USER_TEMPLATE, tid]).then(null);
        },
        error: (err: unknown) => this.notificationService.error("Template creation failed"),
      });
  }

  public selectionTooltip: string = "Select all";

  public updateTooltip(): void {
    const entries = this.searchResultsComponent.entries;
    const allSelected = entries.every(entry => entry.checked);
    this.selectionTooltip = allSelected ? "Unselect all" : "Select all";
  }

  ngAfterViewInit() {
    // const templateName = "test-access"
    // const templateContent = JSON.parse(JSON.stringify(workflow)) as WorkflowContent
    // const templateConfigurableParameters = JSON.stringify({
    //   "TextInput-operator-4e1b277d-75a9-4299-af22-8b76fcb633da": ["textInput"]
    // })
    // this.templateService.createTemplate(templateContent, templateName, templateConfigurableParameters).pipe(untilDestroyed(this))
    //       .subscribe(() => {
    //         this.userService
    //           .userChanged()
    //           .pipe(untilDestroyed(this))
    //           .subscribe(() => this.search());
    //       });

    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => this.search());
  }

  public async onClickDuplicateTemplate(entry: DashboardEntry): Promise<void> {
    if (entry.template.template.tid) {
      try {
        let duplicatedTemplatesInfo: DashboardTemplate[] = [];
        duplicatedTemplatesInfo = await firstValueFrom(
          this.templateService.duplicateTemplate([entry.template.template.tid])
        );

        const userIds = new Set<number>();
        duplicatedTemplatesInfo.forEach(template => {
          if (template.ownerId) {
            userIds.add(template.ownerId);
          }
        });

        let userIdToInfoMap: { [key: number]: UserInfo } = {};
        if (userIds.size > 0) {
          userIdToInfoMap = await firstValueFrom(this.searchService.getUserInfo(Array.from(userIds)));
        }

        const newEntries = duplicatedTemplatesInfo.map(duplicatedTemplateInfo => {
          const entry = new DashboardEntry(duplicatedTemplateInfo);
          const userInfo = userIdToInfoMap[duplicatedTemplateInfo.ownerId];
          if (userInfo) {
            entry.setOwnerName(userInfo.userName);
            entry.setOwnerGoogleAvatar(userInfo.googleAvatar ?? "");
          }
          return entry;
        });

        this.searchResultsComponent.entries = [...newEntries, ...this.searchResultsComponent.entries];
      } catch (err: unknown) {
        console.log("Error duplicating template:", err);
        // @ts-ignore // TODO: fix this with notification component
        alert((err as any).error);
      }
    }
  }

  public deleteTemplate(entry: DashboardEntry): void {
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

  public onClickUploadExistingTemplateFromLocal = (file: NzUploadFile): Observable<boolean> => {
    const fileExtensionIndex = file.name.lastIndexOf(".");

    let upload$: Observable<void>;
    if (file.name.substring(fileExtensionIndex) === ".zip") {
      upload$ = this.handleZipUploads(file as unknown as Blob);
    } else {
      upload$ = this.handleFileUploads(file as unknown as Blob, file.name);
    }

    return upload$.pipe(
      switchMap(() => from(this.search(true))),
      tap(() => this.notificationService.success("Upload Successful")),
      switchMap(() => of(false))
    );
  };

  private handleZipUploads(zipFile: Blob): Observable<void> {
    let zip = new JSZip();
    return from(zip.loadAsync(zipFile)).pipe(
      switchMap(zip =>
        from(
          Promise.all(
            Object.keys(zip.files).map(relativePath =>
              zip.files[relativePath]
                .async("blob")
                .then(content => lastValueFrom(this.handleFileUploads(content, relativePath)))
            )
          )
        )
      ),
      map(() => undefined)
    );
  }

  private handleFileUploads(file: Blob, name: string): Observable<void> {
    return new Observable<void>(observer => {
      let reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => {
        try {
          const result = reader.result;
          if (typeof result !== "string") {
            throw new Error("Incorrect format: file is not a string");
          }
          const templateContent = JSON.parse(result) as WorkflowContent;
          const fileExtensionIndex = name.lastIndexOf(".");
          let templateName = fileExtensionIndex === -1 ? name : name.substring(0, fileExtensionIndex);
          if (templateName.trim() === "") {
            templateName = DEFAULT_TEMPLATE_NAME;
          }
          this.templateService
            .createTemplate(templateContent, templateName)
            .pipe(untilDestroyed(this))
            .subscribe({
              next: uploadedTemplate => {
                this.searchResultsComponent.entries = [
                  ...this.searchResultsComponent.entries,
                  new DashboardEntry(uploadedTemplate),
                ];
                observer.next();
                observer.complete();
              },
              error: (err: unknown) => {
                observer.error(err);
              },
            });
        } catch (error) {
          this.notificationService.error(
            "An error occurred when importing the template. Please import a template json file."
          );
          observer.error(error);
        }
      };
    });
  }

  public onClickOpenDownloadZip(): void {
    const checkedEntries = this.searchResultsComponent.entries.filter(i => i.checked);
    if (checkedEntries.length === 0) {
      return;
    }

    const templateEntries = checkedEntries.map(entry => ({
      id: entry.template.template.tid!,
      name: entry.template.template.name,
    }));

    this.downloadService
      .downloadTemplatesAsZip(templateEntries)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          // this.searchResultsComponent.clearAllSelections();
        },
        error: (err: unknown) => console.error("Error downloading templates:", err),
      });
  }

  public onClickDuplicateSelectedTemplates(): void {
    const checkedEntries = this.searchResultsComponent.entries.filter(i => i.checked);
    let targetTids: number[] = [];

    for (const entry of checkedEntries) {
      const tid = entry.template.template.tid;
      if (tid) {
        targetTids.push(tid);
      } else {
        return;
      }
    }

    if (targetTids.length > 0) {
      this.templateService
        .duplicateTemplate(targetTids)
        .pipe(untilDestroyed(this))
        .subscribe({
          next: duplicatedTemplatesInfo => {
            this.searchResultsComponent.entries = [
              ...duplicatedTemplatesInfo.map(duplicatedTemplateInfo => new DashboardEntry(duplicatedTemplateInfo)),
              ...this.searchResultsComponent.entries,
            ];

            // this.searchResultsComponent.clearAllSelections();
          }, // TODO: fix this with notification component
          error: (err: unknown) => alert(err),
        });
    }
  }

  public handleConfirmDeleteSelectedTemplates(): void {
    const checkedEntries = this.searchResultsComponent.entries.filter(i => i.checked);
    let targetTids: number[] = [];

    for (const entry of checkedEntries) {
      const tid = entry.template.template.tid;
      if (tid) {
        targetTids.push(tid);
      } else {
        return;
      }
    }

    if (targetTids.length > 0) {
      this.templateService
        .deleteTemplate(targetTids)
        .pipe(untilDestroyed(this))
        .subscribe({
          next: _ => {
            this.searchResultsComponent.entries = this.searchResultsComponent.entries.filter(templateEntry => {
              let entryTid = templateEntry.template.template.tid;
              // Check if tid is defined and if it's not included in targetTids
              return entryTid === undefined || !targetTids.includes(entryTid);
            });
          },
          // TODO: fix this with notification component
          error: (err: unknown) => alert(err),
        });
    }
  }

  ngOnInit(): void {
    return;
  }

  public onClickOpenScGPTJobAddComponent(): void {
    this.router.navigate([`${DASHBOARD_USER_TEMPLATE}/1`]);
    return;
  }

  public toggleSelection(): void {
    const allSelected = this.searchResultsComponent.entries.every(entry => entry.checked);
    if (allSelected) {
      this.searchResultsComponent.clearAllSelections();
      this.updateTooltip();
    } else {
      this.searchResultsComponent.selectAll();
      this.updateTooltip();
    }
  }

  public refreshSearchResult() {
    void this.search(true);
  }
}
