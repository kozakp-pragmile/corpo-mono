import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";

const pigeon = createClient(BASE_URL);

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  // ── 1. Create aggregated notification type ─────────────────
  step("1. Create aggregated notification type");
  const aggregated = await pigeon.createAggregated({
    name: `Daily Quotation Digest ${Date.now()}`,
    description: "Daily quotation digest",
    senderName: "Pigeon Digest",
  });
  const aggId = aggregated.id;
  ok(`Created: ${aggId}`);

  // ── 2. Add aggregated THYMELEAF template (en) ──────────────
  step("2. Add aggregated THYMELEAF template (en)");
  const aggEn = await pigeon.addAggregatedTemplate(aggId, {
    name: "Aggregated Quotation EN",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Your daily quotation digest",
    contentPath: resolve(TEMPLATES_DIR, "thymeleaf", "daily-quotation-aggregated-en.html"),
  });
  ok(`Template added: ${aggEn.templateId}`);

  // ── 3. Add aggregated CKEDITOR template (de) ───────────────
  step("3. Add aggregated CKEDITOR template (de)");
  const aggDe = await pigeon.addAggregatedTemplate(aggId, {
    name: "Aggregated Quotation DE",
    language: "de",
    syntax: "CKEDITOR",
    subject: "Ihre tägliche Notierungsübersicht",
    contentPath: resolve(TEMPLATES_DIR, "ckeditor", "daily-quotation-aggregated-de.html"),
  });
  ok(`Template added: ${aggDe.templateId}`);

  // ── 4. Create standard notification linked to aggregated ───
  step("4. Create standard notification type linked to aggregated");
  const linkedStandard = await pigeon.createStandard({
    name: `Daily Quotation linked ${Date.now()}`,
    description: "Linked stock quotation",
    channel: "EMAIL",
    senderName: "Pigeon Tests",
    aggregatedNotificationTypeId: aggId,
    defaultNotificationTiming: "DAILY",
  });
  const sntId = linkedStandard.id;
  ok(`Linked standard: ${sntId}`);

  // ── 5. Add a template to the linked standard ───────────────
  step("5. Add a template to the linked standard");
  const linkedTemplate = await pigeon.addStandardTemplate(sntId, {
    name: "Linked Daily Quotation EN",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Linked: your daily quotation",
    contentPath: resolve(TEMPLATES_DIR, "thymeleaf", "daily-quotation-standard-en.html"),
  });
  ok(`Linked template: ${linkedTemplate.templateId}`);

  console.log(`\nSeeded aggregated notification type ${aggId} with linked standard ${sntId} (left in database).\n`);

  if (!summary("aggregated notification type seed")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
