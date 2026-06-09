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

  // ── 1. Create standard notification type ───────────────────
  step("1. Create standard notification type (EMAIL, DAILY)");
  const created = await pigeon.createStandard({
    name: `Daily Stock Quotation ${Date.now()}`,
    description: "Daily stock prices",
    channel: "EMAIL",
    senderName: "Pigeon Tests",
    defaultNotificationTiming: "DAILY",
  });
  const sntId = created.id;
  ok(`Created: ${sntId}`);

  // ── 2. Add THYMELEAF template (en) ─────────────────────────
  step("2. Add THYMELEAF template (en)");
  const enTemplate = await pigeon.addStandardTemplate(sntId, {
    name: "Daily Quotation EN",
    language: "en",
    syntax: "THYMELEAF",
    subject: "Your daily stock quotation",
    contentPath: resolve(TEMPLATES_DIR, "thymeleaf", "daily-quotation-standard-en.html"),
  });
  ok(`Template added: ${enTemplate.templateId}`);

  // ── 3. Add CKEDITOR template (no) ──────────────────────────
  step("3. Add CKEDITOR template (no)");
  const noTemplate = await pigeon.addStandardTemplate(sntId, {
    name: "Daily Quotation NO",
    language: "no",
    syntax: "CKEDITOR",
    subject: "Din daglige aksjenotering",
    contentPath: resolve(TEMPLATES_DIR, "ckeditor", "daily-quotation-standard-no.html"),
  });
  ok(`Template added: ${noTemplate.templateId}`);

  console.log(`\nSeeded standard notification type ${sntId} (left in database).\n`);

  if (!summary("standard notification type seed")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
