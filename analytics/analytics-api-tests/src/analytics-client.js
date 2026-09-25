import { requestLine, columns, json } from "./log.js";

const DEFAULT_BASE_URL = "http://localhost:4360/analytics/server";
// Long-lived dev JWT (sub jwt-example, expires 2045) signed by the local auth-service keystore.
const DEV_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiI0NTY3Iiwic3ViIjoiand0LWV4YW1wbGUiLCJhdWQiOiI0NTY3IiwibG4iOiJFeGFtcGxlIiwiZm4iOiJKV1QiLCJmaW5nZXJQcmludEhhc2giOiI3MDI0OTE0Y2MyNTFjZmU2OTZmOWYwZDg3NTdhNzA3ZTlhZDc3NTIzYmYzMDY5ZWRiODQ5N2M1NTFjMzUyNThhIiwiZ3IiOlsiRXZlcnlvbmUiXSwiZXhwIjoyMzc1MjIyNTM0LCJpYXQiOjE2NTUyMjI1MzQsImVtYWlsIjoiand0LWV4YW1wbGVAZXhhbXBsZS5jb20ifQ.Dox5PkcLaUuU3UYsj5vmNzt9czCVPfz4ptHaE_Z7pA4DvvZWyv0UPOBP9q9k2UCHZLR79Nqbw87o_b4MWweHAqNlXcuPQx36KIIwHn_K2ZH7Lw9vBGsGP5idEMo8OzPP5Fdx80v0jNyxVvqhVXpElmmIN5xY4mVfC-xkoM2HzGxt_QOD4vV98LajrM3Pu7bDyFFaKIaPWGBDMpfVSxK3mQpVD3IJmu7lLtOolc3o_ykkSLnXlUM_NJSHnuDxaMe7IMjYB5m5k-GZEat85YSXhpgXKI_-r4-Wv8OJMOtSM3lToW50SP1Amub313QHhrLF-0IojlGqU7dWeJdVWSkULQ";

export function createClient(baseUrl = DEFAULT_BASE_URL, { accessToken = DEV_TOKEN, prefix = "/public" } = {}) {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const dashboardsBase = `${prefix}/api/v1/dashboards`;

  function url(path, query) {
    const target = new URL(base + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null) continue;
      target.searchParams.set(k, v);
    }
    return target;
  }

  function headers(token, extra = {}) {
    return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
  }

  async function request(method, path, { body, query, token = accessToken } = {}) {
    const target = url(path, query);
    const requestHeaders = headers(token, body === undefined ? {} : { "Content-Type": "application/json" });
    const res = await fetch(target, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let data;
    try {
      data = text.length === 0 ? null : JSON.parse(text);
    } catch {
      data = text;
    }

    requestLine(method, target.pathname + target.search, res.status);
    columns("Request", body, "Response", data);

    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { data, location: res.headers.get("location") };
  }

  // ── Dashboards ──────────────────────────────────────────────

  async function createDashboard(spec, { token } = {}) {
    return request("POST", dashboardsBase, { body: spec, token });
  }

  async function findDashboard(id, { token } = {}) {
    const { data } = await request("GET", `${dashboardsBase}/${encodeURIComponent(id)}`, { token });
    return data;
  }

  // ── Dashboard data (server-sent events) ─────────────────────
  // Reads the stream until the `complete` event or the end of the body, and returns every event.

  async function streamDashboardData(
    id,
    { selectedPeriod, selectedPeriodType, ytd, token = accessToken, timeoutMs = 30000 } = {}
  ) {
    const target = url(`${dashboardsBase}/${encodeURIComponent(id)}/data`, { selectedPeriod, selectedPeriodType, ytd });
    const res = await fetch(target, {
      headers: headers(token, { Accept: "text/event-stream" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    requestLine("GET", target.pathname + target.search, res.status);

    if (!res.ok) {
      const text = await res.text();
      let data;
      try {
        data = text.length === 0 ? null : JSON.parse(text);
      } catch {
        data = text;
      }
      columns("Request", null, "Response", data);
      const err = new Error(`GET ${target.pathname} → ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    const events = [];
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const event = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (!event) continue;
        events.push(event);
        json(`event: ${event.event}${event.id ? `  id: ${event.id}` : ""}`, event.data);
        if (event.event === "complete") return events;
      }
    }
    return events;
  }

  return { createDashboard, findDashboard, streamDashboardData };
}

function parseEvent(block) {
  let event = "message";
  let id;
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0 && event === "message") return null;
  const raw = dataLines.join("\n");
  let data;
  try {
    data = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { event, id, data };
}
