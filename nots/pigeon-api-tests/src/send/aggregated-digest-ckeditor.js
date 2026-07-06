import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates", "aggregated-digest", "ckeditor");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Global templates live under /public/api and require a bearer token (a JWT with
// roleNotificationContentManager). Pass PIGEON_BEARER_TOKEN to override; otherwise
// this baked-in dev token is used so the full EN/DE/PL scenario runs out of the box.
const DEFAULT_BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiIxMjM0IiwiYXVkIjoiMTIzNCIsInN1YiI6ImFkbWluIiwiZm4iOiJQaWdlb24iLCJsbiI6IkFkbWluIiwicm9sZXMiOlsicm9sZU5vdGlmaWNhdGlvbkNvbnRlbnRNYW5hZ2VyIl0sImdyIjpbIkV2ZXJ5b25lIl0sImlhdCI6MTc4MDM5MTA2NX0.fjr0784ceEDypPfXSbXZ8R_iKaPsnqCLGFn8WSDdkHhRYZVoYiCUDL-K4QCnTgj5-rWfInpfZ1WdK8Imgewz7T11naXOeTiVdifc7tV3qlCeSnT6klRyXpedc8xvs4pcPPXng5Fq_JQKzipQm2_7Qz7VicDDwZT21SoVGpkm3sSy0dC0iZtzNl_URV1zTOlcmlhkTM8N_X7wXKfy_YwmlEXc-nSbLxcYim7JFkKrkR1256YWfYqyCn3fJvZ41CieNohFTTJxAOgdKC1Q1js6iHXV6A_01E3Hs3w597iixiq8BgA240KaP_xdwKANHW1HNQZXF4PhXoAJSpCa-OEX5Q";
const GLOBAL_TOKEN = process.env.PIGEON_BEARER_TOKEN || DEFAULT_BEARER_TOKEN;

const SENDER_EMAIL = "sender@no-reply.com";
const TAG = "pigeon-api-tests-aggregated-digest-ckeditor";

// Seeded singleton "default" aggregated notification definition. Its templates are the
// lowest-priority wrapper for multi-type digests (global templates override them per
// language). Reached via /private, so no bearer token is needed.
const DEFAULT_AGGREGATED_NOTIFICATION_DEFINITION_ID = "AND-00000000-0000-0000-0000-000000000001";
// Multi-type digest wrappers: EN/DE come from /public global templates, PL comes from
// the default aggregated notification definition. ALL wrappers here use frontend-authored
// CKEditor adjustable formats (table or card) instead of hand-written Thymeleaf —
// there is NO {{#messages}} loop, the service injects it around the prototype row/card.
const GLOBAL_WRAPPER_LANGUAGES = ["en", "de"];
const DEFAULT_ANT_WRAPPER_LANGUAGES = ["pl"];

// The frontend-authored format of each wrapper, used only to label the printed
// expectations. The format itself is declared by the CSS class inside the HTML.
const GLOBAL_WRAPPER_FORMAT = { en: "adjustable-table", de: "adjustable-card" };
const DEFAULT_ANT_WRAPPER_FORMAT = { pl: "adjustable-card" };

// Structure-driven (adjustable) formats describe themselves through their top-level CSS
// class, so the aggregationDisplayType field is vestigial — the UI sends IRRELEVANT.
const ADJUSTABLE_DISPLAY_TYPE = "IRRELEVANT";

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

// ── Notification types ────────────────────────────────────────
// Type 1/2 are DAILY, Type 3/4 are WEEKLY. Type 3 mirrors Type 1 and Type 4 mirrors
// Type 2, so every recipient receives BOTH a daily digest and a weekly digest (each
// timing is buffered and flushed independently by the scheduler).
//   • standardLanguages    — languages with a STANDARD (per-order) template (CKEditor)
//   • ownAggregateLanguages — languages with the type's OWN AGGREGATE wrapper; when a
//     digest bundles a single type that has one, it overrides the global wrapper. The
//     own wrappers here use frontend-authored CKEditor adjustable formats.
//   • ownAggregateFormat   — the adjustable format used by the own aggregate wrapper
const TYPE_DEFS = {
  type1: {
    key: "type1",
    label: "Type1 Stock Valuation (daily)",
    timing: "DAILY",
    senderName: "Pigeon CKEditor Aggregation — Type 1 (daily)",
    standardLanguages: ["en", "de", "pl"],
    ownAggregateLanguages: ["en"],
    ownAggregateFormat: "adjustable-card",
    templates: [
      { name: "Type1 Standard EN", language: "en", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Type1 Stock Valuation (daily) · EN · {{orderLabel}}", file: "standard-type1-en.html" },
      { name: "Type1 Standard DE", language: "de", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Typ1 Stock Valuation (daily) · DE · {{orderLabel}}", file: "standard-type1-de.html" },
      { name: "Type1 Standard PL", language: "pl", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Typ1 Stock Valuation (daily) · PL · {{orderLabel}}", file: "standard-type1-pl.html" },
      { name: "Type1 Aggregate EN", language: "en", type: "AGGREGATE", syntax: "CKEDITOR", aggregationDisplayType: ADJUSTABLE_DISPLAY_TYPE, subject: "DAILY DIGEST · Type1 OWN aggregate (adjustable-card) · EN", file: "aggregate-type1-en.html" },
    ],
  },
  type2: {
    key: "type2",
    label: "Type2 Financial Health (daily)",
    timing: "DAILY",
    senderName: "Pigeon CKEditor Aggregation — Type 2 (daily)",
    standardLanguages: ["en"],
    ownAggregateLanguages: [],
    templates: [
      { name: "Type2 Standard EN", language: "en", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Type2 Financial Health (daily) · EN · {{orderLabel}}", file: "standard-type2-en.html" },
    ],
  },
  type3: {
    key: "type3",
    label: "Type3 Stock Valuation (weekly)",
    timing: "WEEKLY",
    senderName: "Pigeon CKEditor Aggregation — Type 3 (weekly)",
    standardLanguages: ["en", "de", "pl"],
    ownAggregateLanguages: ["en"],
    ownAggregateFormat: "adjustable-table",
    templates: [
      { name: "Type3 Standard EN", language: "en", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Type3 Stock Valuation (weekly) · EN · {{orderLabel}}", file: "standard-type3-en.html" },
      { name: "Type3 Standard DE", language: "de", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Typ3 Stock Valuation (weekly) · DE · {{orderLabel}}", file: "standard-type3-de.html" },
      { name: "Type3 Standard PL", language: "pl", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Typ3 Stock Valuation (weekly) · PL · {{orderLabel}}", file: "standard-type3-pl.html" },
      { name: "Type3 Aggregate EN", language: "en", type: "AGGREGATE", syntax: "CKEDITOR", aggregationDisplayType: ADJUSTABLE_DISPLAY_TYPE, subject: "WEEKLY DIGEST · Type3 OWN aggregate (adjustable-table) · EN", file: "aggregate-type3-en.html" },
    ],
  },
  type4: {
    key: "type4",
    label: "Type4 Financial Health (weekly)",
    timing: "WEEKLY",
    senderName: "Pigeon CKEditor Aggregation — Type 4 (weekly)",
    standardLanguages: ["en"],
    ownAggregateLanguages: [],
    templates: [
      { name: "Type4 Standard EN", language: "en", type: "STANDARD", syntax: "CKEDITOR", subject: "STD · Type4 Financial Health (weekly) · EN · {{orderLabel}}", file: "standard-type4-en.html" },
    ],
  },
};

// ── Recipients ────────────────────────────────────────────────
// Each recipient has a different preferred-language order and a schedule that fires
// N minutes from now, so the digests arrive one minute apart. Daily and weekly fire
// at the same instant per recipient but as two separate emails.
const RECIPIENTS = [
  {
    key: "EN",
    name: "Emma English (EN recipient)",
    email: "emma.english.ckeditor-agg@example.com",
    externalIdValue: "pigeon-api-tests-ckeditor-agg-en",
    languages: ["en"],
    offsetMinutes: 1,
  },
  {
    key: "DE",
    name: "Dieter Deutsch (DE recipient)",
    email: "dieter.deutsch.ckeditor-agg@example.com",
    externalIdValue: "pigeon-api-tests-ckeditor-agg-de",
    languages: ["de", "en"],
    offsetMinutes: 2,
  },
  {
    key: "PL",
    name: "Paulina Polski (PL recipient)",
    email: "paulina.polski.ckeditor-agg@example.com",
    externalIdValue: "pigeon-api-tests-ckeditor-agg-pl",
    languages: ["pl", "en"],
    offsetMinutes: 3,
  },
];

const EXTERNAL_ID_SOURCE = "BMP";

// The six daily orders (NT1/NT2) and their weekly mirror (NT3/NT4).
const ALL_ORDERS = [
  { index: 1, type: "type1", recipientKeys: ["EN", "DE", "PL"] },
  { index: 2, type: "type1", recipientKeys: ["PL"] },
  { index: 3, type: "type2", recipientKeys: ["PL"] },
  { index: 4, type: "type1", recipientKeys: ["DE"] },
  { index: 5, type: "type2", recipientKeys: ["PL", "DE"] },
  { index: 6, type: "type1", recipientKeys: ["EN"] },
  { index: 7, type: "type3", recipientKeys: ["EN", "DE", "PL"] },
  { index: 8, type: "type3", recipientKeys: ["PL"] },
  { index: 9, type: "type4", recipientKeys: ["PL"] },
  { index: 10, type: "type3", recipientKeys: ["DE"] },
  { index: 11, type: "type4", recipientKeys: ["PL", "DE"] },
  { index: 12, type: "type3", recipientKeys: ["EN"] },
];

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  // Multi-type digests need a wrapper template: the EN/DE wrappers are global templates
  // (/public/api, requires a JWT with "roleNotificationContentManager"), the PL wrapper
  // lives on the default aggregated notification definition (/private, no token). Without a
  // token we run only the EN recipient (single notification type → the type's OWN
  // AGGREGATE template, no wrapper lookup needed) and skip DE/PL.
  const fullScenario = Boolean(GLOBAL_TOKEN);
  const activeRecipients = fullScenario ? RECIPIENTS : RECIPIENTS.filter((recipient) => recipient.key === "EN");

  if (fullScenario) {
    console.log("Mode: FULL — PIGEON_BEARER_TOKEN present, exercising EN, DE and PL digests (daily + weekly).\n");
  } else {
    console.log(
      "Mode: REDUCED — PIGEON_BEARER_TOKEN not set.\n" +
        "  • Running only the EN recipient (single-type digests via /private, no token needed).\n" +
        "  • Skipping global templates and the DE/PL multi-type digests, which require a\n" +
        "    /public/api/global-templates token (JWT with roleNotificationContentManager).\n" +
        "  • Set PIGEON_BEARER_TOKEN to run the full scenario.\n"
    );
  }

  const created = {
    recipientIds: {},
    typeIds: {},
    globalTemplateIds: [],
    antTemplateIds: [],
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

    // ── 2. Create the four notification types with their templates ──
    // STANDARD parts and OWN AGGREGATE wrappers are all CKEditor. The own aggregate
    // wrappers use frontend-authored adjustable formats (Type1 → card, Type3 → table).
    for (const def of Object.values(TYPE_DEFS)) {
      step(`Create ${def.label} (EMAIL, ${def.timing})`);
      const type = await pigeon.createLegacy({
        name: `${def.label} ${Date.now()}`,
        channel: "EMAIL",
        senderName: def.senderName,
        defaultTiming: def.timing,
      });
      created.typeIds[def.key] = type.id;
      ok(`${def.label}: ${type.id}`);

      let version = type.version;
      for (const template of def.templates) {
        version = await addLegacyTemplate(type.id, version, {
          name: template.name,
          language: template.language,
          type: template.type,
          syntax: template.syntax,
          aggregationDisplayType: template.aggregationDisplayType,
          subject: template.subject,
          contentPath: resolve(TEMPLATES_DIR, template.file),
        });
      }
      const summary = def.templates.map((t) => `${t.type}/${t.language}/${t.syntax}`).join(", ");
      ok(`${def.label} templates added: ${summary}`);
    }

    // ── 3. Multi-type digest wrappers: GLOBAL [en, de] + DEFAULT ANT [pl] ──
    // Every wrapper is a frontend-authored CKEditor adjustable format: EN global is a
    // table, DE global is a card, PL (default ANT) is a card. None declare a loop —
    // the service injects it at the format's row/card selector.
    if (fullScenario) {
      step("Create GLOBAL aggregate templates [en→table, de→card] (CKEDITOR adjustable, shared by daily and weekly multi-type digests)");
      for (const language of GLOBAL_WRAPPER_LANGUAGES) {
        const format = GLOBAL_WRAPPER_FORMAT[language];
        const globalTemplate = await pigeon.addGlobalTemplate({
          name: `ckeditor-agg-global-${language}-${Date.now()}`,
          language,
          syntax: "CKEDITOR",
          subject: `DIGEST · GLOBAL ${format} · ${language.toUpperCase()}`,
          aggregationDisplayType: ADJUSTABLE_DISPLAY_TYPE,
          contentPath: resolve(TEMPLATES_DIR, `global-aggregate-${language}.html`),
          accessToken: GLOBAL_TOKEN,
        });
        created.globalTemplateIds.push(globalTemplate.id);
        ok(`Global aggregate ${language.toUpperCase()} (${format}): ${globalTemplate.id}`);
      }

      step("Create PL wrapper on the DEFAULT aggregated notification definition (CKEDITOR adjustable-card, no loop)");
      const antPl = await pigeon.addAggregatedTemplate(DEFAULT_AGGREGATED_NOTIFICATION_DEFINITION_ID, {
        name: `ckeditor-agg-default-ant-pl-${Date.now()}`,
        language: "pl",
        syntax: "CKEDITOR",
        subject: "DIGEST · DEFAULT aggregated notification definition · adjustable-card · PL",
        contentPath: resolve(TEMPLATES_DIR, "default-ant-aggregate-pl.html"),
      });
      created.antTemplateIds.push(antPl.templateId);
      ok(`Default ANT aggregate PL (adjustable-card): ${antPl.templateId}`);
    } else {
      step("Skip multi-type wrappers (no token — DE/PL multi-type digests are not run)");
    }

    // ── 4. Set recipient schedules: fire ~1/2/3 min from now, with today as the
    //        last (and only) scheduled day so the WEEKLY digest also fires today ──
    step("Set recipient schedules (fire ~1 / 2 / 3 minutes from now, today as the weekly send day, UTC)");
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
      // daysOfWeek is derived from the actual fire day so the weekly send day is
      // "today", and nextOrSame(today) + the unelapsed send hour fire it now.
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

    // ── 5. Keep only recipients we actually created; drop empty orders ──
    const activeKeys = new Set(activeRecipients.map((recipient) => recipient.key));
    const orders = ALL_ORDERS.map((order) => ({
      ...order,
      recipientKeys: order.recipientKeys.filter((key) => activeKeys.has(key)),
    })).filter((order) => order.recipientKeys.length > 0);

    printExpectations(orders, activeRecipients);

    // ── 6. Post the orders (timing DEFAULT → uses each type's DAILY/WEEKLY timing) ──
    const orderIds = [];
    for (const order of orders) {
      const def = TYPE_DEFS[order.type];
      const orderLabel = `Order ${order.index} · ${def.label} · → ${order.recipientKeys.join("+")}`;
      step(`Post ${orderLabel}`);
      const recipients = order.recipientKeys.map((key) => recipientInput(key));
      const result = await pigeon.createNotificationOrder({
        notificationTypeId: created.typeIds[order.type],
        recipients,
        tags: [TAG],
        sender: SENDER_EMAIL,
        timing: "DEFAULT",
        variables: {
          orderLabel,
          note: `Generated by aggregated-digest-ckeditor test for recipient(s) ${order.recipientKeys.join(", ")}.`,
        },
      });
      orderIds.push({ index: order.index, id: result.id, label: orderLabel });
      ok(`Accepted: ${result.id} (status: ${result.status ?? "n/a"})`);
    }

    // ── 7. Wait for the scheduler to flush every order ────────────
    step("Wait for the scheduler to flush all aggregated digests (daily + weekly)");
    console.log(
      "  Digests fire at the recipients' scheduled times (≈ +1 / +2 / +3 min). " +
        "Polling order statuses until all are PROCESSED…"
    );
    await waitForOrdersProcessed(orderIds);
  } finally {
    await cleanup(created);
  }

  if (!summary("aggregated digest scenario — ADJUSTABLE CKEditor wrappers (daily + weekly)")) {
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

// Mirrors the backend aggregation rules so the console states exactly what each
// recipient should receive per timing: which wrapper template (source + adjustable
// format), and how many standard parts in which language. Daily and weekly are
// independent digests.
function printExpectations(orders, recipients) {
  console.log(`\n${"#".repeat(115)}`);
  console.log("# EXPECTED EMAILS PER RECIPIENT (verify these against the received inboxes)");
  console.log("# Each recipient receives TWO digests: one DAILY (Type1/Type2) and one WEEKLY (Type3/Type4).");
  console.log("# All wrappers are frontend-authored CKEditor adjustable formats (table or card).");
  console.log(`${"#".repeat(115)}`);

  for (const recipient of recipients) {
    console.log(`\n  ┌─ Recipient ${recipient.key} — "${recipient.name}"`);
    console.log(`  • preferred languages: [${recipient.languages.join(", ")}]`);
    console.log(
      `  • schedule: ${recipient.fireAtUtc ?? "n/a"} on ${recipient.sendDay ?? "n/a"}` +
        (recipient.firesInSeconds != null ? ` (~${recipient.firesInSeconds}s from now)` : "")
    );

    for (const timing of ["DAILY", "WEEKLY"]) {
      const suborders = orders.filter(
        (order) => order.recipientKeys.includes(recipient.key) && TYPE_DEFS[order.type].timing === timing
      );
      if (suborders.length === 0) continue;
      const { wrapper, parts } = describeDigest(suborders, recipient);
      console.log(`\n  ▼ ${timing} email — ${suborders.length === 1 ? "1 standard email" : "1 aggregated digest email"}`);
      console.log(`     • wrapper template: ${wrapper}`);
      console.log(`     • standard parts (${parts.length}):`);
      for (const part of parts) console.log(`         - ${part}`);
    }
  }
  console.log("");
}

function describeDigest(suborders, recipient) {
  const distinctTypes = [...new Set(suborders.map((order) => order.type))];

  let wrapper;
  if (suborders.length === 1) {
    wrapper = "NONE — a single pending part means a plain standard email, not a digest";
  } else if (distinctTypes.length === 1 && TYPE_DEFS[distinctTypes[0]].ownAggregateLanguages.length > 0) {
    const def = TYPE_DEFS[distinctTypes[0]];
    const lang = pickLanguage(recipient.languages, def.ownAggregateLanguages);
    wrapper = `${def.label} OWN aggregate template · CKEditor ${def.ownAggregateFormat} (language: ${lang})`;
  } else {
    const lang = pickLanguage(recipient.languages, ["en", "de", "pl"]);
    const fromAnt = DEFAULT_ANT_WRAPPER_LANGUAGES.includes(lang);
    const format = fromAnt ? DEFAULT_ANT_WRAPPER_FORMAT[lang] : GLOBAL_WRAPPER_FORMAT[lang];
    const source = fromAnt
      ? "DEFAULT aggregated notification definition"
      : "GLOBAL aggregate template";
    wrapper = `${source} · CKEditor ${format} (language: ${lang})`;
  }

  const parts = suborders.map((order) => {
    const def = TYPE_DEFS[order.type];
    const lang = pickLanguage(recipient.languages, def.standardLanguages);
    return `Order ${order.index} → ${def.label} standard part (CKEditor) in ${lang.toUpperCase()}`;
  });

  return { wrapper, parts };
}

// First preferred language that has a template available, else first available
// (matches the backend's TemplateFinder fallback).
function pickLanguage(preferredLanguages, availableLanguages) {
  const match = preferredLanguages.find((language) => availableLanguages.includes(language));
  return match ?? availableLanguages[0];
}

async function addLegacyTemplate(typeId, version, template) {
  await pigeon.addLegacyTemplate(typeId, { ...template, version });
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
  for (const id of created.antTemplateIds) {
    await safe(`Remove default ANT template ${id}`, () =>
      pigeon.removeAggregatedTemplate(DEFAULT_AGGREGATED_NOTIFICATION_DEFINITION_ID, id)
    );
  }
  for (const typeId of Object.values(created.typeIds)) {
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
