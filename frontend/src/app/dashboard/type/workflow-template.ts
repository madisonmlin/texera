export interface WorkflowTemplate
  extends Readonly<{
    tid: number,
    name: string;
    description: string;
    content: string;
    configurableParameters: string;
  }> {}
