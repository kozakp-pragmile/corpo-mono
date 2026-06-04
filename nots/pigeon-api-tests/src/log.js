const COL_WIDTH = 56;
const GUTTER = " │ ";
const TOTAL = COL_WIDTH * 2 + GUTTER.length;

let passed = 0;
let failed = 0;

export function step(label) {
  console.log(`\n${"─".repeat(TOTAL)}`);
  console.log(`▸ ${label}`);
  console.log("─".repeat(TOTAL));
}

export function ok(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

export function fail(msg) {
  failed++;
  console.error(`  ✗ ${msg}`);
}

// Prints a final tally of ✓/✗ and returns true when nothing failed, so callers
// can set the process exit code accordingly.
export function summary(title) {
  const allOk = failed === 0;
  console.log(`\n${"═".repeat(TOTAL)}`);
  console.log(`  Summary — ${title}`);
  console.log(`  ✓ ${passed} passed   ✗ ${failed} failed`);
  console.log(`  ${allOk ? "✓ ALL EXPECTED OUTCOMES MET" : "✗ SOME EXPECTED OUTCOMES MISSING"}`);
  console.log(`${"═".repeat(TOTAL)}\n`);
  return allOk;
}

function prettyLines(obj) {
  if (obj === undefined || obj === null) return [];
  const str = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return str.split("\n");
}

function pad(str, width) {
  const visible = str.length;
  return visible >= width ? str : str + " ".repeat(width - visible);
}

export function requestLine(method, url, status) {
  const arrow = status >= 400 ? "✗" : "→";
  console.log(`  ${method} ${url}  ${arrow} ${status}`);
}

export function columns(leftLabel, leftData, rightLabel, rightData) {
  const leftLines = prettyLines(leftData);
  const rightLines = prettyLines(rightData);
  const hasLeft = leftLines.length > 0;
  const hasRight = rightLines.length > 0;

  if (hasLeft && hasRight) {
    console.log(pad(`  ┌─ ${leftLabel}`, COL_WIDTH) + GUTTER + `┌─ ${rightLabel}`);
    const max = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < max; i++) {
      const l = leftLines[i] ?? "";
      const r = rightLines[i] ?? "";
      console.log(pad(`  ${l}`, COL_WIDTH) + GUTTER + r);
    }
  } else if (hasRight) {
    console.log(`  ┌─ ${rightLabel}`);
    for (const line of rightLines) console.log(`  ${line}`);
  } else if (hasLeft) {
    console.log(`  ┌─ ${leftLabel}`);
    for (const line of leftLines) console.log(`  ${line}`);
  }
}

export function json(label, data) {
  console.log(`  ┌─ ${label}`);
  for (const line of prettyLines(data)) console.log(`  ${line}`);
}
