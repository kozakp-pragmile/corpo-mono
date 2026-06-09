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

  async function request(method, path, { body, query, formData, raw, accessToken } = {}) {
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

    const headers = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : { ...onBehalfOfHeaders };
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

  async function createStandard({ name, description, channel, senderName, aggregatedNotificationTypeId, defaultNotificationTiming } = {}) {
    return request("POST", STANDARD_BASE, {
      body: { name, description, channel, senderName, aggregatedNotificationTypeId, defaultNotificationTiming },
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

  // ── Legacy Notification Types ───────────────────────────────

  const LEGACY_BASE = "/private/api/notification-types";

  async function createLegacy({ name, channel, senderName, defaultTiming } = {}) {
    return request("POST", LEGACY_BASE, {
      body: { name, channel, senderName, defaultTiming },
    });
  }

  async function findLegacy(id) {
    return request("GET", `${LEGACY_BASE}/${id}`);
  }

  async function deleteLegacy(id, version) {
    return request("DELETE", `${LEGACY_BASE}/${id}`, { query: { version } });
  }

  async function addLegacyTemplate(
    id,
    { name, language, syntax, type = "STANDARD", aggregationDisplayType, subject, contentPath, content, contentType, version = 0 } = {}
  ) {
    return request("POST", `${LEGACY_BASE}/${id}/templates`, {
      formData: await buildLegacyTemplateForm({
        name,
        language,
        syntax,
        type,
        aggregationDisplayType,
        subject,
        contentPath,
        content,
        contentType,
        version,
      }),
    });
  }

  async function removeLegacyTemplate(id, templateId, version) {
    return request("DELETE", `${LEGACY_BASE}/${id}/templates/${templateId}`, {
      query: { version },
    });
  }

  // Legacy notification types have no per-type image endpoint; images are global
  // (see Global Images below) and resolved into templates by name at render time.

  // ── Recipient Configurations ────────────────────────────────

  const RECIPIENTS_BASE = "/private/api/recipients";

  async function createRecipient({ name, authId, externalIdSource, externalIdValue, email, phoneNumber, languages } = {}) {
    return request("POST", RECIPIENTS_BASE, {
      body: {
        name,
        authId,
        externalId: { source: externalIdSource, value: externalIdValue },
        email,
        phoneNumber,
        languages,
      },
    });
  }

  async function findRecipient(id) {
    return request("GET", `${RECIPIENTS_BASE}/${id}`);
  }

  async function setRecipientSchedule(id, { hour, minute, timeZone, daysOfWeek } = {}) {
    return request("PUT", `${RECIPIENTS_BASE}/${id}/schedule`, {
      body: { hour, minute, timeZone, daysOfWeek },
    });
  }

  async function deleteRecipient(id) {
    return request("DELETE", `${RECIPIENTS_BASE}/${id}`);
  }

  // ── Global Templates ────────────────────────────────────────

  const GLOBAL_TEMPLATES_BASE = "/public/api/global-templates";

  async function addGlobalTemplate(
    { name, language, syntax, subject, contentPath, content, contentType, aggregationDisplayType = "STANDARD", accessToken } = {}
  ) {
    return request("POST", GLOBAL_TEMPLATES_BASE, {
      formData: await buildGlobalTemplateForm({
        name,
        language,
        syntax,
        subject,
        contentPath,
        content,
        contentType,
        aggregationDisplayType,
      }),
      accessToken,
    });
  }

  async function deleteGlobalTemplate(id, accessToken) {
    return request("DELETE", `${GLOBAL_TEMPLATES_BASE}/${id}`, { accessToken });
  }

  // ── Global Images ───────────────────────────────────────────

  const GLOBAL_IMAGES_BASE = "/public/api/global-images";

  async function addGlobalImage({ name, imagePath, contentType, accessToken } = {}) {
    return request("POST", GLOBAL_IMAGES_BASE, {
      formData: await buildImageForm({ name, imagePath, contentType }),
      accessToken,
    });
  }

  async function queryGlobalImages({ name, page, size, sortBy, direction, accessToken } = {}) {
    return request("GET", GLOBAL_IMAGES_BASE, {
      query: { name, page, size, sortBy, direction },
      accessToken,
    });
  }

  async function deleteGlobalImage(id, accessToken) {
    return request("DELETE", `${GLOBAL_IMAGES_BASE}/${id}`, { accessToken });
  }

  // ── Notification Orders ─────────────────────────────────────

  const ORDERS_BASE = "/private/api/notification-orders";

  async function createNotificationOrder({
    notificationTypeId,
    recipients,
    tags,
    sender,
    variables,
    timing = "DEFAULT",
    attachmentIds,
  } = {}) {
    return request("POST", ORDERS_BASE, {
      body: { notificationTypeId, recipients, tags, sender, variables, timing, attachmentIds },
    });
  }

  async function findNotificationOrder(id) {
    return request("GET", `${ORDERS_BASE}/${id}`);
  }

  // ── Aggregated Notification Types ───────────────────────────

  const AGGREGATED_BASE = "/private/api/aggregated-notification-types";

  async function createAggregated({ name, description, senderName } = {}) {
    return request("POST", AGGREGATED_BASE, { body: { name, description, senderName } });
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
    createLegacy,
    findLegacy,
    deleteLegacy,
    addLegacyTemplate,
    removeLegacyTemplate,
    createRecipient,
    findRecipient,
    setRecipientSchedule,
    deleteRecipient,
    addGlobalTemplate,
    deleteGlobalTemplate,
    addGlobalImage,
    queryGlobalImages,
    deleteGlobalImage,
    createNotificationOrder,
    findNotificationOrder,
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

async function buildGlobalTemplateForm({
  name,
  language,
  syntax,
  subject,
  contentPath,
  content,
  contentType,
  aggregationDisplayType,
}) {
  const path = await import("node:path");
  // Either inline `content` (e.g. HTML with a runtime-injected image id) or a file path.
  const fileName = contentPath ? path.basename(contentPath) : `${name}.html`;
  const bytes = content !== undefined ? content : (await import("node:fs")).readFileSync(contentPath);
  const file = new Blob([bytes], { type: contentType ?? "text/html" });
  const form = new FormData();
  form.set("name", name);
  form.set("language", language);
  form.set("syntax", syntax);
  form.set("subject", subject);
  form.set("aggregationDisplayType", aggregationDisplayType);
  form.set("content", file, fileName);
  return form;
}

async function buildImageForm({ name, imagePath, version, contentType }) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const bytes = fs.readFileSync(imagePath);
  const inferredType = contentType ?? inferImageContentType(imagePath);
  const file = new Blob([bytes], { type: inferredType });
  const form = new FormData();
  form.set("name", name);
  if (version !== undefined && version !== null) {
    form.set("version", String(version));
  }
  form.set("image", file, path.basename(imagePath));
  return form;
}

function inferImageContentType(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

async function buildLegacyTemplateForm({
  name,
  language,
  syntax,
  type,
  aggregationDisplayType,
  subject,
  contentPath,
  content,
  contentType,
  version,
}) {
  const path = await import("node:path");
  // Either inline `content` (e.g. HTML with a rewritten image reference) or a file path.
  const fileName = contentPath ? path.basename(contentPath) : `${name}.html`;
  const bytes = content !== undefined ? content : (await import("node:fs")).readFileSync(contentPath);
  const file = new Blob([bytes], { type: contentType ?? "text/html" });
  const form = new FormData();
  form.set("name", name);
  form.set("language", language);
  form.set("syntax", syntax);
  form.set("type", type);
  if (aggregationDisplayType) {
    form.set("aggregationDisplayType", aggregationDisplayType);
  }
  form.set("subject", subject);
  form.set("version", String(version));
  form.set("content", file, fileName);
  return form;
}
