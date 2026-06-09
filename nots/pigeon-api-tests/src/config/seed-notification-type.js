import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates");
const IMAGES_DIR = resolve(__dirname, "..", "..", "..", "images");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Images are registered as global images (under /public/api), which notification-type
// templates resolve by name at render time. Global images require a bearer token (a JWT
// with roleNotificationContentManager). Falls back to this baked-in dev token so the
// seed runs out of the box; override with PIGEON_BEARER_TOKEN.
const DEFAULT_BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiIxMjM0IiwiYXVkIjoiMTIzNCIsInN1YiI6ImFkbWluIiwiZm4iOiJQaWdlb24iLCJsbiI6IkFkbWluIiwicm9sZXMiOlsicm9sZU5vdGlmaWNhdGlvbkNvbnRlbnRNYW5hZ2VyIl0sImdyIjpbIkV2ZXJ5b25lIl0sImlhdCI6MTc4MDM5MTA2NX0.fjr0784ceEDypPfXSbXZ8R_iKaPsnqCLGFn8WSDdkHhRYZVoYiCUDL-K4QCnTgj5-rWfInpfZ1WdK8Imgewz7T11naXOeTiVdifc7tV3qlCeSnT6klRyXpedc8xvs4pcPPXng5Fq_JQKzipQm2_7Qz7VicDDwZT21SoVGpkm3sSy0dC0iZtzNl_URV1zTOlcmlhkTM8N_X7wXKfy_YwmlEXc-nSbLxcYim7JFkKrkR1256YWfYqyCn3fJvZ41CieNohFTTJxAOgdKC1Q1js6iHXV6A_01E3Hs3w597iixiq8BgA240KaP_xdwKANHW1HNQZXF4PhXoAJSpCa-OEX5Q";
const GLOBAL_TOKEN = process.env.PIGEON_BEARER_TOKEN || DEFAULT_BEARER_TOKEN;

const pigeon = createClient(BASE_URL);

// All templates are seeded as CKEDITOR (the syntax the UI authors). The aggregate digest
// uses the structure-driven card format, which only the CKEDITOR set supports here.
const SYNTAX = "CKEDITOR";
const LANGUAGES = [
  { code: "en", standardSubject: "Your daily stock quotation", aggregateSubject: "Your stock quotation digest" },
  { code: "de", standardSubject: "Ihre tägliche Aktiennotierung", aggregateSubject: "Ihre Aktiennotierungsübersicht" },
  { code: "fr", standardSubject: "Votre cotation boursière quotidienne", aggregateSubject: "Votre synthèse de cotations" },
  { code: "no", standardSubject: "Din daglige aksjenotering", aggregateSubject: "Din aksjenoteringsoversikt" },
  { code: "pl", standardSubject: "Twoje dzienne notowanie akcji", aggregateSubject: "Podsumowanie notowań akcji" },
];

// IMMEDIATE notifications are sent right away and never buffered into a digest, so an
// AGGREGATE template would never be used — only DAILY/WEEKLY types get one. Each type
// embeds a different bird as its logo so the seeded emails are visually distinguishable;
// the bundled templates reference the "owl" image, which is rewritten to the bird below
// and registered as a global image so the reference resolves by name at render time.
const TYPE_DEFS = [
  { key: "immediate", label: "Immediate Stock Quotation", timing: "IMMEDIATE", senderName: "Pigeon Notification Type Seed — Immediate", image: "sparrow", withAggregate: false },
  { key: "daily", label: "Daily Stock Quotation", timing: "DAILY", senderName: "Pigeon Notification Type Seed — Daily", image: "pigeon", withAggregate: true },
  { key: "weekly", label: "Weekly Stock Quotation", timing: "WEEKLY", senderName: "Pigeon Notification Type Seed — Weekly", image: "eagle", withAggregate: true },
];

// The bundled CKEDITOR templates reference the logo via data-image-name="owl"; point it at
// this type's bird so the embedded image resolves. The backend embeds the image by name at
// send time, while the editor previews it by the global-image id (data-image-id), so the id
// is injected alongside the name.
function applyImage(html, bird, imageId) {
  return html.replaceAll(
    'data-image-name="owl"',
    `data-image-name="${bird}" data-image-id="${imageId}"`
  );
}

// Each template add bumps the notification type version; refetch to chain the next one.
async function addTemplate(typeId, version, template, bird, imageId) {
  const content = applyImage(readFileSync(template.contentPath, "utf8"), bird, imageId);
  await pigeon.addLegacyTemplate(typeId, { ...template, content, version });
  const refreshed = await pigeon.findLegacy(typeId);
  return refreshed.version;
}

// Register the bird as a global image so the templates resolve it by name at render time.
// A previous run may have already created it; reuse the existing image's id in that case.
async function resolveBirdImage(bird) {
  try {
    const image = await pigeon.addGlobalImage({
      name: bird,
      imagePath: resolve(IMAGES_DIR, "jpg", `${bird}.jpg`),
      accessToken: GLOBAL_TOKEN,
    });
    ok(`Global image "${bird}" created: ${image.id}`);
    return image.id;
  } catch (e) {
    const existing = await pigeon.queryGlobalImages({ name: bird, accessToken: GLOBAL_TOKEN });
    const match = existing?.content?.find((i) => i.name === bird) ?? existing?.content?.[0];
    if (!match) {
      throw new Error(
        `Global image "${bird}" could not be created (status ${e.status ?? "?"}) and none exists to reuse.`
      );
    }
    ok(`Reusing existing global image "${bird}": ${match.id}`);
    return match.id;
  }
}

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);
  const createdIds = [];

  for (const def of TYPE_DEFS) {
    step(`Register ${def.image} logo image (global, resolved by name at render time)`);
    const imageId = await resolveBirdImage(def.image);

    step(`Create notification type — ${def.label} (EMAIL, ${def.timing})`);
    const type = await pigeon.createLegacy({
      name: `${def.label} ${Date.now()}`,
      channel: "EMAIL",
      senderName: def.senderName,
      defaultTiming: def.timing,
    });
    createdIds.push(type.id);
    ok(`Created: ${type.id}`);

    let version = type.version;

    step(`Add STANDARD templates [${LANGUAGES.map((l) => l.code).join(", ")}]`);
    for (const lang of LANGUAGES) {
      version = await addTemplate(type.id, version, {
        name: `${def.label} Standard ${lang.code.toUpperCase()}`,
        language: lang.code,
        syntax: SYNTAX,
        type: "STANDARD",
        subject: lang.standardSubject,
        contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "ckeditor", `standard-${lang.code}.html`),
      }, def.image, imageId);
      ok(`STANDARD/${lang.code}/${SYNTAX}`);
    }

    if (def.withAggregate) {
      step(`Add AGGREGATE templates [${LANGUAGES.map((l) => l.code).join(", ")}]`);
      for (const lang of LANGUAGES) {
        version = await addTemplate(type.id, version, {
          name: `${def.label} Aggregate ${lang.code.toUpperCase()}`,
          language: lang.code,
          syntax: SYNTAX,
          type: "AGGREGATE",
          aggregationDisplayType: "IRRELEVANT",
          subject: lang.aggregateSubject,
          contentPath: resolve(TEMPLATES_DIR, "stock-quotation", "ckeditor", `aggregated-${lang.code}.html`),
        }, def.image, imageId);
        ok(`AGGREGATE/${lang.code}/${SYNTAX}`);
      }
    } else {
      step(`Skip AGGREGATE templates — ${def.timing} notifications are never aggregated`);
    }
  }

  console.log(`\nSeeded notification types ${createdIds.join(", ")} (left in database).\n`);

  if (!summary("notification type seed (immediate / daily / weekly · pl/en/no/fr/de)")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});
