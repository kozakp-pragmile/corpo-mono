import { createClient } from "../analytics-client.js";
import { step, ok, fail, summary } from "../log.js";
import { kpiPerOrganisationDashboard } from "./specs.js";

const BASE_URL = process.env.ANALYTICS_URL || "http://localhost:4360/analytics/server";

const analytics = createClient(BASE_URL, { accessToken: process.env.ANALYTICS_TOKEN || undefined });
const privateAnalytics = createClient(BASE_URL, {
  accessToken: process.env.ANALYTICS_TOKEN || undefined,
  prefix: "/private",
});

async function expectRejected(label, expectedStatus, call) {
  try {
    await call();
    fail(`${label} was unexpectedly accepted`);
  } catch (e) {
    if (e.status === expectedStatus) {
      ok(`Rejected as expected — status ${e.status}, detail: ${e.data?.detail ?? JSON.stringify(e.data)}`);
    } else {
      fail(`${label} — expected ${expectedStatus}, got ${e.status ?? e.message}`);
    }
  }
}

async function run() {
  console.log(`\nAnalytics API: ${BASE_URL}\n`);

  // ── 1. Create via the public prefix ────────────────────────
  step("1. Create a schema version 2 dashboard via the public prefix");
  const spec = kpiPerOrganisationDashboard();
  const { data: dashboard, location } = await analytics.createDashboard(spec);
  if (/^D-[0-9a-f-]{36}$/.test(dashboard.id)) ok(`Dashboard id minted: ${dashboard.id}`);
  else fail(`Unexpected dashboard id: ${dashboard.id}`);
  if (/^T-[0-9a-f-]{36}$/.test(dashboard.tiles[0]?.id)) ok(`Tile id minted: ${dashboard.tiles[0].id}`);
  else fail(`Unexpected tile id: ${dashboard.tiles[0]?.id}`);
  if (location?.endsWith(`/public/api/v1/dashboards/${dashboard.id}`)) ok(`Location: ${location}`);
  else fail(`Unexpected Location: ${location}`);
  if (JSON.stringify(dashboard.tiles[0].data) === JSON.stringify(spec.tiles[0].data)) ok("Tile data returned verbatim");
  else fail("Tile data differs from what was sent");

  // ── 2. Create via the private prefix ───────────────────────
  step("2. Create via the private prefix (Location carries /private)");
  const { location: privateLocation } = await privateAnalytics.createDashboard(kpiPerOrganisationDashboard());
  if (privateLocation?.includes("/private/api/v1/dashboards/")) ok(`Location: ${privateLocation}`);
  else fail(`Unexpected Location: ${privateLocation}`);

  // ── 3. Rejections ───────────────────────────────────────────
  step("3. Unknown source (expected 400)");
  await expectRejected("Unknown source", 400, () =>
    analytics.createDashboard({
      ...spec,
      tiles: [{ ...spec.tiles[0], data: { source: "unknownSource", kpi: "215" } }],
    })
  );

  step("4. Missing required source field kpi (expected 400)");
  await expectRejected("Missing kpi", 400, () =>
    analytics.createDashboard({ ...spec, tiles: [{ ...spec.tiles[0], data: { source: "kpiPerOrganisation" } }] })
  );

  step("5. Field the source does not declare (expected 400)");
  await expectRejected("Undeclared field", 400, () =>
    analytics.createDashboard({
      ...spec,
      tiles: [{ ...spec.tiles[0], data: { source: "kpiPerOrganisation", kpi: "215", depth: 2 } }],
    })
  );

  step("6. Tile id sent by the writer (expected 400)");
  await expectRejected("Writer tile id", 400, () =>
    analytics.createDashboard({ ...spec, tiles: [{ id: "T-mine", ...spec.tiles[0] }] })
  );

  step("7. Unknown tile type (expected 400)");
  await expectRejected("Unknown tile type", 400, () =>
    analytics.createDashboard({ ...spec, tiles: [{ ...spec.tiles[0], type: "gauge" }] })
  );

  step("8. Blank title (expected 400)");
  await expectRejected("Blank title", 400, () => analytics.createDashboard({ ...spec, title: " " }));

  step("9. Unknown schema version (expected 400)");
  await expectRejected("Unknown schema version", 400, () => analytics.createDashboard({ ...spec, schemaVersion: 99 }));

  step("10. No token (expected 401)");
  await expectRejected("No token", 401, () => analytics.createDashboard(spec, { token: null }));

  if (!summary("dashboard create")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
