import {Injectable} from "@angular/core";
import {HttpClient, HttpParams} from "@angular/common/http";
import {Observable} from "rxjs";
import {AppSettings} from "../../../../common/app-setting";
import {Template} from "../../../../common/type/template";
import {Workflow, WorkflowContent} from "../../../../common/type/workflow";
import {
  DEFAULT_WORKFLOW_NAME,
  WORKFLOW_BASE_URL, WORKFLOW_DUPLICATE_URL
} from "../../../../common/service/workflow-persist/workflow-persist.service";
import {DashboardWorkflow} from "../../../type/dashboard-workflow.interface";
import {filter, map} from "rxjs/operators";
import {DashboardTemplate} from "../../../type/dashboard-template.interface";
import {WorkflowUtilService} from "../../../../workspace/service/workflow-graph/util/workflow-util.service";
import {jsonCast} from "../../../../common/util/storage";

export const TEMPLATE_BASE_URL = "template";
export const TEMPLATE_CREATE_URL = TEMPLATE_BASE_URL + "/create";
export const TEMPLATE_LIST_URL = TEMPLATE_BASE_URL + "/list";
export const TEMPLATE_DUPLICATE_URL = TEMPLATE_BASE_URL + "/duplicate";
export const TEMPLATE_DELETE_URL = TEMPLATE_BASE_URL + "/delete";
export const TEMPLATE_SIZE = TEMPLATE_BASE_URL + "/size";

export const DEFAULT_TEMPLATE_NAME = "Untitled template";

@Injectable({
  providedIn: "root",
})
export class TemplateService {
  constructor(private http: HttpClient) {}

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
