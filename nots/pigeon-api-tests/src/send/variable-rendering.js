import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "../pigeon-client.js";
import { step, ok, fail, json, summary } from "../log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "..", "templates");

const BASE_URL = process.env.PIGEON_URL || "http://localhost:8086/pigeon/server";
// The :send endpoint actually delivers the rendered email and returns no body, so
// the only way to observe the rendered HTML is to receive it. Set PIGEON_TEST_EMAIL
// to an inbox you can inspect; otherwise this default recipient is used so the
// scenarios still get sent and rendered.
const DEFAULT_TEST_EMAIL = "pigeon-rendering-tests@example.com";
const TEST_EMAIL = process.env.PIGEON_TEST_EMAIL || DEFAULT_TEST_EMAIL;

const CKEDITOR_TEMPLATE = resolve(TEMPLATES_DIR, "variable-rendering", "ckeditor", "en.html");
const THYMELEAF_TEMPLATE = resolve(TEMPLATES_DIR, "variable-rendering", "thymeleaf", "en.html");

// Each scenario maps to one variables payload. The `expect` lines describe what the
// NOTS-783 sanitization/classification should produce in the rendered email so the
// human inspecting the inbox knows exactly what to look for.
const SCENARIOS = [
  {
    label: "Safe rich HTML + normal URL",
    variables: {
      name: "Alice",
      // Angle brackets but no real HTML tag — must NOT be treated as HTML.
      workflowName: "<My Workflow v1>",
      // Plain URL string (no tags) → stays plain text → escaped into href.
      linkUrl: "https://app.corporater.com/tasks/42?ref=email&src=pigeon",
      // Real HTML → wrapped in SafeHtml → emitted raw; target=_blank is hardened.
      richContent:
        '<p>You have <b>3 pending tasks</b>. ' +
        '<a href="https://app.corporater.com" target="_blank">View them</a>.</p>',
      messageBody: "Please review before Friday.",
    },
    expect: [
      "workflowName: rendered literally as text `<My Workflow v1>` (no tags, fallback to plain text)",
      "linkUrl: href points at the URL; the `&` is shown entity-escaped in source but the link still works",
      "richContent: rendered as real HTML (bold + link); the target=_blank link gains rel=\"noopener noreferrer\"",
      "messageBody: plain escaped text",
    ],
  },
  {
    label: "Insecure HTML with JavaScript (XSS attempts)",
    variables: {
      // A <script> inside a value: it is HTML, but after cleaning nothing survives,
      // so it falls back to plain text and is escaped — shown literally, not executed.
      name: "Bob <script>alert('xss')</script>",
      // HTML value: onclick is stripped, <b> survives → raw `<b>Important</b>`.
      workflowName: "<b onclick=\"alert(1)\">Important</b>",
      // THE TRICKY GAP: a bare javascript: URL has no HTML tags, so it is NOT
      // classified as HTML and NOT sanitized — it lands in the href verbatim.
      linkUrl: "javascript:alert(document.cookie)",
      // HTML value with several attacks; all should be neutralized:
      //  - javascript: href dropped, onclick dropped → `<a>Click me</a>`
      //  - <img onerror> removed (img not on the safelist)
      //  - <script> removed
      //  - `<p>Safe paragraph</p>` kept
      richContent:
        '<a href="javascript:alert(1)" onclick="steal()">Click me</a>' +
        '<img src="x" onerror="alert(2)">' +
        "<script>alert(3)</script>" +
        "<p>Safe paragraph</p>",
      // `>` and `&` as plain text — no tags, so escaped and rendered correctly.
      messageBody: "Balance is 100 > 50 & rising",
    },
    expect: [
      "name: shown literally as text `Bob <script>...</script>` — script does NOT run",
      "workflowName: `Important` in bold; the onclick handler is gone",
      "linkUrl: href is `javascript:alert(document.cookie)` — NOT sanitized (plain-text values bypass the HTML cleaner). Highlight this as a finding.",
      "richContent: only `Click me` (no href/onclick) and `Safe paragraph` survive; img/script removed",
      "messageBody: rendered as `Balance is 100 > 50 & rising`",
    ],
  },
  {
    label: "Edge cases and fallbacks",
    variables: {
      name: "Charlie",
      // Unknown custom tag → stripped to nothing → fallback to plain text → literal.
      workflowName: "<my-custom-tag>",
      // mailto is on the allowed protocol list for plain href usage.
      linkUrl: "mailto:support@corporater.com",
      // div has no allowed attributes, so style/onmouseover are dropped; list kept.
      richContent:
        "<ul><li>One</li><li>Two</li></ul>" +
        '<div style="color:red" onmouseover="x()">Styled block</div>',
      messageBody: "Plain and simple.",
    },
    expect: [
      "workflowName: rendered literally as `<my-custom-tag>`",
      "linkUrl: mailto link works",
      "richContent: bullet list plus a plain `Styled block` div (style + onmouseover removed)",
      "messageBody: plain escaped text",
    ],
  },
];

// A standard notification type allows only one template per language, so each
// syntax gets its own notification type carrying a single "en" template.
const SYNTAXES = [
  { syntax: "CKEDITOR", subject: "{{engine}} — {{scenario}}", contentPath: CKEDITOR_TEMPLATE },
  { syntax: "THYMELEAF", subject: "[[${engine}]] — [[${scenario}]]", contentPath: THYMELEAF_TEMPLATE },
];

const pigeon = createClient(BASE_URL);

async function run() {
  console.log(`\nPigeon API: ${BASE_URL}`);
  const emailSource = process.env.PIGEON_TEST_EMAIL ? "PIGEON_TEST_EMAIL" : "default";
  console.log(`Test recipient: ${TEST_EMAIL} (${emailSource})\n`);

  for (const syntax of SYNTAXES) {
    await runSyntax(syntax);
  }

  if (!summary("variable rendering scenarios")) {
    process.exitCode = 1;
  }
}

async function runSyntax({ syntax, subject, contentPath }) {
  console.log(`\n${"#".repeat(115)}`);
  console.log(`# Syntax: ${syntax}`);
  console.log(`${"#".repeat(115)}`);

  step(`Create standard notification type for ${syntax} (EMAIL, IMMEDIATE)`);
  const created = await pigeon.createStandard({
    name: `Variable Rendering ${syntax} ${Date.now()}`,
    channel: "EMAIL",
    senderName: "Pigeon Rendering Tests",
    defaultNotificationTiming: "IMMEDIATE",
  });
  const sntId = created.id;
  ok(`Created: ${sntId}`);

  step(`Add ${syntax} template`);
  const template = await pigeon.addStandardTemplate(sntId, {
    name: `Variable Rendering ${syntax}`,
    language: "en",
    syntax,
    subject,
    contentPath,
  });
  ok(`Template added: ${template.templateId}`);

  for (const scenario of SCENARIOS) {
    await runScenario(sntId, { syntax, templateId: template.templateId }, scenario);
  }

  step(`Cleanup ${syntax} template and notification type`);
  await pigeon.removeStandardTemplate(sntId, template.templateId);
  await pigeon.deleteStandard(sntId);
  ok("Deleted");
}

async function runScenario(sntId, template, scenario) {
  step(`${template.syntax} — ${scenario.label}`);
  json("Variables", scenario.variables);
  console.log("  ┌─ Expected rendering");
  for (const line of scenario.expect) console.log(`  • ${line}`);

  try {
    await pigeon.sendStandardTemplateTest(sntId, template.templateId, {
      channel: "EMAIL",
      email: TEST_EMAIL,
      variables: { engine: template.syntax, scenario: scenario.label, ...scenario.variables },
    });
    ok(`Test email sent to ${TEST_EMAIL}`);
  } catch (e) {
    fail(`Send failed: ${e.message} (EMAIL channel may not be configured)`);
  }
}

run().catch((err) => {
  fail(err.message);
  if (err.data) console.error(err.data);
  process.exit(1);
});
