import { createClient } from "../analytics-client.js";
import { step, ok, fail, summary } from "../log.js";
import { BASE, KPI, PERIOD, PERIOD_TYPE, SECOND_KPI, TOKEN, YTD, settings } from "../settings.js";
import { kpiPerOrganisationDashboard } from "./specs.js";

const env = settings("dashboard data stream", {
  BASE,
  TOKEN: { ...TOKEN, needsRealValue: "Bedrock does not know the built-in dev user, so every kpiPerOrganisation tile fails" },
  KPI,
  PERIOD,
  PERIOD_TYPE,
  YTD,
  SECOND_KPI,
});

const analytics = createClient(env.BASE, { accessToken: env.TOKEN });
const PERIOD_QUERY = {
  selectedPeriod: Number(env.PERIOD),
  selectedPeriodType: env.PERIOD_TYPE,
  ytd: env.YTD === "true",
};

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

function checkTileEvent(event, tileId) {
  const answer = event.data?.answer;
  if (event.id === tileId && event.data?.tileId === tileId) ok(`tile event for ${tileId}`);
  else fail(`tile event does not name ${tileId}: id=${event.id} tileId=${event.data?.tileId}`);
  if (answer?.period && answer?.kpi && Array.isArray(answer?.kpisPerSubOrganisation)) {
    ok(`answer has period, kpi and ${answer.kpisPerSubOrganisation.length} sub-organisations`);
  } else {
    fail("answer lacks period, kpi or kpisPerSubOrganisation");
  }
}

async function run() {
  // ── 1. Create a dashboard with two tiles ───────────────────
  step(env.SECOND_KPI ? "1. Create a dashboard with two kpiPerOrganisation tiles" : "1. Create a dashboard with one kpiPerOrganisation tile");
  const spec = kpiPerOrganisationDashboard({ kpi: env.KPI });
  if (env.SECOND_KPI) {
    spec.tiles.push({ ...spec.tiles[0], title: "Second tile", data: { source: "kpiPerOrganisation", kpi: env.SECOND_KPI } });
  }
  const { data: dashboard } = await analytics.createDashboard(spec);
  const tileIds = dashboard.tiles.map((tile) => tile.id);
  ok(`Created: ${dashboard.id} with tiles ${tileIds.join(", ")}`);

  // ── 2. Stream the selected period ──────────────────────────
  step("2. Stream tile data for the selected period");
  const events = await analytics.streamDashboardData(dashboard.id, PERIOD_QUERY);
  const tileEvents = events.filter((event) => event.event === "tile");
  for (const tileId of tileIds) {
    const event = tileEvents.find((candidate) => candidate.data?.tileId === tileId);
    if (event) checkTileEvent(event, tileId);
    else fail(`no tile event for ${tileId}`);
  }
  const failed = events.filter((event) => event.event === "tileFailed");
  if (failed.length === 0) ok("no tileFailed events");
  else fail(`tileFailed events: ${JSON.stringify(failed.map((event) => event.data))}`);
  if (events.at(-1)?.event === "complete") ok("stream ends with complete");
  else fail(`stream ended without complete, last event: ${events.at(-1)?.event}`);

  // ── 3. Stream from the year start ──────────────────────────
  step("3. Stream tile data from the year start (ytd=true)");
  const ytdEvents = await analytics.streamDashboardData(dashboard.id, { ...PERIOD_QUERY, ytd: true });
  const ytdTile = ytdEvents.find((event) => event.event === "tile");
  if (ytdTile?.data?.answer?.period?.ytd === true) ok("answer period carries ytd=true");
  else fail(`answer period ytd: ${ytdTile?.data?.answer?.period?.ytd}`);

  // ── 4. Rejections ───────────────────────────────────────────
  step("4. Missing period parameters (expected 400)");
  await expectRejected("Missing period", 400, () => analytics.streamDashboardData(dashboard.id, {}));

  step("5. Unknown dashboard id (expected 404)");
  await expectRejected("Unknown id", 404, () =>
    analytics.streamDashboardData("D-00000000-0000-4000-8000-000000000000", PERIOD_QUERY)
  );

  step("6. No token (expected 401)");
  await expectRejected("No token", 401, () => analytics.streamDashboardData(dashboard.id, { ...PERIOD_QUERY, token: null }));

  if (!summary("dashboard data stream")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
