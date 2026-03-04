import {Injectable} from "@angular/core";
import {HttpClient, HttpParams} from "@angular/common/http";
import {Observable} from "rxjs";
import {AppSettings} from "../../../../common/app-setting";
import {Template} from "../../../../common/type/template";
import {WORKFLOW_DELETE_URL, WORKFLOW_SIZE} from "../../../../common/service/workflow-persist/workflow-persist.service";

export const TEMPLATE_BASE_URL = "template";
export const TEMPLATE_ADD_URL = TEMPLATE_BASE_URL + "/add";
export const TEMPLATE_LIST_URL = TEMPLATE_BASE_URL + "/list";
export const TEMPLATE_DELETE_URL = TEMPLATE_BASE_URL + "/delete";
export const TEMPLATE_SIZE = TEMPLATE_BASE_URL + "/size";

@Injectable({
  providedIn: "root",
})
export class TemplateService {
  constructor(private http: HttpClient) {}

  public addTemplate(template: Template): void {
    this.http.post<void>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_ADD_URL}`, {
      name: template.name,
      description: template.description,
      content: template.content,
      configurableParameters: template.configurableParameters,
    }).subscribe({
      next: () => console.log('Template added successfully'),
      error: err => console.error('Failed to add template', err)
    });
  }

  public getTemplate(): Observable<{ tid: string, name: string }[]> {
    return this.http.get<{ tid: string, name: string }[]>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_LIST_URL}`);
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
}
