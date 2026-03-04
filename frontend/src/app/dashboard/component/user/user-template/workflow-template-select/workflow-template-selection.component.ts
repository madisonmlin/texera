import {Component} from "@angular/core";
import { FieldType, FieldTypeConfig } from "@ngx-formly/core";
import {Observable} from "rxjs";
import {TemplateService} from "../../../../service/user/template/template.service";
import {UntilDestroy} from "@ngneat/until-destroy";
import {Template} from "../../../../../common/type/template";

import workflow from "../../../../../../assets/workflow_templates/scGPT_FINAL.json";


@UntilDestroy()
@Component({
  selector: "texera-workflow-template-selection",
  templateUrl: "./workflow-template-selection.component.html",
  styleUrls: ["./workflow-template-selection.component.scss"],
})
export class WorkflowTemplateSelectionComponent extends FieldType<FieldTypeConfig> {
  templateOptions$: Observable<{ tid: string; name: string }[]> | undefined;

  constructor(private templateService: TemplateService) {
    super();
  }

  ngOnInit() {
    // const newTemplate: Template = {
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
    //   }),
    //   creationTime: 0,
    //   lastModifiedTime: 0,
    //   isPublished: 0,
    //   readonly: true,
    // };
    //
    // this.templateService.addTemplate(newTemplate);
    //
    //
    // console.log(workflow);
    // const newTemplate = {
    //   tid: 2,
    //   name: "scGPT_FINAL",
    //   description: "",
    //   content: JSON.stringify(workflow),
    //   configurableParameters: JSON.stringify({
    //     "TextInput-operator-4e1b277d-75a9-4299-af22-8b76fcb633da": ["textInput"],
    //   }),
    //   creationTime: 0,
    //   lastModifiedTime: 0,
    //   isPublished: 0,
    //   readonly: true,
    // }
    // this.templateService.addTemplate(newTemplate);


    this.templateOptions$ = this.templateService.getTemplate();
    this.props.options = this.templateOptions$;
  }
}
