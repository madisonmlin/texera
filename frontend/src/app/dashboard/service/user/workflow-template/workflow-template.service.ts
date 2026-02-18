import {Injectable} from "@angular/core";
import {HttpClient} from "@angular/common/http";
import {Observable} from "rxjs";
import {AppSettings} from "../../../../common/app-setting";
import {WorkflowTemplate} from "../../../../common/type/workflow-template";

export const WORKFLOW_TEMPLATE_BASE_URL = "workflow-template";

@Injectable({
  providedIn: "root",
})
export class WorkflowTemplateService {
  constructor(private http: HttpClient) {}

  addWorkflowTemplate(workflow_template: WorkflowTemplate): void {
    this.http.post<void>(`${AppSettings.getApiEndpoint()}/${WORKFLOW_TEMPLATE_BASE_URL}/add`, {
      tid: workflow_template.tid,
      name: workflow_template.name,
      description: workflow_template.description,
      content: workflow_template.content,
      configurableParameters: workflow_template.configurableParameters,
    }).subscribe({
      next: () => console.log('Workflow template added successfully'),
      error: err => console.error('Failed to add workflow template', err)
    });
  }

  getWorkflowTemplate(): Observable<{ tid: string, name: string }[]> {
    return this.http.get<{ tid: string, name: string }[]>(`${AppSettings.getApiEndpoint()}/${WORKFLOW_TEMPLATE_BASE_URL}/list`);
  }
}
