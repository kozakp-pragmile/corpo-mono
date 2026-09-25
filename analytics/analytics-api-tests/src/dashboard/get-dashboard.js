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
    fail(`${label} was unexpectedly answered`);
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

  // ── 1. Create a dashboard to read back ─────────────────────
  step("1. Create a schema version 2 dashboard");
  const { data: created } = await analytics.createDashboard(kpiPerOrganisationDashboard());
  ok(`Created: ${created.id}`);

  // ── 2. Get it back ──────────────────────────────────────────
  step("2. Get the dashboard by id via the public prefix");
  const found = await analytics.findDashboard(created.id);
  if (JSON.stringify(found) === JSON.stringify(created)) ok("Served exactly as created");
  else fail("Served dashboard differs from the created one");

  step("3. Get the dashboard by id via the private prefix");
  const foundPrivately = await privateAnalytics.findDashboard(created.id);
  if (JSON.stringify(foundPrivately) === JSON.stringify(created)) ok("Served exactly as created");
  else fail("Served dashboard differs from the created one");

  // ── 4. Rejections ───────────────────────────────────────────
  step("4. Unknown dashboard id (expected 404)");
  await expectRejected("Unknown id", 404, () => analytics.findDashboard("D-00000000-0000-4000-8000-000000000000"));

  step("5. Malformed dashboard id (expected 400)");
  await expectRejected("Malformed id", 400, () => analytics.findDashboard("not-a-dashboard-id"));

  step("6. No token (expected 401)");
  await expectRejected("No token", 401, () => analytics.findDashboard(created.id, { token: null }));

  if (!summary("dashboard get")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
