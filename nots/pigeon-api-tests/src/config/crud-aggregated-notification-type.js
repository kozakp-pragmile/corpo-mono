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

  // ── 1. Create aggregated notification definition ─────────────────
  step("1. Create aggregated notification definition");
  const aggregated = await pigeon.createAggregated({
    name: `Daily Quotation Digest ${Date.now()}`,
    description: "Daily quotation digest",
    senderName: "Pigeon Digest",
  });
  const aggId = aggregated.id;
  ok(`Created: ${aggId}`);

  // ── 2. Find by id ──────────────────────────────────────────
  step("2. Find aggregated notification definition by id");
  await pigeon.findAggregated(aggId);

  // ── 3. Patch ───────────────────────────────────────────────
  step("3. Patch aggregated — rename and update description and senderName");
  await pigeon.patchAggregated(aggId, {
    name: `Daily Quotation Digest (renamed) ${Date.now()}`,
    description: "Weekly quotation digest",
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
    contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "thymeleaf", "aggregated-en.html"),
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
    contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "ckeditor", "aggregated-de.html"),
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
    contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "thymeleaf", "aggregated-en.html"),
  });
  ok("Template updated");

  // ── 9. Create standard notification linked to aggregated ───
  step("9. Create standard notification definition linked to aggregated");
  const linkedStandard = await pigeon.createStandard({
    name: `Daily Quotation linked ${Date.now()}`,
    description: "Linked stock quotation",
    channel: "EMAIL",
    senderName: "Pigeon Tests",
    aggregatedNotificationDefinitionId: aggId,
    defaultNotificationTiming: "DAILY",
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
    contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "thymeleaf", "standard-en.html"),
  });
  const linkedTemplateId = linkedTemplate.templateId;
  ok(`Linked template: ${linkedTemplateId}`);

  // ── 11. Query standards filtered by aggregated id ──────────
  step("11. Query standard notification definitions filtered by aggregatedNotificationDefinitionId");
  await pigeon.queryStandards({ aggregatedNotificationDefinitionId: aggId });

  // ── 12. Query aggregated notification definitions ────────────────
  step("12. Query aggregated notification definitions");
  await pigeon.queryAggregated({ size: 5, sortBy: "createdAt", direction: "DESC" });

  // ── 13. Query aggregated with search filter ────────────────
  step("13. Query aggregated with search filter");
  await pigeon.queryAggregated({ search: "Digest" });

  // ── 14. Attempt premature delete of aggregated while linked standard still exists ──
  step("14. Attempt to delete aggregated notification definition before removing linked standard (expected to fail)");
  try {
    await pigeon.deleteAggregated(aggId);
    fail("Aggregated was unexpectedly deleted while a linked standard still exists");
  } catch (e) {
    ok(`Rejected as expected — status ${e.status}, body: ${JSON.stringify(e.data)}`);
  }

  // ── 15. Cleanup linked standard ────────────────────────────
  step("15. Remove linked standard template");
  await pigeon.removeStandardTemplate(sntId, linkedTemplateId);
  ok("Template removed");

  step("16. Delete linked standard notification definition");
  await pigeon.deleteStandard(sntId);
  ok("Deleted");

  // ── Cleanup aggregated templates ───────────────────────────
  step("17. Remove aggregated template (de)");
  await pigeon.removeAggregatedTemplate(aggId, aggDeTemplateId);
  ok("Template removed");

  step("18. Remove aggregated template (en)");
  await pigeon.removeAggregatedTemplate(aggId, aggEnTemplateId);
  ok("Template removed");

  // ── Delete aggregated notification definition ────────────────────
  step("19. Delete aggregated notification definition");
  await pigeon.deleteAggregated(aggId);
  ok("Deleted");

  if (!summary("aggregated notification definition lifecycle")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
