import {Injectable} from "@angular/core";
import {HttpClient, HttpParams} from "@angular/common/http";
import {Observable} from "rxjs";
import {AppSettings} from "../../../../common/app-setting";
import {Template} from "../../../../common/type/template";
import {Workflow, WorkflowContent} from "../../../../common/type/workflow";
import {filter, map} from "rxjs/operators";
import {DashboardTemplate} from "../../../type/dashboard-template.interface";
import {jsonCast} from "../../../../common/util/storage";
import {checkIfGraphBroken} from "../../../../common/util/graph-check";
import {NotificationService} from "../../../../common/service/notification/notification.service";

export const TEMPLATE_BASE_URL = "template";
export const TEMPLATE_PERSIST_URL = TEMPLATE_BASE_URL + "/persist";
export const TEMPLATE_CREATE_URL = TEMPLATE_BASE_URL + "/create";
export const TEMPLATE_CREATE_FROM_WORKFLOW_URL = TEMPLATE_BASE_URL + "/create-from-workflow";
export const TEMPLATE_LIST_URL = TEMPLATE_BASE_URL + "/list";
export const TEMPLATE_DUPLICATE_URL = TEMPLATE_BASE_URL + "/duplicate";
export const TEMPLATE_DELETE_URL = TEMPLATE_BASE_URL + "/delete";
export const TEMPLATE_SIZE = TEMPLATE_BASE_URL + "/size";

export const DEFAULT_TEMPLATE_NAME = "Untitled Template";

@Injectable({
  providedIn: "root",
})
export class TemplateService {
  private templatePersistFlag = true;

  constructor(
    private http: HttpClient,
    private notificationService: NotificationService
  ) {}

  public createTemplate(
    newTemplateContent: WorkflowContent,
    newTemplateName: string = DEFAULT_TEMPLATE_NAME,
    newTemplateConfigurableParameters: string = "{}",
  ): Observable<DashboardTemplate> {
    return this.http
      .post<DashboardTemplate>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_CREATE_URL}`, {
      name: newTemplateName,
      content: JSON.stringify(newTemplateContent),
      configurableParameters: newTemplateConfigurableParameters,
      })
      .pipe(filter((createdTemplate: DashboardTemplate) => createdTemplate != null));
  }

  public createTemplateFromWorkflow(wid: number): Observable<DashboardTemplate> {
    return this.http
      .post<DashboardTemplate>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_CREATE_FROM_WORKFLOW_URL}`, {
        wid: wid
      })
      .pipe(filter((template: DashboardTemplate) => template != null));
  }

  public getTemplate(): Observable<{ tid: string, name: string }[]> {
    return this.http.get<{ tid: string, name: string }[]>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_LIST_URL}`);
  }

  public duplicateTemplate(targetTids: number[]): Observable<DashboardTemplate[]> {
    return this.http
      .post<DashboardTemplate[]>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_DUPLICATE_URL}`, {
        tids: targetTids
      })
      .pipe(filter((createdTemplates: DashboardTemplate[]) => createdTemplates != null && createdTemplates.length > 0));
  }

  public retrieveTemplate(tid: number): Observable<Template> {
    return this.http.get<Template>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_BASE_URL}/${tid}`).pipe(
      filter((template: Template) => template != null),
      map(TemplateService.parseTemplateInfo)
    );
  }

  public deleteTemplate(tids: number[]): Observable<Response> {
    return this.http.post<Response>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_DELETE_URL}`, {
      tids: tids,
    });
  }

  public setTemplatePersistFlag(flag: boolean): void {
    this.templatePersistFlag = flag;
  }

  public isTemplatePersistEnabled(): boolean {
    return this.templatePersistFlag;
  }

  public persistTemplate(template: Template): Observable<Template> {
    if (checkIfGraphBroken(template.content)) {
      this.notificationService.error(
        "Sorry! The template is broken and cannot be persisted. Please contact the system admin."
      );
    }

    return this.http
      .post<Template>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_PERSIST_URL}`, {
        tid: template.tid,
        name: template.name,
        description: template.description,
        content: JSON.stringify(template.content),
        configurableParameters: template.configurableParameters,
        // isPublic: template.isPublished,
      })
      .pipe(
        filter((updatedTemplate: Template) => updatedTemplate != null),
        map(TemplateService.parseTemplateInfo)
      );
  }

  public getSizes(tids: number[]): Observable<Record<number, number>> {
    let params = new HttpParams();
    tids.forEach(tid => {
      params = params.append("tid", tid.toString());
    });
    return this.http.get<Record<number, number>>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_SIZE}`, { params });
  }

  public static parseTemplateInfo(template: Template): Template {
    if (template != null && typeof template.content === "string") {
      template.content = jsonCast<WorkflowContent>(template.content);
    }
    return template;
  }
}
