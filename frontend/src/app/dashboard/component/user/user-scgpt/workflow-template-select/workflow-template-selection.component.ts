import {Component} from "@angular/core";
import { FieldType, FieldTypeConfig } from "@ngx-formly/core";
import {Observable} from "rxjs";
import {WorkflowTemplateService} from "../../../../service/user/workflow-template/workflow-template.service";
import {UntilDestroy} from "@ngneat/until-destroy";
import {WorkflowTemplate} from "../../../../type/workflow-template";

@UntilDestroy()
@Component({
  selector: "texera-workflow-template-selection",
  templateUrl: "./workflow-template-selection.component.html",
  styleUrls: ["./workflow-template-selection.component.scss"],
})
export class WorkflowTemplateSelectionComponent extends FieldType<FieldTypeConfig> {
  templateOptions$: Observable<{ tid: string; name: string }[]> | undefined;

  constructor(private templateService: WorkflowTemplateService) {
    super();
  }

  ngOnInit() {
    // const newTemplate: WorkflowTemplate = {
    //   tid: 0,
    //   name: "CSV Workflow",
    //   description: "Workflow with single CSV operator",
    //   content: JSON.stringify({
    //     operators: [
    //       {
    //         operatorID: "CSVFileScan-operator",
    //         operatorType: "CSVFileScan",
    //         operatorProperties: {
    //           fileEncoding: "UTF_8",
    //           customDelimiter: ",",
    //           hasHeader: true,
    //           fileName: null,
    //         },
    //         inputPorts: [],
    //         outputPorts: [{ portID: "output-0" }],
    //       },
    //       {
    //         operatorID: "Limit-operator",
    //         operatorType: "Limit",
    //         operatorProperties: { limit: 5 },
    //         inputPorts: [{ portID: "input-0" }],
    //         outputPorts: [{ portID: "output-0" }],
    //       },
    //     ],
    //     operatorPositions: {
    //       "CSVFileScan-operator": { x: 150, y: 50 },
    //       "Limit-operator": { x: 270, y: 50 },
    //     },
    //     links: [
    //       {
    //         linkID: "link-1",
    //         source: { operatorID: "CSVFileScan-operator", portID: "output-0" },
    //         target: { operatorID: "Limit-operator", portID: "input-0" },
    //       },
    //     ],
    //     commentBoxes: [],
    //     settings: { dataTransferBatchSize: 400 },
    //   }),
    //   configurableParameters: JSON.stringify({
    //     "CSVFileScan-operator": ["fileName"],
    //     "Limit-operator": ["limit"],
    //   })
    // };
    //
    // this.templateService.addWorkflowTemplate(newTemplate);

    this.templateOptions$ = this.templateService.getWorkflowTemplate();
    this.props.options = this.templateOptions$;
  }
}
