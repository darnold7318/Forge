import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

test("default stimulus, complete user overrides, and reset are isolated per user", async () => {
  process.env.DATABASE_PATH = join(tmpdir(), `forge-stimulus-${process.pid}-${Date.now()}.db`);
  const legacy = new Database(process.env.DATABASE_PATH);
  legacy.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color_accent TEXT,
      training_level TEXT NOT NULL DEFAULT 'beginner'
    );
    INSERT INTO users (name, color_accent, training_level) VALUES ('Existing 1', 'chart-1', 'beginner');
    INSERT INTO users (name, color_accent, training_level) VALUES ('Existing 2', 'chart-2', 'advanced');
  `);
  legacy.close();
  const { storage } = await import("./storage");

  const migrated = new Database(process.env.DATABASE_PATH);
  const columns = (table: string) => new Set(
    (migrated.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name),
  );
  assert.ok(columns("exercises").has("tracking_mode"));
  assert.ok(columns("workout_template_exercises").has("target_duration_min_seconds"));
  assert.ok(columns("workout_template_exercises").has("target_duration_max_seconds"));
  assert.ok(columns("sets").has("duration_seconds"));
  assert.ok(columns("users").has("training_goal"));
  assert.ok(columns("user_coach_settings").has("progression_style"));
  assert.ok(columns("user_muscle_coach_overrides").has("recovery_half_life_hours"));
  assert.ok(columns("user_exercise_coach_overrides").has("fatigue_cost"));
  assert.ok(columns("workout_exercise_snapshots").has("target_rir"));
  migrated.close();

  const users = await storage.getUsers();
  assert.equal(users[0].trainingLevel, "beginner");
  assert.equal(users[1].trainingLevel, "advanced");
  assert.equal(users[0].trainingGoal, "hypertrophy");
  const newUser = await storage.createUser({ name: "New user", passwordHash: "test:test" });
  assert.equal(newUser.trainingLevel, "intermediate");
  assert.equal(newUser.trainingGoal, "hypertrophy");
  const updatedUser = await storage.updateUserPreferences(newUser.id, { trainingLevel: "intermediate" });
  assert.equal(updatedUser?.trainingLevel, "intermediate");
  assert.deepEqual(await storage.getRecoverySettings(newUser.id), {
    fatigueSensitivity: 1,
    overallRecoverySpeed: 1,
    muscleRecoverySpeeds: {},
  });
  const customizedRecovery = {
    fatigueSensitivity: 1.15,
    overallRecoverySpeed: 0.9,
    muscleRecoverySpeeds: { SpinalErectors: 0.8 },
  };
  await storage.setRecoverySettings(newUser.id, customizedRecovery);
  assert.deepEqual(await storage.getRecoverySettings(newUser.id), customizedRecovery);
  const coachSettings = await storage.getCoachSettings(newUser.id);
  assert.equal(coachSettings.progressionStyle, "automatic");
  await storage.setCoachSettings(newUser.id, { ...coachSettings, progressionStyle: "rep_first", trendHistoryLimit: 6 });
  assert.equal((await storage.getCoachSettings(newUser.id)).progressionStyle, "rep_first");
  const bench = (await storage.getExercises()).find((exercise) => exercise.name === "Barbell Bench Press");
  assert.ok(bench);
  const template = await storage.createWorkoutTemplate({ userId: newUser.id, name: "Snapshot Test", notes: null });
  await storage.createWorkoutTemplateExercise({
    workoutTemplateId: template.id,
    exerciseId: bench.id,
    exerciseOrder: 1,
    exerciseRole: "Primary Compound",
    warmupSets: 1,
    topSets: 0,
    backoffSets: 0,
    backoffReductionPercent: 0,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetDurationMinSeconds: null,
    targetDurationMaxSeconds: null,
    tempo: null,
    targetRir: 2,
    failureTarget: "Last Set",
    intensityTechnique: "Rest Pause",
    restSeconds: 120,
    notes: null,
  });
  const workout = await storage.createWorkout({ userId: newUser.id, date: "2026-08-14", name: "Snapshot Test", workoutTemplateId: template.id });
  const snapshot = (await storage.getWorkoutExerciseSnapshots(newUser.id)).find((row) => row.workoutId === workout.id && row.exerciseId === bench.id);
  assert.equal(snapshot?.failureTarget, "Last Set");
  assert.equal(snapshot?.intensityTechnique, "Rest Pause");

  const defaults = await storage.getEffectiveExerciseStimulus(users[0].id, bench.id);
  assert.equal(defaults.length, 4);

  const custom = [
    { muscleGroupId: defaults[0].muscleGroupId, stimulusRatio: 0.8 },
    { muscleGroupId: defaults[1].muscleGroupId, stimulusRatio: 0.5 },
  ];
  await storage.replaceExerciseStimulusOverride(users[0].id, bench.id, custom);
  assert.deepEqual(await storage.getEffectiveExerciseStimulus(users[0].id, bench.id), custom);
  assert.deepEqual(await storage.getEffectiveExerciseStimulus(users[1].id, bench.id), defaults);

  await storage.deleteExerciseStimulusOverride(users[0].id, bench.id);
  assert.deepEqual(await storage.getEffectiveExerciseStimulus(users[0].id, bench.id), defaults);
  assert.equal((await storage.getMuscleGroups()).length, 20);
});
