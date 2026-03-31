import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createClient } from "./hummingbird-client.js";
import { step, ok, fail } from "./log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BPMN_DIR = resolve(__dirname, "..", "bpmn");

const BASE_URL = process.env.HUMMINGBIRD_URL || "http://localhost:8095/hummingbird";
const PROCESS_KEY = "Process_00dx0fb";
const USER_ID = "test-user";

const TASK_INCLUDES = ["processVariables", "localVariables", "processInstance", "processDefinition", "userTaskDefinition"];

const hb = createClient(BASE_URL);

async function run() {
  console.log(`\nHummingbird API: ${BASE_URL}`);
  console.log("Scenario: parallel user tasks — variable behavior across execution contexts\n");

  // ── Setup: Deploy BPMN ─────────────────────────────────────
  step("Deploy parallel-user-tasks.bpmn");
  const deployment = await hb.deploy(resolve(BPMN_DIR, "parallel-user-tasks.bpmn"));
  ok(`Deployed: ${deployment.id}`);

  // ── 1. Start process with variables ────────────────────────
  step("1. Start process instance with variables");
  const instance = await hb.startProcessByKey(PROCESS_KEY, {
    businessKey: `parallel-${Date.now()}`,
    processVariables: {
      status: "pending",
      priority: 3,
      sharedCounter: 0,
      notes: "initial notes from process start",
    },
    userId: USER_ID,
  });
  const processInstanceId = instance.processInstanceId;
  ok(`Started: ${processInstanceId}`);

  // ── 2. Check initial process variables ─────────────────────
  step("2. Check process variables (initial)");
  await hb.getProcessVariables(processInstanceId);

  // ── 3. Find both parallel tasks ────────────────────────────
  step("3. Find active user task instances (expect 2 parallel tasks)");
  const tasks = await hb.getTasks({ processInstanceId, active: true });
  if (tasks.length < 2) {
    fail(`Expected 2 parallel tasks, found ${tasks.length} — stopping`);
    return;
  }
  const task1 = tasks.find(t => t.name === "Parallel User Task 1") ?? tasks[0];
  const task2 = tasks.find(t => t.name === "Parallel User Task 2") ?? tasks[1];
  ok(`Task 1: ${task1.id} (name=${task1.name})`);
  ok(`Task 2: ${task2.id} (name=${task2.name})`);

  // ── 4. Check both task instances before any changes ────────
  step("4. Check Task 1 (before changes)");
  await hb.getTask(task1.id, { include: TASK_INCLUDES });

  step("5. Check Task 2 (before changes)");
  await hb.getTask(task2.id, { include: TASK_INCLUDES });

  // ── 6. Set local variables on Task 1 ────────────────────────
  step("6. Set local variables on Task 1 (same names as process vars)");
  await hb.setTaskLocalVariables(task1.id, {
    status: "LOCAL-task1",
    priority: 111,
    notes: "local notes from task 1",
    localOnlyTask1: "only on task 1 local scope",
  });
  ok("Local variables set on Task 1");

  // ── 7. Set local variables on Task 2 ──────────────────────
  step("7. Set local variables on Task 2 (same names as process vars AND Task 1 locals)");
  await hb.setTaskLocalVariables(task2.id, {
    status: "LOCAL-task2",
    priority: 222,
    notes: "local notes from task 2",
    localOnlyTask2: "only on task 2 local scope",
  });
  ok("Local variables set on Task 2");

  // ── 8. Check both tasks after local variables set ──────────
  step("8. Check Task 1 (after local variables set)");
  await hb.getTask(task1.id, { include: TASK_INCLUDES });

  step("9. Check Task 2 (after local variables set)");
  await hb.getTask(task2.id, { include: TASK_INCLUDES });

  // ── 10. Set process variables via Task 1 ───────────────────
  step("10. Set process variables via Task 1");
  await hb.setTaskProcessVariables(task1.id, {
    status: "task1-in-progress",
    priority: 10,
    sharedCounter: 1,
    task1Only: "set by task 1",
  });
  ok("Process variables set via Task 1");

  // ── 11. Check process variables — does Task 1's write show?
  step("11. Check process variables (after Task 1 write)");
  await hb.getProcessVariables(processInstanceId);

  // ── 12. Check Task 2 — does it see Task 1's process var changes?
  step("12. Check Task 2 (does it see Task 1's process variable changes?)");
  await hb.getTask(task2.id, { include: TASK_INCLUDES });

  // ── 13. Set process variables via Task 2 ───────────────────
  step("13. Set process variables via Task 2 (overwrite same names)");
  await hb.setTaskProcessVariables(task2.id, {
    status: "task2-in-progress",
    priority: 20,
    sharedCounter: 2,
    task2Only: "set by task 2",
  });
  ok("Process variables set via Task 2 — same names as Task 1");

  // ── 14. Check process variables — Task 2 overwrote Task 1?
  step("14. Check process variables (after Task 2 write — who won?)");
  await hb.getProcessVariables(processInstanceId);

  // ── 15. Check Task 1 — does it see Task 2's process var changes?
  step("15. Check Task 1 (after Task 2 changed process variables)");
  await hb.getTask(task1.id, { include: TASK_INCLUDES });

  // ── 16. Check v1 merged views — local shadows process? ────
  step("16. Check Task 1 variables via v1 (merged view)");
  await hb.getTaskVariables(task1.id);

  step("17. Check Task 2 variables via v1 (merged view)");
  await hb.getTaskVariables(task2.id);

  // ── 18. Complete Task 1 with overlapping names ─────────────
  step("18. Assign and complete Task 1 with overlapping variable names");
  await hb.setTaskAssignee(task1.id, USER_ID);
  await hb.completeTask(task1.id, {
    userId: USER_ID,
    processVariables: {
      status: "task1-completed",
      sharedCounter: 10,
    },
    localVariables: {
      status: "LOCAL-task1-completed",
      completionNote: "Task 1 done",
    },
  });
  ok("Task 1 completed");

  // ── 19. Check state after Task 1 completion ────────────────
  step("19. Check process variables (after Task 1 completed, Task 2 still active)");
  await hb.getProcessVariables(processInstanceId);

  step("20. Check Task 2 (does it see Task 1's completion variables?)");
  await hb.getTask(task2.id, { include: TASK_INCLUDES });

  step("21. Check completed Task 1 (v2)");
  await hb.getTask(task1.id, { include: TASK_INCLUDES });

  // ── 22. Complete Task 2 with overlapping names ─────────────
  step("22. Assign and complete Task 2 with overlapping variable names");
  await hb.setTaskAssignee(task2.id, USER_ID);
  await hb.completeTask(task2.id, {
    userId: USER_ID,
    processVariables: {
      status: "task2-completed",
      sharedCounter: 20,
    },
    localVariables: {
      status: "LOCAL-task2-completed",
      completionNote: "Task 2 done",
    },
  });
  ok("Task 2 completed");

  // ── 23. Final state ────────────────────────────────────────
  step("23. Check process variables (final — which task's values won?)");
  await hb.getProcessVariables(processInstanceId);

  step("24. Check completed Task 1 (v2 — final)");
  await hb.getTask(task1.id, { include: TASK_INCLUDES });

  step("25. Check completed Task 2 (v2 — final)");
  await hb.getTask(task2.id, { include: TASK_INCLUDES });

  step("26. Verify process instance status");
  const finalInstance = await hb.getProcessInstance(processInstanceId);
  ok(`Status: ${finalInstance.status}`);

  console.log(`\n${"═".repeat(115)}`);
  console.log("  Done — parallel execution context variable test complete");
  console.log(`${"═".repeat(115)}\n`);
}

run().catch((err) => {
  fail(err.message);
  process.exit(1);
});
