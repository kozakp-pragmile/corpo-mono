import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates", "legacy-aggregation");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Global templates live under /public/api and require a bearer token (a JWT with
// roleNotificationContentManager). Pass PIGEON_BEARER_TOKEN to override; otherwise
// this baked-in dev token is used so the full EN/DE/PL scenario runs out of the box.
const DEFAULT_BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiIxMjM0IiwiYXVkIjoiMTIzNCIsInN1YiI6ImFkbWluIiwiZm4iOiJQaWdlb24iLCJsbiI6IkFkbWluIiwicm9sZXMiOlsicm9sZU5vdGlmaWNhdGlvbkNvbnRlbnRNYW5hZ2VyIl0sImdyIjpbIkV2ZXJ5b25lIl0sImlhdCI6MTc4MDM5MTA2NX0.fjr0784ceEDypPfXSbXZ8R_iKaPsnqCLGFn8WSDdkHhRYZVoYiCUDL-K4QCnTgj5-rWfInpfZ1WdK8Imgewz7T11naXOeTiVdifc7tV3qlCeSnT6klRyXpedc8xvs4pcPPXng5Fq_JQKzipQm2_7Qz7VicDDwZT21SoVGpkm3sSy0dC0iZtzNl_URV1zTOlcmlhkTM8N_X7wXKfy_YwmlEXc-nSbLxcYim7JFkKrkR1256YWfYqyCn3fJvZ41CieNohFTTJxAOgdKC1Q1js6iHXV6A_01E3Hs3w597iixiq8BgA240KaP_xdwKANHW1HNQZXF4PhXoAJSpCa-OEX5Q";
const GLOBAL_TOKEN = process.env.PIGEON_BEARER_TOKEN || DEFAULT_BEARER_TOKEN;

const SENDER_EMAIL = "sender@no-reply.com";
const TAG = "pigeon-api-tests-legacy-aggregation";

// Aggregation is flushed by a background scheduler at each recipient's scheduled
// time — there is no manual trigger. The latest recipient fires at +3 minutes, so
// allow a comfortable margin on top.
const ORDER_POLL_TIMEOUT_MS = 6 * 60_000;
const ORDER_POLL_INTERVAL_MS = 5_000;
// The scheduler fires at whole minutes (HH:MM:00). Keep the earliest schedule at
// least this far in the future so a run starting late in a minute never fires a few
// seconds early — or, after truncation, a whole minute early.
const SCHEDULE_SAFETY_MS = 30_000;

const pigeon = createClient(BASE_URL);

// ── Recipients ────────────────────────────────────────────────
// Each recipient has a different preferred-language order and a schedule that
// fires N minutes from now, so the three aggregated emails arrive one minute apart.
const RECIPIENTS = [
  {
    key: "EN",
    name: "Emma English (EN recipient)",
    email: "emma.english.legacy-agg@example.com",
    externalIdValue: "pigeon-api-tests-legacy-agg-en",
    languages: ["en"],
    offsetMinutes: 1,
  },
  {
    key: "DE",
    name: "Dieter Deutsch (DE recipient)",
    email: "dieter.deutsch.legacy-agg@example.com",
    externalIdValue: "pigeon-api-tests-legacy-agg-de",
    languages: ["de", "en"],
    offsetMinutes: 2,
  },
  {
    key: "PL",
    name: "Paulina Polski (PL recipient)",
    email: "paulina.polski.legacy-agg@example.com",
    externalIdValue: "pigeon-api-tests-legacy-agg-pl",
    languages: ["pl", "en"],
    offsetMinutes: 3,
  },
];

const EXTERNAL_ID_SOURCE = "BMP";

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  // Global templates live under /public/api and require a JWT with the
  // "roleNotificationContentManager" authority. The /private endpoints used by the
  // rest of the test are open, so without a token we still run the EN recipient's
  // digest (single notification type → Type 1's OWN AGGREGATE template, no global
  // needed) and skip the DE/PL digests, which span two types and can only be
  // wrapped by a global template.
  const fullScenario = Boolean(GLOBAL_TOKEN);
  const activeRecipients = fullScenario ? RECIPIENTS : RECIPIENTS.filter((recipient) => recipient.key === "EN");

  if (fullScenario) {
    console.log("Mode: FULL — PIGEON_BEARER_TOKEN present, exercising EN, DE and PL digests.\n");
  } else {
    console.log(
      "Mode: REDUCED — PIGEON_BEARER_TOKEN not set.\n" +
        "  • Running only the EN recipient (single-type digest via /private, no token needed).\n" +
        "  • Skipping global templates and the DE/PL multi-type digests, which require a\n" +
        "    /public/api/global-templates token (JWT with roleNotificationContentManager).\n" +
        "  • Set PIGEON_BEARER_TOKEN to run the full scenario.\n"
    );
  }

  const created = {
    recipientIds: {},
    type1Id: null,
    type2Id: null,
    globalTemplateIds: [],
  };

  try {
    // ── 1. Create the recipients (languages set here, schedule set later) ──
    for (const recipient of activeRecipients) {
      step(`Create recipient ${recipient.key} — preferred languages [${recipient.languages.join(", ")}]`);
      const result = await pigeon.createRecipient({
        name: recipient.name,
        externalIdSource: EXTERNAL_ID_SOURCE,
        externalIdValue: recipient.externalIdValue,
        email: recipient.email,
        languages: recipient.languages,
      });
      created.recipientIds[recipient.key] = result.id;
      recipient.id = result.id;
      ok(`Recipient ${recipient.key}: ${result.id}`);
    }

    // ── 2. Notification Type 1 "Stock Valuation" — STANDARD pl/en/de + AGGREGATE en ──
    step('Create Notification Type 1 "Stock Valuation" (EMAIL, DAILY)');
    const type1 = await pigeon.createLegacy({
      name: `Stock Valuation (legacy-agg) ${Date.now()}`,
      channel: "EMAIL",
      senderName: "Pigeon Legacy Aggregation — Type 1",
      defaultTiming: "DAILY",
    });
    created.type1Id = type1.id;
    ok(`Type 1: ${type1.id}`);

    let type1Version = type1.version;
    type1Version = await addLegacyTemplate(type1.id, type1Version, {
      name: "Type1 Standard EN",
      language: "en",
      type: "STANDARD",
      subject: "STD · Type1 Stock Valuation · EN · [[${orderLabel}]]",
      contentPath: resolve(TEMPLATES_DIR, "standard-type1-en.html"),
    });
    type1Version = await addLegacyTemplate(type1.id, type1Version, {
      name: "Type1 Standard DE",
      language: "de",
      type: "STANDARD",
      subject: "STD · Typ1 Stock Valuation · DE · [[${orderLabel}]]",
      contentPath: resolve(TEMPLATES_DIR, "standard-type1-de.html"),
    });
    type1Version = await addLegacyTemplate(type1.id, type1Version, {
      name: "Type1 Standard PL",
      language: "pl",
      type: "STANDARD",
      subject: "STD · Typ1 Stock Valuation · PL · [[${orderLabel}]]",
      contentPath: resolve(TEMPLATES_DIR, "standard-type1-pl.html"),
    });
    type1Version = await addLegacyTemplate(type1.id, type1Version, {
      name: "Type1 Aggregate EN",
      language: "en",
      type: "AGGREGATE",
      aggregationDisplayType: "STANDARD",
      subject: "DIGEST · Type1 OWN aggregate template · EN",
      contentPath: resolve(TEMPLATES_DIR, "aggregate-type1-en.html"),
    });
    ok("Type 1 templates added: STANDARD [en, de, pl] + AGGREGATE [en]");

    // ── 3. Notification Type 2 "Financial Health" — STANDARD en only ──
    step('Create Notification Type 2 "Financial Health" (EMAIL, DAILY)');
    const type2 = await pigeon.createLegacy({
      name: `Financial Health (legacy-agg) ${Date.now()}`,
      channel: "EMAIL",
      senderName: "Pigeon Legacy Aggregation — Type 2",
      defaultTiming: "DAILY",
    });
    created.type2Id = type2.id;
    ok(`Type 2: ${type2.id}`);

    await addLegacyTemplate(type2.id, type2.version, {
      name: "Type2 Standard EN",
      language: "en",
      type: "STANDARD",
      subject: "STD · Type2 Financial Health · EN · [[${orderLabel}]]",
      contentPath: resolve(TEMPLATES_DIR, "standard-type2-en.html"),
    });
    ok("Type 2 templates added: STANDARD [en]");

    // ── 4. Global aggregate templates en/de/pl (fallback wrapper for multi-type digests) ──
    if (fullScenario) {
      step("Create GLOBAL aggregate templates [en, de, pl]");
      for (const language of ["en", "de", "pl"]) {
        const globalTemplate = await pigeon.addGlobalTemplate({
          name: `legacy-agg-global-${language}-${Date.now()}`,
          language,
          syntax: "THYMELEAF",
          subject: `DIGEST · GLOBAL aggregate · ${language.toUpperCase()}`,
          aggregationDisplayType: "STANDARD",
          contentPath: resolve(TEMPLATES_DIR, `global-aggregate-${language}.html`),
          accessToken: GLOBAL_TOKEN,
        });
        created.globalTemplateIds.push(globalTemplate.id);
        ok(`Global aggregate ${language.toUpperCase()}: ${globalTemplate.id}`);
      }
    } else {
      step("Skip GLOBAL aggregate templates (no token — DE/PL multi-type digests are not run)");
    }

    // ── 5. Set recipient schedules (fresh, so the offsets are measured from now) ──
    step("Set recipient schedules (fire ~1 / 2 / 3 minutes from now, UTC)");
    // Anchor every schedule to the start of the current minute, then add the offset,
    // so recipient times are exactly currentMinute + 1/2/3. If that would put the
    // earliest one too close to now, bump the whole anchor forward by one minute.
    let anchorMs = Math.floor(Date.now() / 60_000) * 60_000;
    const earliestOffset = Math.min(...activeRecipients.map((recipient) => recipient.offsetMinutes));
    if (anchorMs + earliestOffset * 60_000 - Date.now() < SCHEDULE_SAFETY_MS) {
      anchorMs += 60_000;
    }
    for (const recipient of activeRecipients) {
      const fireAt = new Date(anchorMs + recipient.offsetMinutes * 60_000);
      const schedule = {
        hour: fireAt.getUTCHours(),
        minute: fireAt.getUTCMinutes(),
        timeZone: "UTC",
      };
      await pigeon.setRecipientSchedule(recipient.id, schedule);
      recipient.fireAtUtc = `${pad2(schedule.hour)}:${pad2(schedule.minute)} UTC`;
      recipient.firesInSeconds = Math.round((fireAt.getTime() - Date.now()) / 1000);
      ok(`${recipient.key} → ${recipient.fireAtUtc} (~${recipient.firesInSeconds}s from now)`);
    }

    // ── 6. Define the six notification orders ─────────────────────
    const allOrders = [
      { index: 1, type: "type1", typeId: type1.id, recipientKeys: ["EN", "DE", "PL"] },
      { index: 2, type: "type1", typeId: type1.id, recipientKeys: ["PL"] },
      { index: 3, type: "type2", typeId: type2.id, recipientKeys: ["PL"] },
      { index: 4, type: "type1", typeId: type1.id, recipientKeys: ["DE"] },
      { index: 5, type: "type2", typeId: type2.id, recipientKeys: ["PL", "DE"] },
      { index: 6, type: "type1", typeId: type1.id, recipientKeys: ["EN"] },
    ];

    // Keep only recipients we actually created; drop orders left without any.
    const activeKeys = new Set(activeRecipients.map((recipient) => recipient.key));
    const orders = allOrders
      .map((order) => ({ ...order, recipientKeys: order.recipientKeys.filter((key) => activeKeys.has(key)) }))
      .filter((order) => order.recipientKeys.length > 0);

    printExpectations(orders, activeRecipients);

    // ── 7. Post the orders (timing DEFAULT → uses each type's DAILY timing) ──
    const orderIds = [];
    for (const order of orders) {
      const typeLabel = order.type === "type1" ? "Type1 Stock Valuation" : "Type2 Financial Health";
      const orderLabel = `Order ${order.index} · ${typeLabel} · → ${order.recipientKeys.join("+")}`;
      step(`Post ${orderLabel}`);
      const recipients = order.recipientKeys.map((key) => recipientInput(key));
      const result = await pigeon.createNotificationOrder({
        notificationTypeId: order.typeId,
        recipients,
        tags: [TAG],
        sender: SENDER_EMAIL,
        timing: "DEFAULT",
        variables: {
          orderLabel,
          note: `Generated by legacy-aggregation test for recipient(s) ${order.recipientKeys.join(", ")}.`,
        },
      });
      orderIds.push({ index: order.index, id: result.id, label: orderLabel });
      ok(`Accepted: ${result.id} (status: ${result.status ?? "n/a"})`);
    }

    // ── 8. Wait for the scheduler to flush every order ────────────
    step("Wait for the scheduler to flush all aggregated digests");
    console.log(
      "  Digests fire at the recipients' scheduled times (≈ +1 / +2 / +3 min). " +
        "Polling order statuses until all are PROCESSED…"
    );
    await waitForOrdersProcessed(orderIds);
  } finally {
    await cleanup(created);
  }

  console.log(`\n${"═".repeat(115)}`);
  console.log("  Done — legacy aggregation scenario complete");
  console.log(`${"═".repeat(115)}\n`);
}

function recipientInput(key) {
  const recipient = RECIPIENTS.find((r) => r.key === key);
  return {
    externalIdSource: EXTERNAL_ID_SOURCE,
    externalIdValue: recipient.externalIdValue,
  };
}

// Mirrors the backend aggregation rules so the console states exactly what each
// recipient should receive: which wrapper template, and how many standard parts
// in which language.
function printExpectations(orders, recipients) {
  console.log(`\n${"#".repeat(115)}`);
  console.log("# EXPECTED EMAILS PER RECIPIENT (verify these against the received inboxes)");
  console.log(`${"#".repeat(115)}`);

  const type1Languages = ["en", "de", "pl"];
  const type2Languages = ["en"];

  for (const recipient of recipients) {
    const suborders = orders.filter((order) => order.recipientKeys.includes(recipient.key));
    const distinctTypes = [...new Set(suborders.map((order) => order.type))];
    const singleType = distinctTypes.length === 1;

    let wrapper;
    if (suborders.length === 1) {
      wrapper = "NONE — a single pending part means a plain standard email, not a digest";
    } else if (singleType && distinctTypes[0] === "type1") {
      wrapper = `Type 1 OWN aggregate template (language: ${pickLanguage(recipient.languages, ["en"])})`;
    } else {
      wrapper = `GLOBAL aggregate template (language: ${pickLanguage(recipient.languages, ["en", "de", "pl"])})`;
    }

    const parts = suborders.map((order) => {
      const available = order.type === "type1" ? type1Languages : type2Languages;
      const lang = pickLanguage(recipient.languages, available);
      const typeLabel = order.type === "type1" ? "Type1 Stock Valuation" : "Type2 Financial Health";
      return `Order ${order.index} → ${typeLabel} standard part in ${lang.toUpperCase()}`;
    });

    console.log(`\n  ┌─ Recipient ${recipient.key} — "${recipient.name}"`);
    console.log(`  • preferred languages: [${recipient.languages.join(", ")}]`);
    console.log(
      `  • schedule: ${recipient.fireAtUtc ?? "n/a"}` +
        (recipient.firesInSeconds != null ? ` (~${recipient.firesInSeconds}s from now)` : "")
    );
    console.log(`  • receives: ${suborders.length === 1 ? "1 standard email" : "1 aggregated digest email"}`);
    console.log(`  • wrapper template: ${wrapper}`);
    console.log(`  • standard parts (${parts.length}):`);
    for (const part of parts) console.log(`      - ${part}`);
  }
  console.log("");
}

// First preferred language that has a template available, else first available
// (matches the backend's TemplateFinder fallback).
function pickLanguage(preferredLanguages, availableLanguages) {
  const match = preferredLanguages.find((language) => availableLanguages.includes(language));
  return match ?? availableLanguages[0];
}

async function addLegacyTemplate(typeId, version, template) {
  await pigeon.addLegacyTemplate(typeId, { ...template, syntax: "THYMELEAF", version });
  const refreshed = await pigeon.findLegacy(typeId);
  return refreshed.version;
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
      const remaining = [...pending.values()].map((order) => order.index).join(", ");
      console.log(`  … still waiting on order(s): ${remaining}`);
      await sleep(ORDER_POLL_INTERVAL_MS);
    }
  }

  if (pending.size > 0) {
    fail(
      `Timed out after ${ORDER_POLL_TIMEOUT_MS / 1000}s waiting for order(s): ` +
        [...pending.values()].map((order) => order.index).join(", ")
    );
  }
}

async function cleanup(created) {
  console.log(`\n${"#".repeat(115)}`);
  console.log("# Cleanup");
  console.log(`${"#".repeat(115)}`);

  for (const id of created.globalTemplateIds) {
    await safe(`Delete global template ${id}`, () => pigeon.deleteGlobalTemplate(id, GLOBAL_TOKEN));
  }
  for (const typeId of [created.type1Id, created.type2Id]) {
    if (!typeId) continue;
    await safe(`Delete notification type ${typeId}`, async () => {
      const current = await pigeon.findLegacy(typeId);
      await pigeon.deleteLegacy(typeId, current.version);
    });
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
