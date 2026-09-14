import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import express from "express";
import { createServer } from "node:http";
import { addCivilDays, civilDateInZone } from "../shared/timezone";
import { DEFAULT_ADVANCED_TRAINER_SETTINGS } from "../shared/schema";
import { buildGuidedSessionPlan } from "../shared/guided-workout";

function savedPlan(cycleId: number, exerciseId = 1, weekNumber = 1) {
  return JSON.stringify(buildGuidedSessionPlan({ workoutTemplateId: null, workoutName: "Push A", timeBudgetMinutes: null,
    advancedTrainer: { cycleId, weekNumber, totalWeeks: 5, phase: "accumulation", targetRir: 3, deloadLoadPercent: null, volumeSummary: [] },
    exercises: [{ exerciseId, exerciseName: "Bench", exerciseOrder: 1, exerciseRole: "Primary Compound", trackingMode: "reps",
      equipment: "Barbell", isCompound: true, primaryMuscleGroupId: 1, warmupSets: 0, workingSets: 2, templateWorkingSets: 2,
      targetWeight: 100, targetRepsMin: 8, targetRepsMax: 12, targetDurationMinSeconds: null, targetDurationMaxSeconds: null,
      targetRirMin: 3, targetRirMax: 4, restSeconds: 120, recommendation: "Maintain", recommendationReason: "Test",
      recoveryPercent: 100, fatiguePercent: 0 }],
  }));
}

test("v4.1 preserves used legacy cycles, retires only unused auto starts, and safely corrects starts", async () => {
  process.env.DATABASE_PATH = join(tmpdir(), `forge-advanced-${process.pid}-${Date.now()}.db`);
  const legacy = new Database(process.env.DATABASE_PATH);
  legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color_accent TEXT,
    training_level TEXT NOT NULL DEFAULT 'beginner');
    INSERT INTO users (name) VALUES ('Unused legacy'), ('Used legacy'), ('Malformed legacy');
    CREATE TABLE advanced_trainer_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      started_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', settings_snapshot TEXT NOT NULL, completed_at TEXT, review_notes TEXT);
    CREATE TABLE workouts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), date TEXT NOT NULL,
      started_at TEXT, tz TEXT, name TEXT, notes TEXT, workout_template_id INTEGER, status TEXT NOT NULL DEFAULT 'completed',
      completed_at TEXT, logging_mode TEXT NOT NULL DEFAULT 'classic', time_budget_minutes INTEGER, planned_duration_minutes INTEGER, session_plan TEXT);`);
  const insertCycle = legacy.prepare("INSERT INTO advanced_trainer_cycles (user_id, started_on, settings_snapshot) VALUES (?, ?, ?)");
  for (const userId of [1, 2, 3]) insertCycle.run(userId, "2026-09-10", JSON.stringify(DEFAULT_ADVANCED_TRAINER_SETTINGS));
  const oldPlan = savedPlan(2);
  legacy.prepare("INSERT INTO workouts (user_id, date, started_at, logging_mode, session_plan) VALUES (2, '2026-09-14', '2026-09-14T18:00:00.000Z', 'advanced_guided', ?)").run(oldPlan);
  legacy.prepare("INSERT INTO workouts (user_id, date, started_at, logging_mode, session_plan) VALUES (3, '2026-09-14', '2026-09-14T18:00:00.000Z', 'advanced_guided', '{}')").run();
  legacy.close();
  const { storage } = await import("./storage");
  const inspection = new Database(process.env.DATABASE_PATH);
  assert.equal(await storage.getActiveAdvancedTrainerCycle(1), undefined);
  assert.equal((inspection.prepare("SELECT status FROM advanced_trainer_cycles WHERE id=1").get() as {status:string}).status, "awaiting_start");
  assert.equal((await storage.getActiveAdvancedTrainerCycle(2))?.id, 2);
  assert.equal((await storage.getActiveAdvancedTrainerCycle(3))?.id, 3);
  assert.equal((await storage.getWorkout(1))?.advancedTrainerCycleId, 2);
  assert.equal((await storage.getWorkout(1))?.sessionPlan, oldPlan);
  assert.equal((await storage.getAdvancedTrainerCycleWorkouts(2, 2)).length, 1);
  assert.deepEqual(await storage.getAdvancedTrainerCycleWorkouts(1, 2), []);
  const before = await storage.getWorkout(1);
  await assert.rejects(storage.alignAdvancedTrainerCycleStart(1, 2, 1, "2026-09-10", "2026-09-14"), /not found/);
  await assert.rejects(storage.alignAdvancedTrainerCycleStart(2, 2, 1, "2026-09-09", "2026-09-14"), /Refresh/);
  await storage.alignAdvancedTrainerCycleStart(2, 2, 1, "2026-09-10", "2026-09-14");
  assert.equal((await storage.getActiveAdvancedTrainerCycle(2))?.startedOn, "2026-09-14");
  assert.deepEqual(await storage.getWorkout(1), before);
  const changes = await storage.getAdvancedTrainerCycleDateChanges(2, 2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].previousStartedOn, "2026-09-10");
  await storage.undoAdvancedTrainerCycleStart(2, 2, changes[0].id, "2026-09-14", "2026-09-14");
  assert.equal((await storage.getActiveAdvancedTrainerCycle(2))?.startedOn, "2026-09-10");
  assert.equal((await storage.getAdvancedTrainerCycleDateChanges(2, 2))[0].undoOfChangeId, changes[0].id);
  await assert.rejects(storage.undoAdvancedTrainerCycleStart(2, 2, changes[0].id, "2026-09-10", "2026-09-14"), /already undone/);

  // Reads never create cycles. Explicit starts are idempotent and keep their snapshot.
  const user = await storage.createUser({ name: "Explicit", passwordHash: "test:test" });
  for (let i = 0; i < 3; i++) assert.equal(await storage.getActiveAdvancedTrainerCycle(user.id), undefined);
  const cycle = await storage.createAdvancedTrainerCycle(user.id, "2026-09-10", DEFAULT_ADVANCED_TRAINER_SETTINGS);
  assert.equal(cycle.startSource, "explicit");
  assert.equal((await storage.createAdvancedTrainerCycle(user.id, "2026-09-14", DEFAULT_ADVANCED_TRAINER_SETTINGS)).id, cycle.id);
  await storage.setAdvancedTrainerSettings(user.id, { ...DEFAULT_ADVANCED_TRAINER_SETTINGS, accumulationWeeks: 6 });
  assert.equal(JSON.parse((await storage.getActiveAdvancedTrainerCycle(user.id))!.settingsSnapshot).accumulationWeeks, 4);
  const bench = (await storage.getExercises()).find((exercise) => exercise.name === "Barbell Bench Press")!;
  const plan = savedPlan(cycle.id, bench.id);
  const first = await storage.createWorkout({ userId: user.id, date: "2026-09-14", name: "Push A", loggingMode: "advanced_guided",
    advancedTrainerCycleId: cycle.id, sessionPlan: plan, status: "in_progress" });
  await storage.createSet({ workoutId: first.id, exerciseId: bench.id, setNumber: 1, weight: 100, reps: 10, rir: 3, isWarmup: false });
  await assert.rejects(storage.alignAdvancedTrainerCycleStart(user.id, cycle.id, first.id, "2026-09-10", "2026-09-14"), /completed/);
  await storage.completeWorkout(first.id, "2026-09-14T19:00:00.000Z");
  const snapshot = await storage.getWorkoutWithSets(first.id);
  await storage.alignAdvancedTrainerCycleStart(user.id, cycle.id, first.id, "2026-09-10", "2026-09-14");
  assert.deepEqual(await storage.getWorkoutWithSets(first.id), snapshot);
  assert.equal((await storage.getAdvancedTrainerCycleWorkouts(user.id, cycle.id))[0].workingSets, 1);
  const correction = (await storage.getAdvancedTrainerCycleDateChanges(user.id, cycle.id))[0];
  const second = await storage.createWorkout({ userId: user.id, date: "2026-09-18", name: "Pull A", loggingMode: "advanced_guided",
    advancedTrainerCycleId: cycle.id, sessionPlan: plan, status: "in_progress" });
  await assert.rejects(storage.undoAdvancedTrainerCycleStart(user.id, cycle.id, correction.id, "2026-09-14", "2026-09-18"), /active workout/);
  await storage.completeWorkout(second.id, "2026-09-18T19:00:00.000Z");
  await assert.rejects(storage.undoAdvancedTrainerCycleStart(user.id, cycle.id, correction.id, "2026-09-14", "2026-09-18"), /conflict/);
  await assert.rejects(storage.alignAdvancedTrainerCycleStart(user.id, cycle.id, first.id, "2026-09-14", "2026-09-18"), /exactly one/);
  assert.equal((await storage.getActiveAdvancedTrainerCycle(user.id))?.startedOn, "2026-09-14");
  assert.equal((await storage.getAdvancedTrainerCycleDateChanges(user.id, cycle.id)).length, 1);
  await assert.rejects(storage.createWorkout({ userId: 1, date: "2026-09-14", loggingMode: "advanced_guided", advancedTrainerCycleId: cycle.id, sessionPlan: plan }), /owned active/);
  await assert.rejects(storage.createWorkout({ userId: user.id, date: "2026-09-21", loggingMode: "advanced_guided", advancedTrainerCycleId: cycle.id, sessionPlan: plan }), /conflict/);

  // Exercise the actual authenticated HTTP contract used by the new UI.
  const { configureAuth, issueTokenFor } = await import("./auth");
  const { registerRoutes } = await import("./routes");
  const app = express();
  app.use(express.json());
  configureAuth(app);
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const apiUser = await storage.createUser({ name: "HTTP trainer", passwordHash: "test:test" });
    const token = issueTokenFor(apiUser);
    const request = (path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Client-Timezone": "UTC" },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal((await fetch(`${base}/api/advanced-trainer/state`)).status, 401);
    for (let i = 0; i < 2; i++) {
      const awaiting = await (await request("/api/advanced-trainer/state")).json();
      assert.equal(awaiting.state, null);
      assert.equal(await storage.getActiveAdvancedTrainerCycle(apiUser.id), undefined);
    }
    const today = civilDateInZone(new Date(), "UTC");
    // Earlier manual Push A entries are history, not mesocycle membership.
    const manual = await storage.createWorkout({ userId: apiUser.id, date: addCivilDays(today, -1), name: "Push A", loggingMode: "classic" });
    assert.equal(manual.advancedTrainerCycleId, null);
    // Simulate a preserved v4 auto-start, four days before the first workout.
    const apiCycle = await storage.createAdvancedTrainerCycle(apiUser.id, addCivilDays(today, -4), DEFAULT_ADVANCED_TRAINER_SETTINGS);
    const apiPlan = JSON.parse(savedPlan(apiCycle.id, bench.id));
    const started = await request("/api/workout-sessions", "POST", { date: today, workoutTemplateId: null, name: "Push A", timeBudgetMinutes: null, sessionPlan: apiPlan });
    assert.equal(started.status, 201);
    const session = await started.json();
    assert.equal(session.advancedTrainerCycleId, apiCycle.id);
    const invalidPatch = await request(`/api/workout-sessions/${session.id}/plan`, "PATCH", { sessionPlan: { ...apiPlan, advancedTrainer: { ...apiPlan.advancedTrainer, weekNumber: 2 } } });
    assert.equal(invalidPatch.status, 409);
    assert.equal((await request("/api/sets", "POST", { workoutId: session.id, exerciseId: bench.id, setNumber: 1, weight: 100, reps: 10, rir: 3, isWarmup: false })).status, 201);
    assert.equal((await request(`/api/workout-sessions/${session.id}/complete`, "POST")).status, 200);
    const overview = await (await request("/api/advanced-trainer/state")).json();
    assert.equal(overview.workouts.length, 1);
    assert.equal(overview.workouts.some((workout: {id:number}) => workout.id === manual.id), false);
    assert.equal(overview.workouts[0].id, session.id);
    assert.equal(overview.workouts[0].workingSets, 1);
    assert.equal(overview.alignment.eligible, true);
    const aligned = await request(`/api/advanced-trainer/cycles/${apiCycle.id}/align-start`, "POST", { workoutId: session.id, expectedStartedOn: apiCycle.startedOn });
    assert.equal(aligned.status, 200);
    const updated = await aligned.json();
    assert.equal(updated.state.startedOn, today);
    assert.equal(updated.undo.eligible, true);
    const history = await (await request("/api/workouts")).json();
    assert.equal(history[0].advancedTrainer.cycleId, apiCycle.id);
    assert.equal(history.find((workout: {id:number}) => workout.id === manual.id).advancedTrainer, null);
    assert.equal((await request(`/api/workouts/${session.id}`)).status, 200);
    assert.equal((await request("/api/sets", "POST", { workoutId: session.id, exerciseId: bench.id, setNumber: 2, weight: 100, reps: 10, isWarmup: false })).status, 409);
    assert.equal((await request(`/api/advanced-trainer/cycles/${apiCycle.id}/undo-start`, "POST", { changeId: updated.undo.changeId, expectedStartedOn: today })).status, 200);
    assert.equal((await request(`/api/advanced-trainer/cycles/${apiCycle.id}/review`, "POST", { settings: DEFAULT_ADVANCED_TRAINER_SETTINGS })).status, 409);
    inspection.prepare("UPDATE advanced_trainer_cycles SET started_on = ? WHERE id = ?").run(addCivilDays(today, -35), apiCycle.id);
    assert.equal((await request(`/api/advanced-trainer/cycles/${apiCycle.id}/review`, "POST", { settings: DEFAULT_ADVANCED_TRAINER_SETTINGS, startNextCycle: false })).status, 200);
    assert.equal((await (await request("/api/advanced-trainer/state")).json()).state, null);
    const explicit = await request("/api/advanced-trainer/cycles", "POST");
    assert.equal(explicit.status, 201);
    assert.equal((await explicit.json()).state.startedOn, today);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  inspection.close();
});
