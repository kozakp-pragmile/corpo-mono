import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates", "aggregation-snt-ant-ckeditor");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";

const SENDER_EMAIL = "sender@no-reply.com";
const TAG = "pigeon-api-tests-aggregation-snt-ant-ckeditor";
const EXTERNAL_ID_SOURCE = "BMP";
const LANGUAGE = "en";

// Aggregation is flushed by a background scheduler at each recipient's scheduled
// time — there is no manual trigger. The latest recipient fires at +3 minutes, so
// allow a comfortable margin on top.
const ORDER_POLL_TIMEOUT_MS = 6 * 60_000;
const ORDER_POLL_INTERVAL_MS = 5_000;
// The scheduler fires at whole minutes (HH:MM:00). Keep the earliest schedule at
// least this far in the future so a run starting late in a minute never fires a few
// seconds early — or, after truncation, a whole minute early.
const SCHEDULE_SAFETY_MS = 30_000;

// Maps JS Date.getUTCDay() (0=Sunday..6=Saturday) to the java.time.DayOfWeek names
// the schedule API expects.
const DAY_OF_WEEK_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

const pigeon = createClient(BASE_URL);

// ── Aggregated notification types (ANT) ───────────────────────
// Digests are grouped by (recipient + ANT + timing). With TWO ANTs and the DAILY +
// WEEKLY timings, every recipient ends up with FOUR digest buckets. No global
// template is configured, so each ANT's OWN aggregate template is the digest wrapper.
// ANT1 uses an adjustable-CARD layout, ANT2 an adjustable-TABLE layout.
const ANT_DEFS = {
  ant1: {
    key: "ant1",
    name: "Markets Digest (ANT1)",
    senderName: "Pigeon SNT/ANT Aggregation — Markets Digest (ANT1)",
    format: "adjustable-card",
    wrapperFile: "aggregate-ant1-en.html",
    wrapperSubject: "DIGEST · ANT1 Markets · adjustable-card · EN",
  },
  ant2: {
    key: "ant2",
    name: "Operations Digest (ANT2)",
    senderName: "Pigeon SNT/ANT Aggregation — Operations Digest (ANT2)",
    format: "adjustable-table",
    wrapperFile: "aggregate-ant2-en.html",
    wrapperSubject: "DIGEST · ANT2 Operations · adjustable-table · EN",
  },
};

// ── Standard notification types (SNT) ─────────────────────────
// Five SNTs are spread across the two ANTs and the two timings so that EVERY one of
// the four (ANT × timing) buckets receives at least two standard parts and is therefore
// rendered as a real aggregated digest (a bucket with a single part is a plain standard
// email). ANT1/DAILY is fed by two DISTINCT SNTs (SNT1 + SNT2); the remaining buckets
// are fed by posting two orders of their single SNT.
const SNT_DEFS = {
  snt1: { key: "snt1", ant: "ant1", timing: "DAILY", label: "SNT1 Stock Valuation (daily)", standardFile: "standard-snt1-en.html", subject: "STD · SNT1 Stock Valuation (daily) · EN · {{orderLabel}}" },
  snt2: { key: "snt2", ant: "ant1", timing: "DAILY", label: "SNT2 FX Rates (daily)", standardFile: "standard-snt2-en.html", subject: "STD · SNT2 FX Rates (daily) · EN · {{orderLabel}}" },
  snt3: { key: "snt3", ant: "ant1", timing: "WEEKLY", label: "SNT3 Weekly Market Review (weekly)", standardFile: "standard-snt3-en.html", subject: "STD · SNT3 Weekly Market Review (weekly) · EN · {{orderLabel}}" },
  snt4: { key: "snt4", ant: "ant2", timing: "DAILY", label: "SNT4 System Health (daily)", standardFile: "standard-snt4-en.html", subject: "STD · SNT4 System Health (daily) · EN · {{orderLabel}}" },
  snt5: { key: "snt5", ant: "ant2", timing: "WEEKLY", label: "SNT5 Weekly Ops Summary (weekly)", standardFile: "standard-snt5-en.html", subject: "STD · SNT5 Weekly Ops Summary (weekly) · EN · {{orderLabel}}" },
};

// ── Recipients ────────────────────────────────────────────────
// Every recipient is subscribed to every SNT, so every recipient receives the same
// four digests. Schedules fire ~1 / 2 / 3 minutes from now so the digests arrive a
// minute apart and grouping-by-recipient is observable across distinct inboxes.
const RECIPIENTS = [
  {
    key: "R1",
    name: "Rachel One (recipient 1)",
    email: "rachel.one.snt-ant-agg@example.com",
    externalIdValue: "pigeon-api-tests-snt-ant-agg-r1",
    offsetMinutes: 1,
  },
  {
    key: "R2",
    name: "Robert Two (recipient 2)",
    email: "robert.two.snt-ant-agg@example.com",
    externalIdValue: "pigeon-api-tests-snt-ant-agg-r2",
    offsetMinutes: 2,
  },
  {
    key: "R3",
    name: "Rebecca Three (recipient 3)",
    email: "rebecca.three.snt-ant-agg@example.com",
    externalIdValue: "pigeon-api-tests-snt-ant-agg-r3",
    offsetMinutes: 3,
  },
];

// Orders posted to ALL recipients. `count` is how many orders of the SNT to post:
// buckets fed by a single SNT post twice so they still aggregate into a digest.
const ORDER_PLAN = [
  { snt: "snt1", count: 1 },
  { snt: "snt2", count: 1 },
  { snt: "snt3", count: 2 },
  { snt: "snt4", count: 2 },
  { snt: "snt5", count: 2 },
];

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);
  console.log(
    "Scenario: modern SNT/ANT aggregation, NO global templates.\n" +
      "  • 2 aggregated notification definitions (ANT1 card, ANT2 table)\n" +
      "  • 5 standard notification definitions linked across the ANTs and DAILY/WEEKLY\n" +
      "  • digests group by (recipient + ANT + timing) → every recipient gets 4 digest emails:\n" +
      "      ANT1/DAILY, ANT1/WEEKLY, ANT2/DAILY, ANT2/WEEKLY\n"
  );

  const created = {
    recipientIds: {},
    antIds: {},
    antTemplateIds: [],
    sntIds: {},
    sntTemplateIds: [],
  };

  try {
    // ── 1. Create the recipients (schedule set later) ──
    for (const recipient of RECIPIENTS) {
      step(`Create recipient ${recipient.key} — language [${LANGUAGE}]`);
      const result = await pigeon.createRecipient({
        name: recipient.name,
        externalIdSource: EXTERNAL_ID_SOURCE,
        externalIdValue: recipient.externalIdValue,
        email: recipient.email,
        languages: [LANGUAGE],
      });
      created.recipientIds[recipient.key] = result.id;
      recipient.id = result.id;
      ok(`Recipient ${recipient.key}: ${result.id}`);
    }

    // ── 2. Create the two ANTs with their aggregate wrapper templates ──
    for (const ant of Object.values(ANT_DEFS)) {
      step(`Create ${ant.name} (aggregated notification definition)`);
      const created_ant = await pigeon.createAggregated({
        name: `${ant.name} ${Date.now()}`,
        senderName: ant.senderName,
      });
      created.antIds[ant.key] = created_ant.id;
      ant.id = created_ant.id;
      ok(`${ant.name}: ${created_ant.id}`);

      step(`Add ${ant.name} aggregate template (CKEDITOR ${ant.format}, no loop — service injects it)`);
      const template = await pigeon.addAggregatedTemplate(ant.id, {
        name: `snt-ant-agg-${ant.key}-${Date.now()}`,
        language: LANGUAGE,
        syntax: "CKEDITOR",
        subject: ant.wrapperSubject,
        contentPath: resolve(TEMPLATES_DIR, ant.wrapperFile),
      });
      created.antTemplateIds.push({ antId: ant.id, templateId: template.templateId });
      ok(`${ant.name} aggregate template (${ant.format}): ${template.templateId}`);
    }

    // ── 3. Create the five SNTs (linked to their ANT) with a standard template ──
    for (const snt of Object.values(SNT_DEFS)) {
      const ant = ANT_DEFS[snt.ant];
      step(`Create ${snt.label} (EMAIL, ${snt.timing}, linked to ${ant.name})`);
      const created_snt = await pigeon.createStandard({
        name: `${snt.label} ${Date.now()}`,
        channel: "EMAIL",
        senderName: `Pigeon SNT/ANT Aggregation — ${snt.label}`,
        aggregatedNotificationDefinitionId: ant.id,
        defaultNotificationTiming: snt.timing,
      });
      created.sntIds[snt.key] = created_snt.id;
      snt.id = created_snt.id;
      ok(`${snt.label}: ${created_snt.id}`);

      step(`Add ${snt.label} standard template (CKEDITOR, ${LANGUAGE})`);
      const template = await pigeon.addStandardTemplate(snt.id, {
        name: `${snt.label} ${LANGUAGE.toUpperCase()}`,
        language: LANGUAGE,
        syntax: "CKEDITOR",
        subject: snt.subject,
        contentPath: resolve(TEMPLATES_DIR, snt.standardFile),
      });
      created.sntTemplateIds.push({ sntId: snt.id, templateId: template.templateId });
      ok(`${snt.label} standard template: ${template.templateId}`);
    }

    // ── 4. Set recipient schedules: fire ~1/2/3 min from now, with today as the
    //        only scheduled day so the WEEKLY digests also fire today ──
    step("Set recipient schedules (fire ~1 / 2 / 3 minutes from now, today as the weekly send day, UTC)");
    // Anchor every schedule to the start of the current minute, then add the offset,
    // so recipient times are exactly currentMinute + 1/2/3. If that would put the
    // earliest one too close to now, bump the whole anchor forward by one minute.
    let anchorMs = Math.floor(Date.now() / 60_000) * 60_000;
    const earliestOffset = Math.min(...RECIPIENTS.map((recipient) => recipient.offsetMinutes));
    if (anchorMs + earliestOffset * 60_000 - Date.now() < SCHEDULE_SAFETY_MS) {
      anchorMs += 60_000;
    }
    for (const recipient of RECIPIENTS) {
      const fireAt = new Date(anchorMs + recipient.offsetMinutes * 60_000);
      const sendDay = DAY_OF_WEEK_NAMES[fireAt.getUTCDay()];
      const schedule = {
        hour: fireAt.getUTCHours(),
        minute: fireAt.getUTCMinutes(),
        timeZone: "UTC",
        daysOfWeek: [sendDay],
      };
      await pigeon.setRecipientSchedule(recipient.id, schedule);
      recipient.fireAtUtc = `${pad2(schedule.hour)}:${pad2(schedule.minute)} UTC`;
      recipient.sendDay = sendDay;
      recipient.firesInSeconds = Math.round((fireAt.getTime() - Date.now()) / 1000);
      ok(`${recipient.key} → ${recipient.fireAtUtc} on ${sendDay} (~${recipient.firesInSeconds}s from now)`);
    }

    printExpectations();

    // ── 5. Post the orders (timing DEFAULT → uses each SNT's DAILY/WEEKLY timing) ──
    const recipients = RECIPIENTS.map((recipient) => recipientInput(recipient.key));
    const orderIds = [];
    for (const planned of ORDER_PLAN) {
      const snt = SNT_DEFS[planned.snt];
      for (let n = 1; n <= planned.count; n++) {
        const orderLabel = `Order ${snt.label}${planned.count > 1 ? ` #${n}` : ""}`;
        step(`Post ${orderLabel} → all recipients`);
        const result = await pigeon.createNotificationOrder({
          notificationTypeId: snt.id,
          recipients,
          tags: [TAG],
          sender: SENDER_EMAIL,
          timing: "DEFAULT",
          variables: {
            orderLabel,
            note: `Generated by aggregation-snt-ant-ckeditor test (${snt.label}, ${snt.timing}, ${ANT_DEFS[snt.ant].name}).`,
          },
        });
        orderIds.push({ id: result.id, label: orderLabel });
        ok(`Accepted: ${result.id} (status: ${result.status ?? "n/a"})`);
      }
    }

    // ── 6. Wait for the scheduler to flush every order ────────────
    step("Wait for the scheduler to flush all aggregated digests (4 per recipient)");
    console.log(
      "  Digests fire at the recipients' scheduled times (≈ +1 / +2 / +3 min). " +
        "Polling order statuses until all are PROCESSED…"
    );
    await waitForOrdersProcessed(orderIds);
  } finally {
    await cleanup(created);
  }

  if (!summary("SNT/ANT aggregation scenario — ADJUSTABLE CKEditor wrappers, 4 digests per recipient")) {
    process.exitCode = 1;
  }
}

function recipientInput(key) {
  const recipient = RECIPIENTS.find((r) => r.key === key);
  return {
    externalIdSource: EXTERNAL_ID_SOURCE,
    externalIdValue: recipient.externalIdValue,
  };
}

// States exactly what each recipient should receive: four digests, one per
// (ANT × timing) bucket, each wrapped by its ANT's own aggregate template and
// listing the standard parts that aggregate into it.
function printExpectations() {
  console.log(`\n${"#".repeat(115)}`);
  console.log("# EXPECTED EMAILS PER RECIPIENT (verify these against the received inboxes)");
  console.log("# Every recipient receives FOUR digests — one per (ANT × timing) bucket.");
  console.log("# No global template exists, so each digest is wrapped by its ANT's OWN aggregate template.");
  console.log(`${"#".repeat(115)}`);

  const buckets = computeBuckets();

  for (const recipient of RECIPIENTS) {
    console.log(`\n  ┌─ Recipient ${recipient.key} — "${recipient.name}"`);
    console.log(`  • language: [${LANGUAGE}]`);
    console.log(
      `  • schedule: ${recipient.fireAtUtc ?? "n/a"} on ${recipient.sendDay ?? "n/a"}` +
        (recipient.firesInSeconds != null ? ` (~${recipient.firesInSeconds}s from now)` : "")
    );

    for (const bucket of buckets) {
      const ant = ANT_DEFS[bucket.ant];
      console.log(`\n  ▼ ${bucket.timing} email — 1 aggregated digest (${bucket.parts.length} parts)`);
      console.log(`     • wrapper template: ${ant.name} aggregate · CKEditor ${ant.format} (${LANGUAGE})`);
      console.log(`     • standard parts (${bucket.parts.length}):`);
      for (const part of bucket.parts) console.log(`         - ${part}`);
    }
  }
  console.log("");
}

// Reconstructs the four (ANT × timing) buckets and the standard parts each receives
// from the order plan, so expectations stay in sync with what is actually posted.
function computeBuckets() {
  const byBucket = new Map();
  for (const planned of ORDER_PLAN) {
    const snt = SNT_DEFS[planned.snt];
    const bucketKey = `${snt.ant}|${snt.timing}`;
    const parts = byBucket.get(bucketKey) ?? { ant: snt.ant, timing: snt.timing, parts: [] };
    for (let n = 1; n <= planned.count; n++) {
      parts.parts.push(`${snt.label} standard part (CKEditor)${planned.count > 1 ? ` #${n}` : ""}`);
    }
    byBucket.set(bucketKey, parts);
  }
  return [...byBucket.values()].sort((a, b) =>
    a.ant === b.ant ? a.timing.localeCompare(b.timing) : a.ant.localeCompare(b.ant)
  );
}

async function waitForOrdersProcessed(orderIds) {
  const deadline = Date.now() + ORDER_POLL_TIMEOUT_MS;
  const pending = new Map(orderIds.map((order) => [order.id, order]));

  while (pending.size > 0 && Date.now() < deadline) {
    for (const [id, order] of [...pending.entries()]) {
      const current = await pigeon.findNotificationOrder(id);
      const status = current?.status;
      if (status === "PROCESSED") {
        ok(`${order.label} → PROCESSED`);
        pending.delete(id);
      } else if (status === "FAILED") {
        fail(`${order.label} → FAILED: ${current?.statusMessage ?? ""}`);
        pending.delete(id);
      }
    }
    if (pending.size > 0) {
      const remaining = [...pending.values()].map((order) => order.label).join(", ");
      console.log(`  … still waiting on order(s): ${remaining}`);
      await sleep(ORDER_POLL_INTERVAL_MS);
    }
  }

  if (pending.size > 0) {
    fail(
      `Timed out after ${ORDER_POLL_TIMEOUT_MS / 1000}s waiting for order(s): ` +
        [...pending.values()].map((order) => order.label).join(", ")
    );
  }
}

async function cleanup(created) {
  console.log(`\n${"#".repeat(115)}`);
  console.log("# Cleanup");
  console.log(`${"#".repeat(115)}`);

  // SNTs (and their templates) first — an ANT cannot be deleted while a linked SNT exists.
  for (const { sntId, templateId } of created.sntTemplateIds) {
    await safe(`Remove standard template ${templateId}`, () => pigeon.removeStandardTemplate(sntId, templateId));
  }
  for (const [key, id] of Object.entries(created.sntIds)) {
    await safe(`Delete standard notification definition ${key} (${id})`, () => pigeon.deleteStandard(id));
  }
  for (const { antId, templateId } of created.antTemplateIds) {
    await safe(`Remove aggregated template ${templateId}`, () => pigeon.removeAggregatedTemplate(antId, templateId));
  }
  for (const [key, id] of Object.entries(created.antIds)) {
    await safe(`Delete aggregated notification definition ${key} (${id})`, () => pigeon.deleteAggregated(id));
  }
  for (const [key, id] of Object.entries(created.recipientIds)) {
    await safe(`Delete recipient ${key} (${id})`, () => pigeon.deleteRecipient(id));
  }
}

async function safe(label, action) {
  step(label);
  try {
    await action();
    ok("Done");
  } catch (e) {
    fail(`${label} failed: ${e.message}`);
  }
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});
