import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeVolume,
  computeWeeklyVolumeByMuscleGroup,
  checkLivePersonalRecord,
  evaluateFatigueTrend,
  evaluateRecovery,
  evaluateExerciseTrend,
  evaluateGoalAwareProgression,
  analyzeWorkoutComposition,
  getPreviousExercisePerformance,
  resolveGoalCoachingProfile,
  getPersonalRecords,
  type HistorySessionInput,
  type MuscleGroupLookup,
} from "./coaching";
import { primaryStimulusMuscle } from "./schema";
import { DEFAULT_COACH_SETTINGS } from "./schema";

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

function exposureHistory(reps: number[][], rir: number = 2): HistorySessionInput[] {
  return reps.map((setReps, index) => ({
    id: index + 1,
    workoutTemplateId: 1,
    workoutName: "Upper",
    startedAt: new Date(`2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`),
    exercises: [{
      exerciseId: 10,
      exerciseOrder: 1,
      exerciseName: "Incline Press",
      trackingMode: "reps" as const,
      primaryMuscleGroupId: 1,
      intensityTechnique: "Normal",
      failureTarget: "Never",
      sets: setReps.map((repsValue, setIndex) => ({
        setNumber: setIndex + 1,
        setType: "Working" as const,
        weight: 75,
        reps: repsValue,
        rir,
        completed: true,
      })),
    }],
  })).reverse();
}

test("hypertrophy recognizes multi-exposure rep progress before every set reaches the ceiling", () => {
  const history = exposureHistory([[10, 9, 8], [11, 10, 9], [11, 11, 10]]);
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", DEFAULT_COACH_SETTINGS);
  assert.equal(trend.status, "Improving");
  const previous = getPreviousExercisePerformance(history, 10, "Incline Press");
  const recovery = evaluateRecovery(history, { idToName: new Map([[1, "UpperChest"]]) }, new Date("2026-07-10T12:00:00.000Z"))
    .find((state) => state.muscle === "UpperChest")!;
  const progression = evaluateGoalAwareProgression({
    goal: "hypertrophy",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous,
    trend,
    settings: DEFAULT_COACH_SETTINGS,
    recovery,
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    volumeContext: { muscleGroupId: 1, muscleName: "Upper Chest", currentEffectiveSets: 10.5, mev: 6, mav: 12, mrv: 18, status: "optimal" },
  });
  assert.equal(progression.recommendation, "Add Reps");
  assert.equal(progression.setRecommendation, "Maintain Sets");
});

test("repeated RIR zero prevents blind hypertrophy load progression", () => {
  const history = exposureHistory([[12, 12, 12], [12, 12, 12], [12, 12, 12]], 0);
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", DEFAULT_COACH_SETTINGS);
  const previous = getPreviousExercisePerformance(history, 10, "Incline Press");
  const progression = evaluateGoalAwareProgression({
    goal: "hypertrophy",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous,
    trend,
    settings: DEFAULT_COACH_SETTINGS,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 20, recoveryPercent: 80, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
  });
  assert.notEqual(progression.recommendation, "Increase Weight");
});

test("per-muscle half-life override changes only the supplied recovery model", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const history = exposureHistory([[10, 10, 10]]);
  history[0].startedAt = new Date("2026-08-06T12:00:00.000Z");
  const lookup: MuscleGroupLookup = { idToName: new Map([[1, "Lats"]]) };
  const standard = evaluateRecovery(history, lookup, now).find((state) => state.muscle === "Lats")!.fatiguePercent;
  const slower = evaluateRecovery(history, lookup, now, undefined, { muscleHalfLifeHours: { Lats: 60 } })
    .find((state) => state.muscle === "Lats")!.fatiguePercent;
  assert.ok(slower > standard);
});

test("compound warnings are goal-aware", () => {
  const rows = [{ targetSets: 3, restSeconds: 60, isCompound: false, exerciseRole: "Isolation", failureTarget: "Never", primaryMuscleName: "Side Delts" }];
  assert.doesNotMatch(analyzeWorkoutComposition(rows, "hypertrophy").warnings, /compound/i);
  assert.match(analyzeWorkoutComposition(rows, "strength").warnings, /compound/i);
});

test("goal profiles keep experience-independent coaching priorities distinct", () => {
  assert.equal(resolveGoalCoachingProfile("hypertrophy").usesHypertrophyVolume, true);
  assert.equal(resolveGoalCoachingProfile("strength").progressionPriority, "load");
  assert.equal(resolveGoalCoachingProfile("muscular_endurance").progressionPriority, "reps");
  assert.equal(resolveGoalCoachingProfile("mobility").progressionPriority, "duration");
  assert.equal(resolveGoalCoachingProfile("general_fitness").progressionPriority, "balanced");
});

test("muscular endurance keeps load and adds reps while its trend improves", () => {
  const history = exposureHistory([[12, 12, 12], [13, 13, 12], [14, 13, 13]]);
  const trend = evaluateExerciseTrend(history, 10, "muscular_endurance", "reps", DEFAULT_COACH_SETTINGS);
  const previous = getPreviousExercisePerformance(history, 10, "Incline Press");
  const result = evaluateGoalAwareProgression({
    goal: "muscular_endurance",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 10, targetRepsMax: 12, targetRir: 2 },
    previous,
    trend,
    settings: DEFAULT_COACH_SETTINGS,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 10, recoveryPercent: 90, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
  });
  assert.equal(result.recommendation, "Add Reps");
});
