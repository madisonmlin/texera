from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import json
import asyncio
import websockets
import jwt

app = FastAPI()

# Allow Angular frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],  # frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SCGPT_WORKFLOW_TEMPLATE_FILEPATH = "workflow_templates/scatter-plot-workflow.json"
with open(SCGPT_WORKFLOW_TEMPLATE_FILEPATH, "r", encoding="utf-8") as file:
    scgpt_workflow_template = json.load(file)

class BuildParameters(BaseModel):
    tid: int
    filepath: str
    token: str

class RunParameters(BaseModel):
    wid: int
    token: str

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.post("/run-scgpt")
async def run_scGPT(params: RunParameters):
    workflow = retrieve_scgpt_workflow(params.token, params.wid)
    print(f"WORKFLOW:\n{workflow}")
    cu = create_scgpt_computing_unit(params.token)
    print(f"COMPUTING UNIT:\n{cu}")
    cuid = cu["computingUnit"]["cuid"]
    uid = get_uid(params.token)
    response = await run_scgpt_workflow(params.token, workflow, params.wid, uid, cuid)
    return response

@app.post("/build-scgpt")
def build_scGPT(params: BuildParameters):
    update_workflow_params(params)
    dashboard_workflow = create_scgpt_workflow(params.token)
    print(f"DASHBOARD WORKFLOW:\n{dashboard_workflow}")
    wid = dashboard_workflow["workflow"]["wid"]
    return {"wid": wid}

def update_workflow_params(params: BuildParameters):
    operator_idx = 0
    param_name = "fileName"
    param_value = params.filepath
    workflow_template = json.loads(get_workflow_template(params.token, params.tid)["content"])
    workflow_template["operators"][operator_idx]["operatorProperties"][param_name] = param_value

def get_workflow_template(token: str, tid: int) -> str:
    urlpath = f"http://localhost:8080/api/workflow-template/{tid}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    response = requests.get(urlpath, headers=headers)
    return response.json()

def create_scgpt_workflow(token: str) -> None:
    urlpath = "http://localhost:8080/api/workflow/create"
    request_body = {
        "wid": None,
        "name": "scgpt_template",
        "description": "",
        "content": json.dumps(scgpt_workflow_template),
        "creationTime": None,
        "lastModifiedTime": None,
        "isPublic": False
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    response = requests.post(urlpath, json=request_body, headers=headers)
    return response.json()

def retrieve_scgpt_workflow(token: str, wid: int):
    urlpath = f"http://localhost:8080/api/workflow/{wid}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    response = requests.get(urlpath, headers=headers)
    return response.json()

def create_scgpt_computing_unit(token: str):
    urlpath = "http://localhost:8888/api/computing-unit/create"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    request_body = {
        "name": "scGPT Computing Unit",
        "unitType": "local",
        "cpuLimit": "NaN",
        "memoryLimit": "NaN",
        "gpuLimit": "NaN",
        "jvmMemorySize": "NaN",
        "shmSize": "NaN",
        "uri": "ws://localhost:8008/wsapi"
    }
    response = requests.post(urlpath, json=request_body, headers=headers)
    return response.json()

def get_uid(token: str):
    decoded = jwt.decode(token, options={"verify_signature": False})
    return decoded["userId"]

def flatten_operators(operators: dict):
    flattened_operators = []
    for op in operators:
        flat = {}
        if "operatorProperties" in op and isinstance(op["operatorProperties"], dict):
            flat.update(op["operatorProperties"])

        flat["operatorID"] = op["operatorID"]
        flat["operatorType"] = op["operatorType"]
        flat["inputPorts"] = op["inputPorts"]
        flat["outputPorts"] = op["outputPorts"]
        flattened_operators.append(flat)

    return flattened_operators

def get_output_port_ordinal(operators, operator_id, output_port_id):
    """
    Returns the index of the given output port ID for the specified operator.
    """
    operator = next((op for op in operators if op["operatorID"] == operator_id), None)
    if operator is None:
        raise ValueError(f"Operator {operator_id} not found")

    try:
        return next(i for i, port in enumerate(operator["outputPorts"]) if port["portID"] == output_port_id)
    except StopIteration:
        raise ValueError(f"Output port {output_port_id} not found in operator {operator_id}")


def get_input_port_ordinal(operators, operator_id, input_port_id):
    """
    Returns the index of the given input port ID for the specified operator.
    """
    operator = next((op for op in operators if op["operatorID"] == operator_id), None)
    if operator is None:
        raise ValueError(f"Operator {operator_id} not found")

    try:
        return next(i for i, port in enumerate(operator["inputPorts"]) if port["portID"] == input_port_id)
    except StopIteration:
        raise ValueError(f"Input port {input_port_id} not found in operator {operator_id}")


def flatten_links(workflow_content):
    """
    Converts the workflow links to Texera's flattened format.
    Each link's ports are replaced by ordinal indices.
    """
    flattened_links = []

    for link in workflow_content.get("links", []):
        source_op_id = link["source"]["operatorID"]
        source_port_id = link["source"]["portID"]
        target_op_id = link["target"]["operatorID"]
        target_port_id = link["target"]["portID"]

        from_port_idx = get_output_port_ordinal(workflow_content["operators"], source_op_id, source_port_id)
        to_port_idx = get_input_port_ordinal(workflow_content["operators"], target_op_id, target_port_id)

        flattened_link = {
            "fromOpId": source_op_id,
            "fromPortId": {"id": from_port_idx, "internal": False},
            "toOpId": target_op_id,
            "toPortId": {"id": to_port_idx, "internal": False},
        }

        flattened_links.append(flattened_link)

    return flattened_links


async def run_scgpt_workflow(token: str, workflow: dict, wid: str, uid: str, cuid: str):
    uri = f"ws://localhost:8085/wsapi/workflow-websocket?wid={wid}&uid={uid}&cuid={cuid}&access-token={token}"
    workflow_content = json.loads(workflow["content"])
    print(f"WORKFLOW CONTENT:\n{workflow_content}")

    operators = flatten_operators(workflow_content["operators"])
    links = flatten_links(workflow_content)

    logical_plan = {
        "operators": operators,
        "links": links,
        "opsToViewResult": ["Limit-operator"],
        "opsToReuseResult": []
    }
    workflow_execute_request = {
        "type": "WorkflowExecuteRequest",
        "executionName": "scGPT Execution",
        "engineVersion": "latest",
        "logicalPlan": logical_plan,
        "replayFromExecution": None,
        "workflowSettings": workflow_content["settings"],
        "emailNotificationEnabled": False,
        "computingUnitId": cuid
    }

    async with websockets.connect(uri, open_timeout=5) as websocket:
        print("Connected to Texera WebSocket", flush=True)

        # 1. Send the WorkflowExecuteRequest
        await websocket.send(json.dumps(workflow_execute_request))
        print("Sent WorkflowExecuteRequest", flush=True)

        # 2. Listen indefinitely for workflow events
        while True:
            try:
                message = await websocket.recv()
                event = json.loads(message)
                print(f"[WebSocket Event] {json.dumps(event, indent=2)}", flush=True)

                if event.get("type") == "WorkflowStateEvent":
                    state = event.get("state")
                    if state == "Completed":
                        print("Workflow COMPLETED", flush=True)
                        return {"status": "success", "wid": wid}
                    elif state == "Failed":
                        print("Workflow FAILED", flush=True)
                        return {"status": "error", "wid": wid}

            except websockets.exceptions.ConnectionClosed:
                print("WebSocket closed by server", flush=True)
                break