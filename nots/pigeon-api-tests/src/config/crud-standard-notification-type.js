import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
const TEST_EMAIL = process.env.PIGEON_TEST_EMAIL;

const pigeon = createClient(BASE_URL);

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  // ── 1. Create standard notification definition ───────────────────
  step("1. Create standard notification definition (EMAIL, DAILY)");
  const created = await pigeon.createStandard({
    name: `Daily Stock Quotation ${Date.now()}`,
    description: "Daily stock prices",
    channel: "EMAIL",
    senderName: "Pigeon Tests",
    defaultNotificationTiming: "DAILY",
  });
  const sntId = created.id;
  ok(`Created: ${sntId}`);

  // ── 2. Find by id ──────────────────────────────────────────
  step("2. Find standard notification definition by id");
  await pigeon.findStandard(sntId);

  // ── 3. Patch name, description, senderName and defaultNotificationTiming ─
  step("3. Patch name, description, senderName and defaultNotificationTiming → WEEKLY");
  await pigeon.patchStandard(sntId, {
    name: `Daily Stock Quotation (renamed) ${Date.now()}`,
    description: "Weekly stock prices",
    senderName: "Pigeon Tests v2",
    defaultNotificationTiming: "WEEKLY",
  });
  ok("Patched");

  // ── 4. Add THYMELEAF template (en) ─────────────────────────
  step("4. Add THYMELEAF template (en)");
  const enTemplate = await pigeon.addStandardTemplate(sntId, {
    name: "Daily Quotation EN",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Your daily stock quotation",
    contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "thymeleaf", "standard-en.html"),
  });
  const enTemplateId = enTemplate.templateId;
  ok(`Template added: ${enTemplateId}`);

  // ── 5. Add CKEDITOR template (no) ──────────────────────────
  step("5. Add CKEDITOR template (no)");
  const noTemplate = await pigeon.addStandardTemplate(sntId, {
    name: "Daily Quotation NO",
    language: "no",
    syntax: "CKEDITOR",
    subject: "Din daglige aksjenotering",
    contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "ckeditor", "standard-no.html"),
  });
  const noTemplateId = noTemplate.templateId;
  ok(`Template added: ${noTemplateId}`);

  // ── 6. Find template ───────────────────────────────────────
  step("6. Find template (en)");
  await pigeon.findStandardTemplate(sntId, enTemplateId);

  // ── 7. Download template content ───────────────────────────
  step("7. Download template content (en)");
  await pigeon.downloadStandardTemplateContent(sntId, enTemplateId);

  // ── 8. Update template (en) ────────────────────────────────
  step("8. Update template (en) — new content + subject (for changelog)");
  await pigeon.updateStandardTemplate(sntId, enTemplateId, {
    name: "Daily Quotation EN v2",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Your daily stock quotation (updated)",
    contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "thymeleaf", "standard-en-v2.html"),
  });
  ok("Template updated");

  // ── 8b. Download template content again (verify changelog) ─
  step("8b. Download template content (en) — after update");
  await pigeon.downloadStandardTemplateContent(sntId, enTemplateId);

  // ── 9. Query without filters ───────────────────────────────
  step("9. Query standard notification definitions (no filters)");
  await pigeon.queryStandards({ size: 5, sortBy: "createdAt", direction: "DESC" });

  // ── 10. Query filtered by channel + search ─────────────────
  step("10. Query filtered by channel=EMAIL + search");
  await pigeon.queryStandards({ channel: "EMAIL", search: "Daily" });

  // ── 11. Send test (optional) ───────────────────────────────
  if (TEST_EMAIL) {
    step(`11. Send test email to ${TEST_EMAIL}`);
    try {
      await pigeon.sendStandardTemplateTest(sntId, enTemplateId, {
        channel: "EMAIL",
        email: TEST_EMAIL,
        variables: {
          name: "Alice",
          paperSymbol: "ACME",
          paperName: "ACME Corp",
          quotationDate: "2026-05-25",
          openPrice: 100.5,
          closePrice: 102.75,
          highPrice: 103.1,
          lowPrice: 99.8,
          volume: 1234567,
          changePercent: 2.24,
        },
      });
      ok("Test email sent");
    } catch (e) {
      fail(`Send failed: ${e.message} (channel may not be configured)`);
    }
  } else {
    step("11. Send test (SKIPPED — set PIGEON_TEST_EMAIL to enable)");
  }

  // ── 12. Remove templates ───────────────────────────────────
  step("12. Remove template (no)");
  await pigeon.removeStandardTemplate(sntId, noTemplateId);
  ok("Template removed");

  step("13. Remove template (en)");
  await pigeon.removeStandardTemplate(sntId, enTemplateId);
  ok("Template removed");

  // ── 14. Delete standard notification definition ──────────────────
  step("14. Delete standard notification definition");
  await pigeon.deleteStandard(sntId);
  ok("Deleted");

  if (!summary("standard notification definition lifecycle")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
