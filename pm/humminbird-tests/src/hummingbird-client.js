import { requestLine, columns } from "./log.js";

const DEFAULT_BASE_URL = "http://localhost:8095/hummingbird";
const DEFAULT_USER_ID = "test-user";
const DEFAULT_DEPLOYMENT_SOURCE = "hummingbird-tests";

export function createClient(baseUrl = DEFAULT_BASE_URL) {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  async function request(method, path, { body, query, formData } = {}) {
    const url = new URL(base + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      }
    }

    const headers = {};
    let requestBody;
    const isMultipart = !!formData;

    if (formData) {
      requestBody = formData;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: requestBody });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    requestLine(method, url.pathname + url.search, res.status);
    const reqBody = isMultipart ? "<multipart file>" : body;
    columns("Request", reqBody, "Response", data);

    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ── Deployment ──────────────────────────────────────────────

  async function deploy(filePath, { userId = DEFAULT_USER_ID, source = DEFAULT_DEPLOYMENT_SOURCE } = {}) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = new Blob([fs.readFileSync(filePath)]);
    const form = new FormData();
    form.set("data", file, path.basename(filePath));
    return request("POST", "/api/v1/deployment/create", {
      query: { "user-id": userId, "deployment-source": source },
      formData: form,
    });
  }

  async function deleteDeployments({ source = DEFAULT_DEPLOYMENT_SOURCE, userId = DEFAULT_USER_ID } = {}) {
    return request("DELETE", "/api/v1/deployment", {
      query: { "deployment-source": source, "user-id": userId },
    });
  }

  // ── Process Definition ──────────────────────────────────────

  async function getProcessDefinitions({ key, latestVersion, deploymentId } = {}) {
    return request("GET", "/api/v1/process-definition", {
      query: { key, latestVersion, deploymentId },
    });
  }

  async function getProcessDefinitionByKey(key) {
    return request("GET", `/api/v1/process-definition/key/${key}`);
  }

  async function startProcessByKey(key, { businessKey, processVariables, userId = DEFAULT_USER_ID } = {}) {
    return request("POST", `/api/v2/latest-process-definitions/${key}:start`, {
      body: { businessKey, processVariables, userId },
    });
  }

  async function startProcessById(id, { businessKey, processVariables, userId = DEFAULT_USER_ID } = {}) {
    return request("POST", `/api/v2/process-definitions/${id}:start`, {
      body: { businessKey, processVariables, userId },
    });
  }

  // ── Process Instance ────────────────────────────────────────

  async function getProcessInstance(id) {
    return request("GET", `/api/v1/process-instance/${id}`);
  }

  async function getProcessInstances(params = {}) {
    return request("GET", "/api/v1/process-instance", { query: params });
  }

  async function getProcessVariables(processInstanceId) {
    return request("GET", `/api/v1/process-instance/${processInstanceId}/variables`);
  }

  async function setProcessVariables(processInstanceId, modifications) {
    return request("POST", `/api/v1/process-instance/${processInstanceId}/variables`, {
      body: { modifications },
    });
  }

  async function terminateProcess(processInstanceId) {
    return request("POST", `/api/v2/process-instances/${processInstanceId}:terminate`);
  }

  // ── Tasks ───────────────────────────────────────────────────

  async function getTasks({ processInstanceId, assignee, active } = {}) {
    return request("GET", "/api/v1/task", {
      query: { processInstanceId, assignee, active },
    });
  }

  async function getTask(taskId, { include } = {}) {
    return request("GET", `/api/v2/user-task-instances/${taskId}`, {
      query: { include: include?.join(",") },
    });
  }

  async function completeTask(taskId, { userId = DEFAULT_USER_ID, processVariables, localVariables } = {}) {
    return request("POST", `/api/v2/user-task-instances/${taskId}:complete`, {
      body: { userId, processVariables, localVariables },
    });
  }

  async function setTaskAssignee(taskId, userId) {
    return request("POST", `/api/v1/task/${taskId}/assignee`, {
      body: { userId },
    });
  }

  async function getTaskVariables(taskId) {
    return request("GET", `/api/v1/task/${taskId}/variables`);
  }

  async function getTaskLocalVariables(taskId) {
    return request("GET", `/api/v1/task/${taskId}/local-variables`);
  }

  async function setTaskLocalVariables(taskId, variables) {
    return request("POST", `/api/v2/user-task-instances/${taskId}/local-variables`, {
      body: variables,
    });
  }

  async function setTaskProcessVariables(taskId, variables) {
    return request("POST", `/api/v2/user-task-instances/${taskId}/process-variables`, {
      body: variables,
    });
  }

  // ── External Tasks ──────────────────────────────────────────

  async function fetchAndLockExternalTasks({ workerId, topic, maxTasks = 1, lockDuration = 10000 }) {
    return request("POST", "/api/v1/external-task/fetchAndLock", {
      body: { workerId, maxTasks, topics: [{ topicName: topic, lockDuration }] },
    });
  }

  async function completeExternalTask(externalTaskId, { workerId, processVariables, localVariables } = {}) {
    return request("POST", `/api/v2/external-task-instances/${externalTaskId}:complete`, {
      body: { workerId, processVariables, localVariables },
    });
  }

  async function failExternalTask(externalTaskId, { workerId, errorMessage, errorDetails, processVariables, localVariables } = {}) {
    return request("POST", `/api/v2/external-task-instances/${externalTaskId}:fail`, {
      body: { workerId, errorMessage, errorDetails, processVariables, localVariables },
    });
  }

  async function recoverExternalTask(externalTaskId) {
    return request("POST", `/api/v2/external-task-instances/${externalTaskId}:recover`);
  }

  async function lockSingleExternalTask({ executionId, worker, lockDurationInMillis = 10000 }) {
    return request("POST", "/api/v2/external-task-instances:lock-single", {
      body: { executionId, worker, lockDurationInMillis },
    });
  }

  // ── Messages ────────────────────────────────────────────────

  async function triggerMessage(messageName, { processInstanceId, businessKey, userId = DEFAULT_USER_ID, variables } = {}) {
    return request("POST", `/api/v1/message/${messageName}/trigger`, {
      body: { processInstanceId, businessKey, userId, variables },
    });
  }

  return {
    deploy,
    deleteDeployments,
    getProcessDefinitions,
    getProcessDefinitionByKey,
    startProcessByKey,
    startProcessById,
    getProcessInstance,
    getProcessInstances,
    getProcessVariables,
    setProcessVariables,
    terminateProcess,
    getTasks,
    getTask,
    completeTask,
    setTaskAssignee,
    getTaskVariables,
    getTaskLocalVariables,
    setTaskLocalVariables,
    setTaskProcessVariables,
    fetchAndLockExternalTasks,
    completeExternalTask,
    failExternalTask,
    recoverExternalTask,
    lockSingleExternalTask,
    triggerMessage,
  };
}
