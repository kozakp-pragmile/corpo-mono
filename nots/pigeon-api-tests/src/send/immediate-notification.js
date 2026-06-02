import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates", "immediate");
const IMAGES_DIR = resolve(__dirname, "..", "..", "..", "images");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Bearer token for the `/public/api/global-images` endpoint, used only by STANDARD
// scenarios. If not set, the global image step is skipped (image won't be embedded
// in STANDARD emails, but the orders still go through).
const GLOBAL_IMAGES_TOKEN = process.env.PIGEON_BEARER_TOKEN;

const WITH_NAME_TEMPLATE = resolve(TEMPLATES_DIR, "with-name-en.html");
const WITHOUT_NAME_TEMPLATE = resolve(TEMPLATES_DIR, "without-name-en.html");
const OWL_IMAGE_NAME = "owl";
const OWL_IMAGE_PATH = resolve(IMAGES_DIR, "owl.jpg");

const SUBJECT_WITH_NAME = "Welcome, {{name}}!";
const SUBJECT_WITHOUT_NAME = "Notification update";

// Recipients are scoped to the channel so EMAIL scenarios never touch in-tool-only
// users (and vice versa). Each recipient only carries the contact info the channel
// actually needs.
const RECIPIENTS_BY_CHANNEL = {
  EMAIL: {
    primary: {
      externalIdSource: "BMP",
      externalIdValue: "pigeon-api-tests-alice",
      email: "alice.anderson@example.com",
      fullName: "Alice Anderson",
    },
    secondary: {
      externalIdSource: "BMP",
      externalIdValue: "pigeon-api-tests-bob",
      email: "bob.brown@example.com",
      fullName: "Bob Brown",
    },
  },
  IN_TOOL: {
    primary: {
      authId: "pigeon-admin",
      fullName: "James Smith",
    },
    secondary: {
      authId: "pigeon-in-tool-user",
      fullName: "Jessica Williams",
    },
  },
};

const TAG = "pigeon-api-tests-immediate";
const ORDER_POLL_TIMEOUT_MS = 30_000;
const ORDER_POLL_INTERVAL_MS = 500;

const pigeon = createClient(BASE_URL);

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  for (const kind of ["STANDARD", "LEGACY"]) {
    for (const channel of ["EMAIL", "IN_TOOL"]) {
      await runScenario(kind, channel);
    }
  }

  console.log(`\n${"═".repeat(115)}`);
  console.log("  Done — immediate notification scenarios complete");
  console.log(`${"═".repeat(115)}\n`);
}

async function runScenario(kind, channel) {
  const label = `${kind} / ${channel}`;
  console.log(`\n${"#".repeat(115)}`);
  console.log(`# Scenario: ${label}`);
  console.log(`${"#".repeat(115)}`);

  const suffix = `${kind.toLowerCase()}-${channel.toLowerCase()}-${Date.now()}`;
  const recipients = RECIPIENTS_BY_CHANNEL[channel];
  const createdNt = await createImmediateNt(kind, channel, `Immediate ${label} ${suffix}`);
  const ntId = createdNt.id;
  const imageContext = await registerOwlImage(kind, ntId, createdNt.version);
  ok(`Notification type created: ${ntId}`);

  const refreshedAfterImage = await refreshNt(kind, ntId);
  const ntVersion = refreshedAfterImage.version;

  const withNameTemplate = await addTemplate(kind, ntId, ntVersion, {
    name: `with-name-${suffix}`,
    language: "en",
    syntax: "CKEDITOR",
    subject: SUBJECT_WITH_NAME,
    contentPath: WITH_NAME_TEMPLATE,
  });
  const withNameTemplateId = templateIdOf(kind, withNameTemplate);
  ok(`Template (with name) added: ${withNameTemplateId}`);

  // The `{{name}}` placeholder is a built-in that the backend always fills from
  // recipient.fullName, so we only pass our own custom variables here.
  await sendOrder({
    label: "single recipient + template with name",
    notificationTypeId: ntId,
    recipients: [recipients.primary],
    variables: { messageBody: "Hello from the immediate notification test." },
  });

  await sendOrder({
    label: "multiple recipients + template with name",
    notificationTypeId: ntId,
    recipients: [recipients.primary, recipients.secondary],
    variables: { messageBody: "Heads-up for both of you." },
  });

  step(`Replace template with one that does NOT reference name`);
  const refreshedAfterFirst = await refreshNt(kind, ntId);
  await removeTemplate(kind, ntId, refreshedAfterFirst.version, withNameTemplateId);
  ok("Previous template removed");

  const refreshedAfterRemoval = await refreshNt(kind, ntId);
  const withoutNameTemplate = await addTemplate(kind, ntId, refreshedAfterRemoval.version, {
    name: `without-name-${suffix}`,
    language: "en",
    syntax: "CKEDITOR",
    subject: SUBJECT_WITHOUT_NAME,
    contentPath: WITHOUT_NAME_TEMPLATE,
  });
  const withoutNameTemplateId = templateIdOf(kind, withoutNameTemplate);
  ok(`Template (without name) added: ${withoutNameTemplateId}`);

  await sendOrder({
    label: "single recipient + template without name",
    notificationTypeId: ntId,
    recipients: [recipients.primary],
    variables: { messageBody: "Notification rendered without a name placeholder." },
  });

  await sendOrder({
    label: "multiple recipients + template without name",
    notificationTypeId: ntId,
    recipients: [recipients.primary, recipients.secondary],
    variables: { messageBody: "Multi-recipient notification without a name placeholder." },
  });

  step(`Cleanup ${label}`);
  const refreshedBeforeCleanup = await refreshNt(kind, ntId);
  await removeTemplate(kind, ntId, refreshedBeforeCleanup.version, withoutNameTemplateId);
  ok("Template removed");

  const refreshedAfterTemplateRemoval = await refreshNt(kind, ntId);
  await unregisterOwlImage(kind, ntId, refreshedAfterTemplateRemoval.version, imageContext);

  const refreshedAfterImageRemoval = await refreshNt(kind, ntId);
  await deleteNt(kind, ntId, refreshedAfterImageRemoval.version);
  ok("Notification type deleted");
}

async function registerOwlImage(kind, ntId, ntVersion) {
  step(`Register ${OWL_IMAGE_NAME} image (${kind})`);
  if (kind === "LEGACY") {
    const image = await pigeon.addLegacyImage(ntId, {
      name: OWL_IMAGE_NAME,
      imagePath: OWL_IMAGE_PATH,
      version: ntVersion,
    });
    ok(`Legacy image attached: ${image.id}`);
    return { imageId: image.id };
  }
  if (!GLOBAL_IMAGES_TOKEN) {
    fail(
      `PIGEON_BEARER_TOKEN not set — skipping global image registration. ` +
        `The ${OWL_IMAGE_NAME} image will not be embedded in STANDARD emails.`
    );
    return { imageId: null };
  }
  const image = await pigeon.addGlobalImage({
    name: `${OWL_IMAGE_NAME}-${Date.now()}`,
    imagePath: OWL_IMAGE_PATH,
    accessToken: GLOBAL_IMAGES_TOKEN,
  });
  ok(`Global image created: ${image.id}`);
  return { imageId: image.id };
}

async function unregisterOwlImage(kind, ntId, ntVersion, imageContext) {
  if (!imageContext || !imageContext.imageId) return;
  if (kind === "LEGACY") {
    await pigeon.removeLegacyImage(ntId, imageContext.imageId, ntVersion);
    ok("Legacy image removed");
    return;
  }
  await pigeon.deleteGlobalImage(imageContext.imageId, GLOBAL_IMAGES_TOKEN);
  ok("Global image deleted");
}

async function createImmediateNt(kind, channel, name) {
  step(`Create ${kind} immediate notification type (${channel})`);
  if (kind === "STANDARD") {
    return pigeon.createStandard({
      name,
      channel,
      senderName: "Pigeon Immediate Tests",
      defaultNotificationTiming: "IMMEDIATE",
    });
  }
  return pigeon.createLegacy({
    name,
    channel,
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

async function sendOrder({ label, notificationTypeId, recipients, variables }) {
  step(`Order — ${label} (${recipients.length} recipient${recipients.length === 1 ? "" : "s"})`);
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
