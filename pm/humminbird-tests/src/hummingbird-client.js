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

  async function startProcessByKey(key, { businessKey, variables, userId = DEFAULT_USER_ID } = {}) {
    return request("POST", `/api/v1/process-definition/key/${key}/start`, {
      body: { businessKey, variables, userId },
    });
  }

  async function startProcessById(id, { businessKey, variables, userId = DEFAULT_USER_ID } = {}) {
    return request("POST", `/api/v1/process-definition/${id}/start`, {
      body: { businessKey, variables, userId },
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
    return request("POST", `/api/v1/process-instance/${processInstanceId}/terminate`);
  }

  // ── Tasks ───────────────────────────────────────────────────

  async function getTasks({ processInstanceId, assignee, active } = {}) {
    return request("GET", "/api/v1/task", {
      query: { processInstanceId, assignee, active },
    });
  }

  async function getTask(taskId) {
    return request("GET", `/api/v1/task/${taskId}`);
  }

  async function completeTask(taskId, { userId = DEFAULT_USER_ID, variables } = {}) {
    return request("POST", `/api/v1/task/${taskId}/complete`, {
      body: { userId, variables },
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

  async function setTaskLocalVariables(taskId, modifications) {
    return request("POST", `/api/v1/task/${taskId}/local-variables`, {
      body: { modifications },
    });
  }

  // ── External Tasks ──────────────────────────────────────────

  async function fetchAndLockExternalTasks({ workerId, topic, maxTasks = 1, lockDuration = 10000 }) {
    return request("POST", "/api/v1/external-task/fetchAndLock", {
      body: { workerId, maxTasks, topics: [{ topicName: topic, lockDuration }] },
    });
  }

  async function completeExternalTask(externalTaskId, { workerId, variables } = {}) {
    return request("POST", `/api/v1/external-task/${externalTaskId}/complete`, {
      body: { workerId, variables },
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
    fetchAndLockExternalTasks,
    completeExternalTask,
    triggerMessage,
  };
}
