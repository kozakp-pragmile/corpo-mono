import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "./hummingbird-client.js";
import { step, ok, fail } from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BPMN_DIR = resolve(__dirname, "..", "bpmn");

const BASE_URL = process.env.HUMMINGBIRD_URL || "http://localhost:8095/hummingbird";
const PROCESS_KEY = "simple_user_task";
const USER_ID = "test-user";

const hb = createClient(BASE_URL);

async function run() {
  console.log(`\nHummingbird API: ${BASE_URL}\n`);

  // ── 1. Deploy BPMN ───────────────────────────────────────
  step("Deploy simple-user-task.bpmn");
  const deployment = await hb.deploy(resolve(BPMN_DIR, "simple-user-task.bpmn"));
  ok(`Deployed: ${deployment.id}`);

  // ── 2. Look up the process definition ────────────────────
  step("Get process definition by key");
  const pd = await hb.getProcessDefinitionByKey(PROCESS_KEY);
  ok(`Found: ${pd.id} (key=${pd.key})`);

  // ── 3. Start process instance with variables ─────────────
  step("Start process instance");
  const instance = await hb.startProcessByKey(PROCESS_KEY, {
    businessKey: `test-${Date.now()}`,
    processVariables: {
      requester: "alice",
      priority: 3,
      approved: false,
    },
    userId: USER_ID,
  });
  const processInstanceId = instance.processInstanceId;
  ok(`Started: ${processInstanceId}`);

  // ── 4. Read process variables ────────────────────────────
  step("Get process variables");
  await hb.getProcessVariables(processInstanceId);

  // ── 5. Update process variables ──────────────────────────
  step("Set additional process variables");
  await hb.setProcessVariables(processInstanceId, {
    reviewer: "bob",
    priority: 5,
  });
  ok("Variables updated");

  step("Get process variables after update");
  await hb.getProcessVariables(processInstanceId);

  // ── 6. Find the active user task ─────────────────────────
  step("Find active tasks for the process instance");
  const tasks = await hb.getTasks({ processInstanceId, active: true });

  if (!tasks.length) {
    fail("No active tasks found — stopping");
    return;
  }

  const task = tasks[0];
  ok(`Active task: ${task.id} (name=${task.name})`);

  // ── 7. Get task variables ────────────────────────────────
  step("Get task variables (merged view)");
  await hb.getTaskVariables(task.id);

  // ── 8. Set local variables on the task ───────────────────
  step("Set local variables on the task");
  await hb.setTaskLocalVariables(task.id, { comment: "Looks good to me" });
  ok("Local variables set");

  step("Get task local variables");
  await hb.getTaskLocalVariables(task.id);

  // ── 9. Assign and complete the user task ──────────────────
  step("Assign the task");
  await hb.setTaskAssignee(task.id, USER_ID);
  ok(`Assigned to ${USER_ID}`);

  step("Complete the user task");
  await hb.completeTask(task.id, {
    userId: USER_ID,
    processVariables: { approved: true },
  });
  ok("Task completed");

  // ── 10. Verify process completed ─────────────────────────
  step("Check process instance status");
  const finalInstance = await hb.getProcessInstance(processInstanceId);
  ok(`Status: ${finalInstance.status}`);

  console.log(`\n${"═".repeat(115)}`);
  console.log("  Done — full lifecycle exercised successfully");
  console.log(`${"═".repeat(115)}\n`);
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
