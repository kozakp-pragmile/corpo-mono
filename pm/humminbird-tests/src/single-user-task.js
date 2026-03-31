import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "./hummingbird-client.js";
import { step, ok, fail } from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BPMN_DIR = resolve(__dirname, "..", "bpmn");

const BASE_URL = process.env.HUMMINGBIRD_URL || "http://localhost:8095/hummingbird";
const PROCESS_KEY = "simple_user_task";
const USER_ID = "test-user";

const TASK_INCLUDES = ["processVariables", "localVariables", "processInstance", "processDefinition", "userTaskDefinition"];

const hb = createClient(BASE_URL);

async function run() {
  console.log(`\nHummingbird API: ${BASE_URL}\n`);

  // ── Setup: Deploy BPMN ─────────────────────────────────────
  step("Deploy simple-user-task.bpmn");
  const deployment = await hb.deploy(resolve(BPMN_DIR, "simple-user-task.bpmn"));
  ok(`Deployed: ${deployment.id}`);

  // ── 1. Start process with variables ────────────────────────
  step("1. Start process instance with variables");
  const instance = await hb.startProcessByKey(PROCESS_KEY, {
    businessKey: `test-${Date.now()}`,
    processVariables: {
      status: "pending",
      priority: 3,
      notes: "initial notes from process start",
      onlyProcess: "this exists only at process level",
    },
    userId: USER_ID,
  });
  const processInstanceId = instance.processInstanceId;
  ok(`Started: ${processInstanceId}`);

  // ── 2. Check variables via process instance ────────────────
  step("2. Check variables via process instance");
  await hb.getProcessVariables(processInstanceId);

  // ── 3. Change variables via process instance ───────────────
  step("3. Change variables via process instance");
  await hb.setProcessVariables(processInstanceId, {
    status: "in-review",
    priority: 5,
  });
  ok("Process variables updated");

  // ── 4. Check variables via process instance (after update) ─
  step("4. Check variables via process instance (after update)");
  await hb.getProcessVariables(processInstanceId);

  // ── 5. Find the active user task ───────────────────────────
  step("5. Find active user task instance");
  const tasks = await hb.getTasks({ processInstanceId, active: true });
  if (!tasks.length) {
    fail("No active tasks found — stopping");
    return;
  }
  const taskId = tasks[0].id;
  ok(`Active task: ${taskId} (name=${tasks[0].name})`);

  // ── 6. Check user task instance (before setting variables) ─
  step("6. Check user task instance (before setting variables)");
  await hb.getTask(taskId, { include: TASK_INCLUDES });

  // ── 7. Set process variables via user task instance ────────
  step("7. Set process variables via user task instance");
  await hb.setTaskProcessVariables(taskId, {
    status: "reviewed-via-task",
    priority: 10,
    reviewer: "bob",
  });
  ok("Process variables set via user task instance");

  // ── 8. Set local variables via user task instance ──────────
  step("8. Set local variables via user task instance (SAME NAMES as process vars)");
  await hb.setTaskLocalVariables(taskId, {
    status: "LOCAL-approved",
    priority: 999,
    notes: "LOCAL notes — should shadow process-level notes",
    onlyLocal: "this exists only at local level",
  });
  ok("Local variables set — same names as process variables");

  // ── 9. Check user task instance (v2 — separate maps) ──────
  step("9. Check user task instance (v2 — processVariables vs localVariables)");
  await hb.getTask(taskId, { include: TASK_INCLUDES });

  // ── 10. Check task variables via v1 (merged view) ──────────
  step("10. Check task variables via v1 (merged view)");
  await hb.getTaskVariables(taskId);

  // ── 11. Check task LOCAL variables via v1 ──────────────────
  step("11. Check task LOCAL variables via v1");
  await hb.getTaskLocalVariables(taskId);

  // ── 12. Check process instance variables ───────────────────
  step("12. Check process instance variables (should have task's process-var writes)");
  await hb.getProcessVariables(processInstanceId);

  // ── 13. Assign user task instance ──────────────────────────
  step("13. Assign user task instance");
  await hb.setTaskAssignee(taskId, USER_ID);
  ok(`Assigned to ${USER_ID}`);

  // ── 14. Complete with overlapping names at both levels ─────
  step("14. Complete user task with overlapping process + local variable names");
  await hb.completeTask(taskId, {
    userId: USER_ID,
    processVariables: {
      status: "completed",
      notes: "final process notes from completion",
      approved: true,
    },
    localVariables: {
      status: "LOCAL-completed",
      notes: "final local notes from completion",
      completionNote: "All checks passed",
    },
  });
  ok("Task completed");

  // ── 15. Check completed user task instance (v2) ────────────
  step("15. Check completed user task instance (v2)");
  await hb.getTask(taskId, { include: TASK_INCLUDES });

  // ── 16. Check process instance variables (final) ───────────
  step("16. Check process instance variables (final — which values won?)");
  await hb.getProcessVariables(processInstanceId);

  // ── 17. Verify process completed ───────────────────────────
  step("17. Verify process instance status");
  const finalInstance = await hb.getProcessInstance(processInstanceId);
  ok(`Status: ${finalInstance.status}`);

  console.log(`\n${"═".repeat(115)}`);
  console.log("  Done — variable shadowing test complete");
  console.log(`${"═".repeat(115)}\n`);
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
