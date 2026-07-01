import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates", "immediate");
const IMAGES_DIR = resolve(__dirname, "..", "..", "..", "images");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Global images require a bearer token (a JWT with roleNotificationContentManager).
// Falls back to the same baked-in dev token as immediate-notification.js so the runner
// works out of the box; override with PIGEON_BEARER_TOKEN.
const DEFAULT_BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiIxMjM0IiwiYXVkIjoiMTIzNCIsInN1YiI6ImFkbWluIiwiZm4iOiJQaWdlb24iLCJsbiI6IkFkbWluIiwicm9sZXMiOlsicm9sZU5vdGlmaWNhdGlvbkNvbnRlbnRNYW5hZ2VyIl0sImdyIjpbIkV2ZXJ5b25lIl0sImlhdCI6MTc4MDM5MTA2NX0.fjr0784ceEDypPfXSbXZ8R_iKaPsnqCLGFn8WSDdkHhRYZVoYiCUDL-K4QCnTgj5-rWfInpfZ1WdK8Imgewz7T11naXOeTiVdifc7tV3qlCeSnT6klRyXpedc8xvs4pcPPXng5Fq_JQKzipQm2_7Qz7VicDDwZT21SoVGpkm3sSy0dC0iZtzNl_URV1zTOlcmlhkTM8N_X7wXKfy_YwmlEXc-nSbLxcYim7JFkKrkR1256YWfYqyCn3fJvZ41CieNohFTTJxAOgdKC1Q1js6iHXV6A_01E3Hs3w597iixiq8BgA240KaP_xdwKANHW1HNQZXF4PhXoAJSpCa-OEX5Q";
const GLOBAL_TOKEN = process.env.PIGEON_BEARER_TOKEN || DEFAULT_BEARER_TOKEN;

const WITH_NAME_TEMPLATE = resolve(TEMPLATES_DIR, "with-name-en.html");
const OWL_IMAGE_NAME = "owl";
const OWL_IMAGE_PATH = resolve(IMAGES_DIR, "jpg", "owl.jpg");

const SUBJECT = process.env.PIGEON_SUBJECT || "Welcome, {{name}}!";
const MESSAGE_BODY =
  process.env.PIGEON_BODY || "This is a real immediate notification sent by real-immediate-notification.js.";

const TAG = "pigeon-api-tests-real-immediate";
const ORDER_POLL_TIMEOUT_MS = 30_000;
const ORDER_POLL_INTERVAL_MS = 500;

const USAGE = `
Send a REAL immediate email notification to the recipients you pass in.

Usage:
  node src/send/real-immediate-notification.js <email>[:Full Name] [<email>[:Full Name] ...] [--kind STANDARD|LEGACY] [--keep]
  PIGEON_TO="a@x.com,b@y.com:Bob Brown" node src/send/real-immediate-notification.js

Recipients (at least one required) come from positional args and/or the PIGEON_TO env
var (comma-separated). Append ":Full Name" to an address to set the display name;
otherwise the name is derived from the address local part.

Options:
  --kind STANDARD|LEGACY   Notification-type flavour to create (default: STANDARD)
  --keep                   Skip cleanup — leave the notification type and template behind

Env:
  PIGEON_URL             Pigeon base URL (default: ${BASE_URL})
  PIGEON_BEARER_TOKEN    JWT with roleNotificationContentManager (for the global image)
  PIGEON_SUBJECT         Override the subject (default: "${SUBJECT}")
  PIGEON_BODY            Override the {{messageBody}} variable
`;

function titleCase(part) {
  return part
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toRecipient(raw) {
  const [email, ...nameParts] = raw.split(":");
  const trimmedEmail = email.trim();
  const explicitName = nameParts.join(":").trim();
  const fullName = explicitName || titleCase(trimmedEmail.split("@")[0]);
  return {
    externalIdSource: "BMP",
    externalIdValue: `real-immediate-${trimmedEmail.replace(/[^a-zA-Z0-9]+/g, "-")}`,
    email: trimmedEmail,
    fullName,
  };
}

function parseArgs(argv) {
  const options = { kind: "STANDARD", keep: false };
  const rawRecipients = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--kind") {
      options.kind = (argv[++i] || "").toUpperCase();
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      rawRecipients.push(arg);
    }
  }

  const fromEnv = (process.env.PIGEON_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  options.recipients = [...rawRecipients, ...fromEnv].map(toRecipient);
  return options;
}

const pigeon = createClient(BASE_URL);

async function run() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!["STANDARD", "LEGACY"].includes(options.kind)) {
    fail(`Unknown --kind "${options.kind}" (expected STANDARD or LEGACY)`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  if (options.recipients.length === 0) {
    fail("No recipients — pass at least one email address (arg) or set PIGEON_TO");
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const invalid = options.recipients.filter((r) => !r.email.includes("@"));
  if (invalid.length > 0) {
    fail(`Not valid email address(es): ${invalid.map((r) => r.email).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nPigeon API: ${BASE_URL}`);
  console.log(`Sending real ${options.kind} immediate email to:`);
  for (const r of options.recipients) console.log(`  • ${r.fullName} <${r.email}>`);

  step(`Resolve ${OWL_IMAGE_NAME} global image (shared, resolved by name at render time)`);
  await resolveOwlImage();

  const suffix = `real-${options.kind.toLowerCase()}-${Date.now()}`;
  const createdNt = await createImmediateNt(options.kind, `Real immediate ${suffix}`);
  const ntId = createdNt.id;
  ok(`Notification type created: ${ntId}`);

  const template = await addTemplate(options.kind, ntId, createdNt.version, {
    name: `with-name-${suffix}`,
    language: "en",
    syntax: "CKEDITOR",
    subject: SUBJECT,
    contentPath: WITH_NAME_TEMPLATE,
  });
  const templateId = templateIdOf(options.kind, template);
  ok(`Template added: ${templateId}`);

  await sendOrder({
    notificationTypeId: ntId,
    recipients: options.recipients,
    variables: { messageBody: MESSAGE_BODY },
  });

  if (options.keep) {
    ok(`Keeping notification type ${ntId} (--keep)`);
  } else {
    step("Cleanup");
    const refreshed = await refreshNt(options.kind, ntId);
    await removeTemplate(options.kind, ntId, refreshed.version, templateId);
    ok("Template removed");
    const afterTemplateRemoval = await refreshNt(options.kind, ntId);
    await deleteNt(options.kind, ntId, afterTemplateRemoval.version);
    ok("Notification type deleted");
  }

  if (!summary("real immediate notification")) {
    process.exitCode = 1;
  }
}

// A single shared global image named exactly "owl" is enough; it is left in place across
// runs (get-or-create) since it is a shared resource referenced by name at render time.
async function resolveOwlImage() {
  try {
    const image = await pigeon.addGlobalImage({
      name: OWL_IMAGE_NAME,
      imagePath: OWL_IMAGE_PATH,
      accessToken: GLOBAL_TOKEN,
    });
    ok(`Global image "${OWL_IMAGE_NAME}" created: ${image.id}`);
    return image.id;
  } catch (e) {
    const existing = await pigeon.queryGlobalImages({ name: OWL_IMAGE_NAME, accessToken: GLOBAL_TOKEN });
    const match = existing?.content?.find((i) => i.name === OWL_IMAGE_NAME) ?? existing?.content?.[0];
    if (!match) {
      throw new Error(
        `Global image "${OWL_IMAGE_NAME}" could not be created (status ${e.status ?? "?"}) and none exists to reuse.`
      );
    }
    ok(`Reusing existing global image "${OWL_IMAGE_NAME}": ${match.id}`);
    return match.id;
  }
}

async function createImmediateNt(kind, name) {
  step(`Create ${kind} immediate notification type (EMAIL)`);
  if (kind === "STANDARD") {
    return pigeon.createStandard({
      name,
      channel: "EMAIL",
      senderName: "Pigeon Immediate Tests",
      defaultNotificationTiming: "IMMEDIATE",
    });
  }
  return pigeon.createLegacy({
    name,
    channel: "EMAIL",
    senderName: "Pigeon Immediate Tests",
    defaultTiming: "IMMEDIATE",
  });
}

async function addTemplate(kind, ntId, ntVersion, template) {
  step(`Add ${kind} template — ${template.name}`);
  if (kind === "STANDARD") {
    return pigeon.addStandardTemplate(ntId, template);
  }
  return pigeon.addLegacyTemplate(ntId, { ...template, version: ntVersion });
}

async function removeTemplate(kind, ntId, ntVersion, templateId) {
  if (kind === "STANDARD") {
    return pigeon.removeStandardTemplate(ntId, templateId);
  }
  return pigeon.removeLegacyTemplate(ntId, templateId, ntVersion);
}

async function deleteNt(kind, ntId, ntVersion) {
  if (kind === "STANDARD") {
    return pigeon.deleteStandard(ntId);
  }
  return pigeon.deleteLegacy(ntId, ntVersion);
}

async function refreshNt(kind, ntId) {
  if (kind === "STANDARD") {
    return pigeon.findStandard(ntId);
  }
  return pigeon.findLegacy(ntId);
}

function templateIdOf(kind, template) {
  return kind === "STANDARD" ? template.templateId : template.id;
}

async function sendOrder({ notificationTypeId, recipients, variables }) {
  step(`Order — ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`);
  const order = await pigeon.createNotificationOrder({
    notificationTypeId,
    recipients,
    tags: [TAG],
    variables,
    timing: "IMMEDIATE",
  });
  ok(`Order accepted: ${order.id} (initial status: ${order.status ?? "n/a"})`);
  await waitForOrderProcessed(order.id);
}

async function waitForOrderProcessed(orderId) {
  const deadline = Date.now() + ORDER_POLL_TIMEOUT_MS;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const current = await pigeon.findNotificationOrder(orderId);
    lastStatus = current?.status;
    if (lastStatus === "PROCESSED") {
      ok(`Order ${orderId} reached PROCESSED`);
      return;
    }
    if (lastStatus === "FAILED") {
      fail(`Order ${orderId} ended in FAILED state: ${current?.statusMessage ?? ""}`);
      return;
    }
    await sleep(ORDER_POLL_INTERVAL_MS);
  }
  fail(`Order ${orderId} did not reach PROCESSED within ${ORDER_POLL_TIMEOUT_MS}ms (last status: ${lastStatus})`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});