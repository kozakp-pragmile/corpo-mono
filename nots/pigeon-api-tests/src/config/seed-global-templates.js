import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates", "global-templates");
const IMAGES_DIR = resolve(__dirname, "..", "..", "..", "images");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Global templates and images live under /public/api and require a bearer token (a JWT
// with roleNotificationContentManager). Falls back to this baked-in dev token so the
// seed runs out of the box; override with PIGEON_BEARER_TOKEN.
const DEFAULT_BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiIxMjM0IiwiYXVkIjoiMTIzNCIsInN1YiI6ImFkbWluIiwiZm4iOiJQaWdlb24iLCJsbiI6IkFkbWluIiwicm9sZXMiOlsicm9sZU5vdGlmaWNhdGlvbkNvbnRlbnRNYW5hZ2VyIl0sImdyIjpbIkV2ZXJ5b25lIl0sImlhdCI6MTc4MDM5MTA2NX0.fjr0784ceEDypPfXSbXZ8R_iKaPsnqCLGFn8WSDdkHhRYZVoYiCUDL-K4QCnTgj5-rWfInpfZ1WdK8Imgewz7T11naXOeTiVdifc7tV3qlCeSnT6klRyXpedc8xvs4pcPPXng5Fq_JQKzipQm2_7Qz7VicDDwZT21SoVGpkm3sSy0dC0iZtzNl_URV1zTOlcmlhkTM8N_X7wXKfy_YwmlEXc-nSbLxcYim7JFkKrkR1256YWfYqyCn3fJvZ41CieNohFTTJxAOgdKC1Q1js6iHXV6A_01E3Hs3w597iixiq8BgA240KaP_xdwKANHW1HNQZXF4PhXoAJSpCa-OEX5Q";
const GLOBAL_TOKEN = process.env.PIGEON_BEARER_TOKEN || DEFAULT_BEARER_TOKEN;

// The templates embed the logo via <img data-image-name="owl">, so a global image named
// exactly "owl" must exist for the reference to resolve at render time. The JPG variant is
// used because the PNG exceeds the backend's configured max image size.
const LOGO_IMAGE_NAME = "owl";
const LOGO_IMAGE_PATH = resolve(IMAGES_DIR, "jpg", "owl.jpg");

const pigeon = createClient(BASE_URL);

// Global templates are multi-type digest wrappers, authored in CKEditor like the UI
// produces them: the aggregated parts render through the adjustable-table format (a
// single prototype <tr> the service loops), and the logo is embedded by image name.
const LANGUAGES = [
  { code: "en", subject: "Your notification digest" },
  { code: "de", subject: "Ihre Benachrichtigungsübersicht" },
  { code: "fr", subject: "Votre synthèse de notifications" },
  { code: "no", subject: "Din varslingsoversikt" },
  { code: "pl", subject: "Twoje podsumowanie powiadomień" },
];

// The editor previews the embedded image by its global-image id (data-image-id), while the
// backend embeds it at send time by name (data-image-name). The templates ship with the
// name only; the id is dynamic, so it is injected into the <img> once the image is known.
function injectImageId(html, imageId) {
  return html.replace(
    `data-image-name="${LOGO_IMAGE_NAME}"`,
    `data-image-name="${LOGO_IMAGE_NAME}" data-image-id="${imageId}"`
  );
}

async function resolveLogoImageId() {
  try {
    const image = await pigeon.addGlobalImage({
      name: LOGO_IMAGE_NAME,
      imagePath: LOGO_IMAGE_PATH,
      accessToken: GLOBAL_TOKEN,
    });
    ok(`Global image "${LOGO_IMAGE_NAME}" created: ${image.id}`);
    return image.id;
  } catch (e) {
    // A previous run may have already created it; reuse the existing image's id so the
    // editor can still resolve the preview.
    const existing = await pigeon.queryGlobalImages({ name: LOGO_IMAGE_NAME, accessToken: GLOBAL_TOKEN });
    const match = existing?.content?.find((i) => i.name === LOGO_IMAGE_NAME) ?? existing?.content?.[0];
    if (!match) {
      throw new Error(`Global image "${LOGO_IMAGE_NAME}" could not be created (status ${e.status ?? "?"}) and none exists to reuse.`);
    }
    ok(`Reusing existing global image "${LOGO_IMAGE_NAME}": ${match.id}`);
    return match.id;
  }
}

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  step(`Resolve global logo image "${LOGO_IMAGE_NAME}" (embedded as data-image-name + data-image-id)`);
  const logoImageId = await resolveLogoImageId();

  const createdIds = [];
  for (const lang of LANGUAGES) {
    step(`Create GLOBAL aggregate template — ${lang.code.toUpperCase()} (CKEDITOR, adjustable-table)`);
    const html = readFileSync(resolve(TEMPLATES_DIR, `global-digest-${lang.code}.html`), "utf8");
    const template = await pigeon.addGlobalTemplate({
      name: `seed-global-aggregate-${lang.code}-${Date.now()}`,
      language: lang.code,
      syntax: "CKEDITOR",
      subject: lang.subject,
      aggregationDisplayType: "ADJUSTABLE_TABLE",
      content: injectImageId(html, logoImageId),
      accessToken: GLOBAL_TOKEN,
    });
    createdIds.push(template.id);
    ok(`Global aggregate ${lang.code.toUpperCase()}: ${template.id}`);
  }

  console.log(`\nSeeded global aggregate templates ${createdIds.join(", ")} (left in database).\n`);

  if (!summary("global templates seed (pl/en/no/fr/de)")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});
