import {Injectable} from "@angular/core";
import {HttpClient} from "@angular/common/http";
import {AppSettings} from "../../../../common/app-setting";
import {Observable} from "rxjs";
import {Workflow} from "../../../../common/type/workflow";
import {filter, map} from "rxjs/operators";
import {WorkflowUtilService} from "../../../../workspace/service/workflow-graph/util/workflow-util.service";

@Injectable({
  providedIn: "root",
})
export class TemplatedWorkflowService {
  constructor(private http: HttpClient) {}

  public createTemplatedWorkflow(tid: number): Observable<number> {
    return this.http.post<number>(
      `${AppSettings.getApiEndpoint()}/templated-workflow/build?tid=${tid}`,
      {}
    );
  }

  public updateTemplatedWorkflowProperties(
    wid: number,
    request: { operatorProperties: Record<string, Record<string, unknown>> }
  ): Observable<Workflow> {
    return this.http
      .post<Workflow>(
        `${AppSettings.getApiEndpoint()}/templated-workflow/${wid}/update`,
        request
      )
      .pipe(
        filter((workflow: Workflow) => workflow != null),
        map(WorkflowUtilService.parseWorkflowInfo)
      );
  }
}
