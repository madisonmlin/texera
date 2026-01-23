export interface WorkflowTemplateContent
  extends Readonly<{
    tid: number,
    name: string;
    description: string;
    content: string;
  }> {}
