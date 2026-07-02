import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, "..", "..", "..", "images");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Image assets live under /public/api and require a bearer token (a JWT with
// roleNotificationContentManager). Falls back to this baked-in dev token so the
// seed runs out of the box; override with PIGEON_BEARER_TOKEN.
const DEFAULT_BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiIxMjM0IiwiYXVkIjoiMTIzNCIsInN1YiI6ImFkbWluIiwiZm4iOiJQaWdlb24iLCJsbiI6IkFkbWluIiwicm9sZXMiOlsicm9sZU5vdGlmaWNhdGlvbkNvbnRlbnRNYW5hZ2VyIl0sImdyIjpbIkV2ZXJ5b25lIl0sImlhdCI6MTc4MDM5MTA2NX0.fjr0784ceEDypPfXSbXZ8R_iKaPsnqCLGFn8WSDdkHhRYZVoYiCUDL-K4QCnTgj5-rWfInpfZ1WdK8Imgewz7T11naXOeTiVdifc7tV3qlCeSnT6klRyXpedc8xvs4pcPPXng5Fq_JQKzipQm2_7Qz7VicDDwZT21SoVGpkm3sSy0dC0iZtzNl_URV1zTOlcmlhkTM8N_X7wXKfy_YwmlEXc-nSbLxcYim7JFkKrkR1256YWfYqyCn3fJvZ41CieNohFTTJxAOgdKC1Q1js6iHXV6A_01E3Hs3w597iixiq8BgA240KaP_xdwKANHW1HNQZXF4PhXoAJSpCa-OEX5Q";
const GLOBAL_TOKEN = process.env.PIGEON_BEARER_TOKEN || DEFAULT_BEARER_TOKEN;

// Seed a curated set of well-known named logos so templates and tests can embed them by
// name. Names are stable (no timestamp) so the seed is idempotent — a re-run reuses the
// already-seeded asset instead of failing on a duplicate. The JPG variants are used because
// the PNGs exceed the backend's configured max image size.
const IMAGES = [
  { name: "owl", file: "owl.jpg" },
  // Same file seeded twice under different names — proves names are independent of file content.
  { name: "scary-owl", file: "owl.jpg" },
  { name: "pigeon", file: "pigeon.jpg" },
  { name: "eagle", file: "eagle.jpg" },
  { name: "hawk", file: "hawk.jpg" },
  { name: "kestrel", file: "kestrel.jpg" },
  { name: "hummingbird", file: "hummingbird.jpg" },
  { name: "merlin", file: "merlin.jpg" },
];

const pigeon = createClient(BASE_URL);

async function seedImageAsset({ name, file }) {
  step(`Seed image asset "${name}" (${file})`);
  try {
    const asset = await pigeon.addImageAsset({
      name,
      imagePath: resolve(IMAGES_DIR, "jpg", file),
      accessToken: GLOBAL_TOKEN,
    });
    ok(`Created "${name}": ${asset.id}`);
    return asset.id;
  } catch (e) {
    // A previous run may have already seeded it; reuse the existing asset's id so the
    // seed stays idempotent.
    const existing = await pigeon.queryImageAssets({ name, accessToken: GLOBAL_TOKEN });
    const match = existing?.content?.find((i) => i.name === name) ?? existing?.content?.[0];
    if (match) {
      ok(`Reusing existing "${name}": ${match.id}`);
      return match.id;
    }
    fail(`Could not seed "${name}" (status ${e.status ?? "?"}) and none exists to reuse`);
    return null;
  }
}

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  const seededIds = [];
  for (const image of IMAGES) {
    const id = await seedImageAsset(image);
    if (id) {
      seededIds.push(id);
    }
  }

  console.log(`\nSeeded image assets ${seededIds.join(", ")} (left in database).\n`);

  if (!summary("image assets seed")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});
