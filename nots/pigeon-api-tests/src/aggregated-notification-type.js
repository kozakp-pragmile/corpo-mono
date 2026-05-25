import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "./pigeon-client.js";
import { step, ok, fail } from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "templates");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";

const pigeon = createClient(BASE_URL);

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  // ── 1. Create aggregated notification type ─────────────────
  step("1. Create aggregated notification type");
  const aggregated = await pigeon.createAggregated({
    name: `Daily Quotation Digest ${Date.now()}`,
    senderName: "Pigeon Digest",
  });
  const aggId = aggregated.id;
  ok(`Created: ${aggId}`);

  // ── 2. Find by id ──────────────────────────────────────────
  step("2. Find aggregated notification type by id");
  await pigeon.findAggregated(aggId);

  // ── 3. Patch ───────────────────────────────────────────────
  step("3. Patch aggregated — rename and update senderName");
  await pigeon.patchAggregated(aggId, {
    name: `Daily Quotation Digest (renamed) ${Date.now()}`,
    senderName: "Pigeon Digest v2",
  });
  ok("Patched");

  // ── 4. Add aggregated THYMELEAF template (en) ──────────────
  step("4. Add aggregated THYMELEAF template (en)");
  const aggEn = await pigeon.addAggregatedTemplate(aggId, {
    name: "Aggregated Quotation EN",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Your daily quotation digest",
    contentPath: resolve(TEMPLATES_DIR, "thymeleaf", "daily-quotation-aggregated-en.html"),
  });
  const aggEnTemplateId = aggEn.templateId;
  ok(`Template added: ${aggEnTemplateId}`);

  // ── 5. Add aggregated CKEDITOR template (de) ───────────────
  step("5. Add aggregated CKEDITOR template (de)");
  const aggDe = await pigeon.addAggregatedTemplate(aggId, {
    name: "Aggregated Quotation DE",
    language: "de",
    syntax: "CKEDITOR",
    subject: "Ihre tägliche Notierungsübersicht",
    contentPath: resolve(TEMPLATES_DIR, "ckeditor", "daily-quotation-aggregated-de.html"),
  });
  const aggDeTemplateId = aggDe.templateId;
  ok(`Template added: ${aggDeTemplateId}`);

  // ── 6. Find aggregated template ────────────────────────────
  step("6. Find aggregated template (en)");
  await pigeon.findAggregatedTemplate(aggId, aggEnTemplateId);

  // ── 7. Download aggregated template content ────────────────
  step("7. Download aggregated template content (en)");
  await pigeon.downloadAggregatedTemplateContent(aggId, aggEnTemplateId);

  // ── 8. Update aggregated template (en) ─────────────────────
  step("8. Update aggregated template (en) — new subject");
  await pigeon.updateAggregatedTemplate(aggId, aggEnTemplateId, {
    name: "Aggregated Quotation EN v2",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Your daily quotation digest (updated)",
    contentPath: resolve(TEMPLATES_DIR, "thymeleaf", "daily-quotation-aggregated-en.html"),
  });
  ok("Template updated");

  // ── 9. Create standard notification linked to aggregated ───
  step("9. Create standard notification type linked to aggregated");
  const linkedStandard = await pigeon.createStandard({
    name: `Daily Quotation linked ${Date.now()}`,
    channel: "EMAIL",
    senderName: "Pigeon Tests",
    aggregatedNotificationTypeId: aggId,
  });
  const sntId = linkedStandard.id;
  ok(`Linked standard: ${sntId}`);

  // ── 10. Add a template to the linked standard ──────────────
  step("10. Add a template to the linked standard");
  const linkedTemplate = await pigeon.addStandardTemplate(sntId, {
    name: "Linked Daily Quotation EN",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Linked: your daily quotation",
    contentPath: resolve(TEMPLATES_DIR, "thymeleaf", "daily-quotation-standard-en.html"),
  });
  const linkedTemplateId = linkedTemplate.templateId;
  ok(`Linked template: ${linkedTemplateId}`);

  // ── 11. Query standards filtered by aggregated id ──────────
  step("11. Query standard notification types filtered by aggregatedNotificationTypeId");
  await pigeon.queryStandards({ aggregatedNotificationTypeId: aggId });

  // ── 12. Query aggregated notification types ────────────────
  step("12. Query aggregated notification types");
  await pigeon.queryAggregated({ size: 5, sortBy: "createdAt", direction: "DESC" });

  // ── 13. Query aggregated with search filter ────────────────
  step("13. Query aggregated with search filter");
  await pigeon.queryAggregated({ search: "Digest" });

  // ── 14. Cleanup linked standard ────────────────────────────
  step("14. Remove linked standard template");
  await pigeon.removeStandardTemplate(sntId, linkedTemplateId);
  ok("Template removed");

  step("15. Delete linked standard notification type");
  await pigeon.deleteStandard(sntId);
  ok("Deleted");

  // ── 15. Cleanup aggregated templates ───────────────────────
  step("16. Remove aggregated template (de)");
  await pigeon.removeAggregatedTemplate(aggId, aggDeTemplateId);
  ok("Template removed");

  step("17. Remove aggregated template (en)");
  await pigeon.removeAggregatedTemplate(aggId, aggEnTemplateId);
  ok("Template removed");

  // ── 16. Delete aggregated notification type ────────────────
  step("18. Delete aggregated notification type");
  await pigeon.deleteAggregated(aggId);
  ok("Deleted");

  console.log(`\n${"═".repeat(115)}`);
  console.log("  Done — aggregated notification type lifecycle complete");
  console.log(`${"═".repeat(115)}\n`);
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
