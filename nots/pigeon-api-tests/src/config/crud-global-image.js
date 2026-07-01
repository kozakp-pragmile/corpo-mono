import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, "..", "..", "..", "images");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Global images live under /public/api and require a bearer token (a JWT with
// roleNotificationContentManager). Falls back to this baked-in dev token so the
// script runs out of the box; override with PIGEON_BEARER_TOKEN.
const DEFAULT_BEARER_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiIxMjM0IiwiYXVkIjoiMTIzNCIsInN1YiI6ImFkbWluIiwiZm4iOiJQaWdlb24iLCJsbiI6IkFkbWluIiwicm9sZXMiOlsicm9sZU5vdGlmaWNhdGlvbkNvbnRlbnRNYW5hZ2VyIl0sImdyIjpbIkV2ZXJ5b25lIl0sImlhdCI6MTc4MDM5MTA2NX0.fjr0784ceEDypPfXSbXZ8R_iKaPsnqCLGFn8WSDdkHhRYZVoYiCUDL-K4QCnTgj5-rWfInpfZ1WdK8Imgewz7T11naXOeTiVdifc7tV3qlCeSnT6klRyXpedc8xvs4pcPPXng5Fq_JQKzipQm2_7Qz7VicDDwZT21SoVGpkm3sSy0dC0iZtzNl_URV1zTOlcmlhkTM8N_X7wXKfy_YwmlEXc-nSbLxcYim7JFkKrkR1256YWfYqyCn3fJvZ41CieNohFTTJxAOgdKC1Q1js6iHXV6A_01E3Hs3w597iixiq8BgA240KaP_xdwKANHW1HNQZXF4PhXoAJSpCa-OEX5Q";
const GLOBAL_TOKEN = process.env.PIGEON_BEARER_TOKEN || DEFAULT_BEARER_TOKEN;

// The PNG variants exceed the backend's configured max image size, so the JPG ones are used.
// Create uploads hawk.jpg; update replaces it with eagle.jpg to prove the content is swapped.
const CREATE_IMAGE_PATH = resolve(IMAGES_DIR, "jpg", "hawk.jpg");
const UPDATE_IMAGE_PATH = resolve(IMAGES_DIR, "jpg", "eagle.jpg");

const pigeon = createClient(BASE_URL);

function check(condition, message) {
  if (condition) {
    ok(message);
  } else {
    fail(message);
  }
}

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}\n`);

  const imageName = `crud-global-image-${Date.now()}`;
  const renamedImageName = `${imageName}-v2`;

  // ── 1. Create global image (POST /public/api/global-images) ─
  step("1. Create global image (POST, multipart name + image)");
  const created = await pigeon.addGlobalImage({
    name: imageName,
    imagePath: CREATE_IMAGE_PATH,
    accessToken: GLOBAL_TOKEN,
  });
  const imageId = created.id;
  check(Boolean(imageId), `Created: ${imageId}`);
  check(created.name === imageName, `Name echoed: ${created.name}`);
  check(created.fileName === "hawk.jpg", `File name: ${created.fileName}`);
  check(created.contentType === "image/jpeg", `Content type: ${created.contentType}`);

  // ── 2. Get metadata by id (GET /{id}) ─────────────────────
  step("2. Get global image metadata by id (GET /{id})");
  const found = await pigeon.findGlobalImage(imageId, GLOBAL_TOKEN);
  check(found.id === imageId, `Found by id: ${found.id}`);
  check(found.name === imageName, `Name matches: ${found.name}`);
  check(Boolean(found.audit?.createdBy?.id), `Audit present: created by ${found.audit?.createdBy?.id}`);

  // ── 3. Download binary content (GET /{id}/content) ─────────
  step("3. Download global image content (GET /{id}/content)");
  await pigeon.downloadGlobalImageContent(imageId, GLOBAL_TOKEN);
  ok("Content downloaded (binary)");

  // ── 4. Query without filters (GET) ─────────────────────────
  step("4. Query global images (no filters, sorted by createdOn DESC)");
  const page = await pigeon.queryGlobalImages({
    size: 5,
    sortBy: "createdOn",
    direction: "DESC",
    accessToken: GLOBAL_TOKEN,
  });
  check(Array.isArray(page.content), `Returned ${page.content?.length ?? 0} of ${page.totalElements} images`);

  // ── 5. Query by exact name (GET ?name=) ────────────────────
  step("5. Query by exact name");
  const byName = await pigeon.queryGlobalImages({ name: imageName, accessToken: GLOBAL_TOKEN });
  check(
    byName.totalElements === 1 && byName.content[0]?.id === imageId,
    `Exact name match: ${byName.totalElements} result(s)`
  );

  // ── 6. Query by partial search (GET ?search=) ──────────────
  step("6. Query by partial, case-insensitive search term");
  const bySearch = await pigeon.queryGlobalImages({ search: "crud-global-image", accessToken: GLOBAL_TOKEN });
  check(
    bySearch.content.some((i) => i.id === imageId),
    `Search returned the created image (total ${bySearch.totalElements})`
  );

  // ── 7. Update image (PUT /{id}) ────────────────────────────
  step("7. Update global image (PUT, multipart — rename + new file)");
  const updated = await pigeon.updateGlobalImage(imageId, {
    name: renamedImageName,
    imagePath: UPDATE_IMAGE_PATH,
    accessToken: GLOBAL_TOKEN,
  });
  check(updated.id === imageId, `Updated same id: ${updated.id}`);
  check(updated.name === renamedImageName, `Name replaced: ${updated.name}`);
  check(updated.fileName === "eagle.jpg", `File name replaced: ${updated.fileName}`);

  // ── 8. Confirm update persisted (GET /{id}) ────────────────
  step("8. Confirm update persisted (GET /{id})");
  const afterUpdate = await pigeon.findGlobalImage(imageId, GLOBAL_TOKEN);
  check(afterUpdate.name === renamedImageName, `Persisted name: ${afterUpdate.name}`);
  check(afterUpdate.fileName === "eagle.jpg", `Persisted file name: ${afterUpdate.fileName}`);

  // ── 9. Delete image (DELETE /{id}) ─────────────────────────
  step("9. Delete global image (DELETE /{id})");
  await pigeon.deleteGlobalImage(imageId, GLOBAL_TOKEN);
  ok("Deleted");

  // ── 10. Confirm deletion (GET /{id} → 404) ─────────────────
  step("10. Confirm deletion (GET /{id} → 404)");
  try {
    await pigeon.findGlobalImage(imageId, GLOBAL_TOKEN);
    fail("Expected 404 after deletion, but the image was still found");
  } catch (e) {
    check(e.status === 404, `Not found after deletion (status ${e.status})`);
  }

  if (!summary("global image lifecycle")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});
