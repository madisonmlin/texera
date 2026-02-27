import {Injectable} from "@angular/core";
import {HttpClient, HttpParams} from "@angular/common/http";
import {Observable} from "rxjs";
import {AppSettings} from "../../../../common/app-setting";
import {WorkflowTemplate} from "../../../../common/type/workflow-template";
import {WORKFLOW_SIZE} from "../../../../common/service/workflow-persist/workflow-persist.service";

export const WORKFLOW_TEMPLATE_BASE_URL = "workflow-template";
export const WORKFLOW_TEMPLATE_ADD_URL = WORKFLOW_TEMPLATE_BASE_URL + "/add";
export const WORKFLOW_TEMPLATE_LIST_URL = WORKFLOW_TEMPLATE_BASE_URL + "/list";
export const WORKFLOW_TEMPLATE_SIZE = WORKFLOW_TEMPLATE_BASE_URL + "/size";

@Injectable({
  providedIn: "root",
})
export class WorkflowTemplateService {
  constructor(private http: HttpClient) {}

  public addWorkflowTemplate(workflow_template: WorkflowTemplate): void {
    this.http.post<void>(`${AppSettings.getApiEndpoint()}/${WORKFLOW_TEMPLATE_ADD_URL}`, {
      name: workflow_template.name,
      description: workflow_template.description,
      content: workflow_template.content,
      configurableParameters: workflow_template.configurableParameters,
    }).subscribe({
      next: () => console.log('Workflow template added successfully'),
      error: err => console.error('Failed to add workflow template', err)
    });
  }

  public getWorkflowTemplate(): Observable<{ tid: string, name: string }[]> {
    return this.http.get<{ tid: string, name: string }[]>(`${AppSettings.getApiEndpoint()}/${WORKFLOW_TEMPLATE_LIST_URL}`);
  }

  public getSizes(tids: number[]): Observable<Record<number, number>> {
    let params = new HttpParams();
    tids.forEach(tid => {
      params = params.append("tid", tid.toString());
    });
    return this.http.get<Record<number, number>>(`${AppSettings.getApiEndpoint()}/${WORKFLOW_TEMPLATE_SIZE}`, { params });
  }
}
