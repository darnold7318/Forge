import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeVolume,
  computeWeeklyVolumeByMuscleGroup,
  checkLivePersonalRecord,
  evaluateFatigueTrend,
  evaluateRecovery,
  getPersonalRecords,
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

test("recovery customization changes fatigue sensitivity and decay speed independently", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const history: HistorySessionInput[] = [{
    id: 1,
    workoutTemplateId: null,
    workoutName: "Pull",
    startedAt: new Date("2026-08-06T12:00:00.000Z"),
    exercises: [{
      exerciseId: 1,
      exerciseOrder: 1,
      exerciseName: "Pulldown",
      primaryMuscleGroupId: 1,
      stimulus: [{ muscleGroupId: 1, stimulusRatio: 1 }],
      intensityTechnique: "Normal",
      failureTarget: "Never",
      sets: [
        { setNumber: 1, setType: "Working", weight: 100, reps: 10, rir: 2, completed: true },
        { setNumber: 2, setType: "Working", weight: 100, reps: 10, rir: 2, completed: true },
      ],
    }],
  }];
  const lookup: MuscleGroupLookup = { idToName: new Map([[1, "Lats"]]) };
  const fatigue = (settings: Parameters<typeof evaluateRecovery>[3]) =>
    evaluateRecovery(history, lookup, now, settings).find((state) => state.muscle === "Lats")!.fatiguePercent;

  const standard = fatigue({ fatigueSensitivity: 1, overallRecoverySpeed: 1, muscleRecoverySpeeds: {} });
  const faster = fatigue({ fatigueSensitivity: 1, overallRecoverySpeed: 1.25, muscleRecoverySpeeds: {} });
  const moreSensitive = fatigue({ fatigueSensitivity: 1.25, overallRecoverySpeed: 1, muscleRecoverySpeeds: {} });
  const slowerLats = fatigue({ fatigueSensitivity: 1, overallRecoverySpeed: 1, muscleRecoverySpeeds: { Lats: 0.75 } });

  assert.ok(faster < standard);
  assert.ok(moreSensitive > standard);
  assert.ok(slowerLats > standard);
});

test("static holds count as completed working sets for recovery", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const history: HistorySessionInput[] = [{
    id: 1,
    workoutTemplateId: null,
    workoutName: "Holds",
    startedAt: now,
    exercises: [{
      exerciseId: 99,
      exerciseOrder: 1,
      exerciseName: "Wall Sit",
      trackingMode: "duration",
      primaryMuscleGroupId: 1,
      intensityTechnique: "Normal",
      failureTarget: "Never",
      sets: [{ setNumber: 1, setType: "Working", weight: 0, reps: 0, durationSeconds: 45, rir: 2, completed: true }],
    }],
  }];
  const states = evaluateRecovery(history, { idToName: new Map([[1, "Quads"]]) }, now);
  assert.ok(states.find((state) => state.muscle === "Quads")!.fatiguePercent > 0);
});

test("static holds use longest-duration PRs and do not trigger rep fatigue decline", () => {
  assert.deepEqual(
    checkLivePersonalRecord(
      { weight: 0, reps: 0, durationSeconds: 45, trackingMode: "duration", isWarmup: false },
      [{ weight: 0, reps: 0, durationSeconds: 30, trackingMode: "duration", isWarmup: false }],
    ),
    { isPr: true, recordType: "Longest Hold", displayValue: "45 sec", previousBest: "30 sec" },
  );

  const history: HistorySessionInput[] = [60, 45, 30].map((duration, index) => ({
    id: index + 1,
    workoutTemplateId: null,
    workoutName: "Holds",
    startedAt: new Date(`2026-08-0${index + 1}T12:00:00.000Z`),
    exercises: [{
      exerciseId: 99,
      exerciseOrder: 1,
      exerciseName: "Wall Sit",
      trackingMode: "duration",
      primaryMuscleGroupId: 1,
      intensityTechnique: "Normal",
      failureTarget: "Never",
      sets: [{ setNumber: 1, setType: "Working" as const, weight: 0, reps: 0, durationSeconds: duration, rir: 2, completed: true }],
    }],
  }));
  assert.equal(evaluateFatigueTrend(history).status, "Stable");
  const prHistory = history.map((session, index) => ({
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, durationSeconds: [30, 45, 60][index] })),
    })),
  }));
  assert.equal(getPersonalRecords(prHistory, 10)[0]?.recordType, "Longest Hold");
});
