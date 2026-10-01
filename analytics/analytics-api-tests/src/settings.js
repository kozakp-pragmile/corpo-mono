import { DEFAULT_BASE_URL } from "./analytics-client.js";
import { DEFAULT_KPI } from "./dashboard/specs.js";

export const BASE = { fallback: DEFAULT_BASE_URL, about: "analytics root; a BMP root (/CorpoWebserver) is refused" };
export const TOKEN = {
  secret: true,
  whenUnset: "built-in dev token (user jwt-example, expires 2045)",
  about: "auth-service JWT of a BMP user, without Bearer",
};
export const KPI = { fallback: DEFAULT_KPI, about: "rid of the KPI the tile starts from" };
export const PERIOD = { fallback: "1735686000000", about: "period start, epoch ms in BMP's zone (default is 2025 in Oslo)" };
export const PERIOD_TYPE = { fallback: "Y", about: "the customer's period type id" };
export const YTD = { fallback: "false", about: "true reads from the start of the year" };
export const SECOND_KPI = { whenUnset: "(unset, one tile)", about: "rid of a second KPI; adds a second tile" };

// Reads every variable from the environment, prints what this run uses and returns the values by name.
// A definition with needsRealValue marks its default as unusable for this script.
export function settings(title, definitions) {
  console.log(`\nSettings for ${title} (env wins over default)`);
  const values = {};
  const toSet = [];
  for (const [name, definition] of Object.entries(definitions)) {
    const raw = process.env[name];
    const fromEnv = raw !== undefined && raw !== "";
    values[name] = fromEnv ? raw : definition.fallback;
    const shown = fromEnv ? (definition.secret ? `set (${raw.length} chars, ends ${raw.slice(-6)})` : raw) : (definition.fallback ?? definition.whenUnset ?? "(unset)");
    const source = fromEnv ? "env" : definition.fallback === undefined ? "unset" : "default";
    const mark = !fromEnv && definition.needsRealValue ? "  <-- SET THIS" : "";
    console.log(`  ${name.padEnd(12)} ${shown.padEnd(52)} ${source.padEnd(8)} ${definition.about}${mark}`);
    if (!fromEnv && definition.needsRealValue) toSet.push(`${name}: ${definition.needsRealValue}`);
  }
  for (const line of toSet) console.warn(`  ! set ${line}`);
  return values;
}
