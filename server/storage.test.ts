import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("default stimulus, complete user overrides, and reset are isolated per user", async () => {
  process.env.DATABASE_PATH = join(tmpdir(), `forge-stimulus-${process.pid}-${Date.now()}.db`);
  const { storage } = await import("./storage");

  const users = await storage.getUsers();
  const bench = (await storage.getExercises()).find((exercise) => exercise.name === "Barbell Bench Press");
  assert.ok(bench);

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
