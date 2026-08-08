import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeVolume,
  computeWeeklyVolumeByMuscleGroup,
  evaluateRecovery,
  type HistorySessionInput,
  type MuscleGroupLookup,
} from "./coaching";
import { primaryStimulusMuscle } from "./schema";

test("weighted volume counts stimulus ratios for working sets", () => {
  const stimulus = [
    { muscleGroupId: 1, stimulusRatio: 1 },
    { muscleGroupId: 2, stimulusRatio: 0.4 },
    { muscleGroupId: 3, stimulusRatio: 0.35 },
  ];
  const volume = computeWeeklyVolumeByMuscleGroup(
    Array.from({ length: 3 }, () => ({ exerciseId: 10, stimulus, isWarmup: false })),
  );
  assert.equal(volume.get(1), 3);
  assert.ok(Math.abs((volume.get(2) ?? 0) - 1.2) < 1e-10);
  assert.ok(Math.abs((volume.get(3) ?? 0) - 1.05) < 1e-10);
});

test("warmup sets contribute zero effective volume", () => {
  const stimulus = [{ muscleGroupId: 1, stimulusRatio: 1 }];
  const volume = computeWeeklyVolumeByMuscleGroup([
    ...Array.from({ length: 3 }, () => ({ exerciseId: 10, stimulus, isWarmup: true })),
    ...Array.from({ length: 3 }, () => ({ exerciseId: 10, stimulus, isWarmup: false })),
  ]);
  assert.equal(volume.get(1), 3);
});

test("volume categorization uses unrounded effective sets", () => {
  assert.equal(categorizeVolume(5.9, { mev: 6, mav: 12, mrv: 18 }), "under");
});

test("primary stimulus is highest ratio with deterministic muscle-id tie breaking", () => {
  assert.deepEqual(
    primaryStimulusMuscle([
      { muscleGroupId: 7, stimulusRatio: 0.4 },
      { muscleGroupId: 3, stimulusRatio: 1 },
      { muscleGroupId: 2, stimulusRatio: 1 },
    ]),
    { muscleGroupId: 2, stimulusRatio: 1 },
  );
});

test("recovery distributes fatigue by stimulus without related-muscle propagation", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const lookup: MuscleGroupLookup = {
    idToName: new Map([
      [1, "Lats"],
      [2, "Biceps"],
      [3, "UpperMidBack"],
    ]),
  };
  const history: HistorySessionInput[] = [
    {
      id: 1,
      workoutTemplateId: null,
      workoutName: "Pull",
      startedAt: now,
      exercises: [
        {
          exerciseId: 1,
          exerciseOrder: 1,
          exerciseName: "Pulldown",
          primaryMuscleGroupId: 1,
          stimulus: [
            { muscleGroupId: 1, stimulusRatio: 1 },
            { muscleGroupId: 2, stimulusRatio: 0.4 },
          ],
          intensityTechnique: "Normal",
          failureTarget: "Never",
          sets: [
            { setNumber: 1, setType: "Working", weight: 100, reps: 10, rir: 2, completed: true },
          ],
        },
      ],
    },
  ];
  const states = evaluateRecovery(history, lookup, now);
  const lats = states.find((state) => state.muscle === "Lats")!;
  const biceps = states.find((state) => state.muscle === "Biceps")!;
  const upperBack = states.find((state) => state.muscle === "UpperMidBack")!;
  assert.ok(lats.fatiguePercent > biceps.fatiguePercent);
  assert.ok(biceps.fatiguePercent > 0);
  assert.equal(upperBack.fatiguePercent, 0);
});
