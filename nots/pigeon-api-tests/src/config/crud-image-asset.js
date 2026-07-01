import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, "..", "..", "..", "images");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// Image assets live under /public/api and require a bearer token (a JWT with
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

  const imageName = `crud-image-asset-${Date.now()}`;
  const renamedImageName = `${imageName}-v2`;

  // ── 1. Create image asset (POST /public/api/image-assets) ──
  // Create/update return the domain ImageAssetUco, which carries `version`.
  step("1. Create image asset (POST, multipart name + image)");
  const created = await pigeon.addImageAsset({
    name: imageName,
    imagePath: CREATE_IMAGE_PATH,
    accessToken: GLOBAL_TOKEN,
  });
  const imageId = created.id;
  const createdVersion = created.version;
  check(Boolean(imageId), `Created: ${imageId}`);
  check(created.name === imageName, `Name echoed: ${created.name}`);
  check(created.fileName === "hawk.jpg", `File name: ${created.fileName}`);
  check(created.contentType === "image/jpeg", `Content type: ${created.contentType}`);
  check(createdVersion >= 1, `Initial version: ${createdVersion}`);

  // ── 2. Get projection by id (GET /{id}) ───────────────────
  // GET/query return the ImageAssetProjectionUco: `currentVersion` + flat createdBy/updatedBy.
  step("2. Get image asset projection by id (GET /{id})");
  const found = await pigeon.findImageAsset(imageId, GLOBAL_TOKEN);
  check(found.id === imageId, `Found by id: ${found.id}`);
  check(found.name === imageName, `Name matches: ${found.name}`);
  check(found.currentVersion >= 1, `Current version: ${found.currentVersion}`);
  check(Boolean(found.createdBy?.authId), `Created by: ${found.createdBy?.authId}`);

  // ── 3. Download binary content (GET /{id}/content) ────────
  step("3. Download image asset content (GET /{id}/content)");
  await pigeon.downloadImageAssetContent(imageId, GLOBAL_TOKEN);
  ok("Content downloaded (binary)");

  // ── 4. Query without filters (GET) ────────────────────────
  step("4. Query image assets (no filters, sorted by createdOn DESC)");
  const page = await pigeon.queryImageAssets({
    size: 5,
    sortBy: "createdOn",
    direction: "DESC",
    accessToken: GLOBAL_TOKEN,
  });
  check(Array.isArray(page.content), `Returned ${page.content?.length ?? 0} of ${page.totalElements} assets`);

  // ── 5. Query by exact name (GET ?name=) ───────────────────
  step("5. Query by exact name");
  const byName = await pigeon.queryImageAssets({ name: imageName, accessToken: GLOBAL_TOKEN });
  check(
    byName.totalElements === 1 && byName.content[0]?.id === imageId,
    `Exact name match: ${byName.totalElements} result(s)`
  );

  // ── 6. Query by partial search (GET ?search=) ─────────────
  step("6. Query by partial, case-insensitive search term");
  const bySearch = await pigeon.queryImageAssets({ search: "crud-image-asset", accessToken: GLOBAL_TOKEN });
  check(
    bySearch.content.some((i) => i.id === imageId),
    `Search returned the created asset (total ${bySearch.totalElements})`
  );

  // ── 7. Update asset (PUT /{id}) ───────────────────────────
  // Event-sourced: an update appends a new version, so `version` advances past the create's.
  step("7. Update image asset (PUT, multipart — rename + new file)");
  const updated = await pigeon.updateImageAsset(imageId, {
    name: renamedImageName,
    imagePath: UPDATE_IMAGE_PATH,
    accessToken: GLOBAL_TOKEN,
  });
  check(updated.id === imageId, `Updated same id: ${updated.id}`);
  check(updated.name === renamedImageName, `Name replaced: ${updated.name}`);
  check(updated.fileName === "eagle.jpg", `File name replaced: ${updated.fileName}`);
  check(updated.version > createdVersion, `Version advanced: ${createdVersion} → ${updated.version}`);

  // ── 8. Confirm update persisted (GET /{id}) ───────────────
  step("8. Confirm update persisted (GET /{id})");
  const afterUpdate = await pigeon.findImageAsset(imageId, GLOBAL_TOKEN);
  check(afterUpdate.name === renamedImageName, `Persisted name: ${afterUpdate.name}`);
  check(afterUpdate.fileName === "eagle.jpg", `Persisted file name: ${afterUpdate.fileName}`);
  check(
    afterUpdate.currentVersion > createdVersion,
    `Projection version advanced: ${createdVersion} → ${afterUpdate.currentVersion}`
  );

  // ── 9. Delete asset (DELETE /{id}) ────────────────────────
  step("9. Delete image asset (DELETE /{id})");
  await pigeon.deleteImageAsset(imageId, GLOBAL_TOKEN);
  ok("Deleted");

  // ── 10. Confirm deletion (GET /{id} → 404) ────────────────
  step("10. Confirm deletion (GET /{id} → 404)");
  try {
    await pigeon.findImageAsset(imageId, GLOBAL_TOKEN);
    fail("Expected 404 after deletion, but the asset was still found");
  } catch (e) {
    check(e.status === 404, `Not found after deletion (status ${e.status})`);
  }

  if (!summary("image asset lifecycle")) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});
