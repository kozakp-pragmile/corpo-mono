import { requestLine, columns } from "./log.js";

const DEFAULT_BASE_URL = "http://localhost:8086/pigeon/server";
const DEFAULT_AUTH_ID = "pigeon-api-tests";
const DEFAULT_FIRST_NAME = "Test";
const DEFAULT_LAST_NAME = "User";

export function createClient(
  baseUrl = DEFAULT_BASE_URL,
  {
    authId = DEFAULT_AUTH_ID,
    firstName = DEFAULT_FIRST_NAME,
    lastName = DEFAULT_LAST_NAME,
  } = {}
) {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const onBehalfOfHeaders = {
    "X-On-Behalf-Of-Auth-Id": authId,
    "X-On-Behalf-Of-First-Name": firstName,
    "X-On-Behalf-Of-Last-Name": lastName,
  };

  async function request(method, path, { body, query, formData, raw } = {}) {
    const url = new URL(base + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, item);
        } else {
          url.searchParams.set(k, v);
        }
      }
    }

    const headers = { ...onBehalfOfHeaders };
    let requestBody;
    const isMultipart = !!formData;

    if (formData) {
      requestBody = formData;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: requestBody });

    let data;
    if (raw) {
      data = `<binary ${res.headers.get("content-type") ?? "?"} ${res.headers.get("content-length") ?? "?"}B>`;
    } else {
      const text = await res.text();
      try {
        data = text.length === 0 ? null : JSON.parse(text);
      } catch {
        data = text;
      }
    }

    requestLine(method, url.pathname + url.search, res.status);
    const reqBody = isMultipart ? "<multipart>" : body;
    columns("Request", reqBody, "Response", data);

    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ── Standard Notification Types ─────────────────────────────

  const STANDARD_BASE = "/private/api/standard-notification-types";

  async function createStandard({ name, channel, senderName, aggregatedNotificationTypeId, defaultNotificationTiming } = {}) {
    return request("POST", STANDARD_BASE, {
      body: { name, channel, senderName, aggregatedNotificationTypeId, defaultNotificationTiming },
    });
  }

  async function patchStandard(id, patch = {}) {
    return request("PATCH", `${STANDARD_BASE}/${id}`, { body: patch });
  }

  async function findStandard(id) {
    return request("GET", `${STANDARD_BASE}/${id}`);
  }

  async function queryStandards({ channel, aggregatedNotificationTypeId, search, page, size, sortBy, direction } = {}) {
    return request("GET", STANDARD_BASE, {
      query: { channel, aggregatedNotificationTypeId, search, page, size, sortBy, direction },
    });
  }

  async function deleteStandard(id) {
    return request("DELETE", `${STANDARD_BASE}/${id}`);
  }

  async function addStandardTemplate(id, { name, language, syntax, subject, contentPath, contentType } = {}) {
    return request("POST", `${STANDARD_BASE}/${id}/templates`, {
      formData: await buildTemplateForm({ name, language, syntax, subject, contentPath, contentType }),
    });
  }

  async function updateStandardTemplate(id, templateId, { name, language, syntax, subject, contentPath, contentType } = {}) {
    return request("PUT", `${STANDARD_BASE}/${id}/templates/${templateId}`, {
      formData: await buildTemplateForm({ name, language, syntax, subject, contentPath, contentType }),
    });
  }

  async function findStandardTemplate(id, templateId) {
    return request("GET", `${STANDARD_BASE}/${id}/templates/${templateId}`);
  }

  async function downloadStandardTemplateContent(id, templateId) {
    return request("GET", `${STANDARD_BASE}/${id}/templates/${templateId}/content`, { raw: true });
  }

  async function sendStandardTemplateTest(id, templateId, { channel, email, phoneNumber, variables } = {}) {
    return request("POST", `${STANDARD_BASE}/${id}/templates/${templateId}:send`, {
      body: { channel, email, phoneNumber, variables },
    });
  }

  async function removeStandardTemplate(id, templateId) {
    return request("DELETE", `${STANDARD_BASE}/${id}/templates/${templateId}`);
  }

  // ── Aggregated Notification Types ───────────────────────────

  const AGGREGATED_BASE = "/private/api/aggregated-notification-types";

  async function createAggregated({ name, senderName } = {}) {
    return request("POST", AGGREGATED_BASE, { body: { name, senderName } });
  }

  async function patchAggregated(id, patch = {}) {
    return request("PATCH", `${AGGREGATED_BASE}/${id}`, { body: patch });
  }

  async function findAggregated(id) {
    return request("GET", `${AGGREGATED_BASE}/${id}`);
  }

  async function queryAggregated({ search, page, size, sortBy, direction } = {}) {
    return request("GET", AGGREGATED_BASE, {
      query: { search, page, size, sortBy, direction },
    });
  }

  async function deleteAggregated(id) {
    return request("DELETE", `${AGGREGATED_BASE}/${id}`);
  }

  async function addAggregatedTemplate(id, { name, language, syntax, subject, contentPath, contentType } = {}) {
    return request("POST", `${AGGREGATED_BASE}/${id}/templates`, {
      formData: await buildTemplateForm({ name, language, syntax, subject, contentPath, contentType }),
    });
  }

  async function updateAggregatedTemplate(id, templateId, { name, language, syntax, subject, contentPath, contentType } = {}) {
    return request("PUT", `${AGGREGATED_BASE}/${id}/templates/${templateId}`, {
      formData: await buildTemplateForm({ name, language, syntax, subject, contentPath, contentType }),
    });
  }

  async function findAggregatedTemplate(id, templateId) {
    return request("GET", `${AGGREGATED_BASE}/${id}/templates/${templateId}`);
  }

  async function downloadAggregatedTemplateContent(id, templateId) {
    return request("GET", `${AGGREGATED_BASE}/${id}/templates/${templateId}/content`, { raw: true });
  }

  async function removeAggregatedTemplate(id, templateId) {
    return request("DELETE", `${AGGREGATED_BASE}/${id}/templates/${templateId}`);
  }

  return {
    createStandard,
    patchStandard,
    findStandard,
    queryStandards,
    deleteStandard,
    addStandardTemplate,
    updateStandardTemplate,
    findStandardTemplate,
    downloadStandardTemplateContent,
    sendStandardTemplateTest,
    removeStandardTemplate,
    createAggregated,
    patchAggregated,
    findAggregated,
    queryAggregated,
    deleteAggregated,
    addAggregatedTemplate,
    updateAggregatedTemplate,
    findAggregatedTemplate,
    downloadAggregatedTemplateContent,
    removeAggregatedTemplate,
  };
}

async function buildTemplateForm({ name, language, syntax, subject, contentPath, contentType }) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const bytes = fs.readFileSync(contentPath);
  const file = new Blob([bytes], { type: contentType ?? "text/html" });
  const form = new FormData();
  form.set("name", name);
  form.set("language", language);
  form.set("syntax", syntax);
  form.set("subject", subject);
  form.set("content", file, path.basename(contentPath));
  return form;
}
