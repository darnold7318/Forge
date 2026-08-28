import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeVolume,
  computeWeeklyVolumeByMuscleGroup,
  checkLivePersonalRecord,
  evaluateFatigueTrend,
  evaluateRecovery,
  evaluateExerciseTrend,
  evaluateGoalAwareProgressionV2,
  buildGoalAwareWorkoutSuggestion,
  applyExperienceCoachSettings,
  identifyLimitingMuscles,
  estimateExerciseFatigue,
  learnPersonalVolumeRanges,
  analyzeWorkoutComposition,
  getDashboardSnapshot,
  getPreviousExercisePerformance,
  resolveGoalCoachingProfile,
  resolveGoalExperiencePrescription,
  resolveProgressionStyle,
  resolveWorkingSetCount,
  nextAvailableWeight,
  calculateRepProjection,
  getPersonalRecords,
  type HistorySessionInput,
  type DashboardTemplateInput,
  type MuscleGroupLookup,
  type MuscleTrainingContext,
} from "./coaching";
import { primaryStimulusMuscle, resolveEquipmentProfile } from "./schema";
import { DEFAULT_COACH_SETTINGS } from "./schema";

test("dashboard distinguishes today's logged workout from a different scheduled template", () => {
  const templates: DashboardTemplateInput[] = [
    { id: 1, name: "Push A", exercises: [] },
    { id: 2, name: "Pull A", exercises: [] },
  ];
  const history: HistorySessionInput[] = [{
    id: 101,
    workoutTemplateId: 1,
    workoutName: "Push A",
    startedAt: new Date("2026-08-25T13:19:00.000Z"),
    exercises: [],
  }];

  const snapshot = getDashboardSnapshot({
    templates,
    history,
    exerciseNameLookup: new Map(),
    exercisePrimaryMuscleLookup: new Map(),
    muscleGroupLookup: { idToName: new Map() },
    schedule: { workoutTemplateId: 2, label: "Pull A" },
    now: new Date("2026-08-25T18:00:00.000Z"),
    zone: "America/Los_Angeles",
  });

  assert.equal(snapshot.todaysWorkoutName, "Pull A");
  assert.equal(snapshot.todayScheduledWorkoutName, "Pull A");
  assert.equal(snapshot.loggedWorkoutTodayName, "Push A");
  assert.equal(snapshot.isOffScheduleWorkoutToday, true);
  assert.equal(snapshot.workoutStatus, "Logged Today");
  assert.match(snapshot.lastWorkoutText, /Workout logged today: Push A/);
});

test("dashboard includes the user-local workout time in a new PR achievement", () => {
  const exercise = (weight: number) => ({
    exerciseId: 10,
    exerciseOrder: 1,
    exerciseName: "Dumbbell Chest Press",
    primaryMuscleGroupId: 1,
    intensityTechnique: "Normal",
    failureTarget: "Never",
    sets: [
      { setNumber: 1, setType: "Working" as const, weight, reps: 10, rir: 2, completed: true },
    ],
  });
  const history: HistorySessionInput[] = [
    {
      id: 2,
      workoutTemplateId: 1,
      workoutName: "Push A",
      startedAt: new Date("2026-08-25T13:19:00.000Z"),
      exercises: [exercise(110)],
    },
    {
      id: 1,
      workoutTemplateId: 1,
      workoutName: "Push A",
      startedAt: new Date("2026-08-18T13:00:00.000Z"),
      exercises: [exercise(100)],
    },
  ];

  const snapshot = getDashboardSnapshot({
    templates: [{ id: 1, name: "Push A", exercises: [] }],
    history,
    exerciseNameLookup: new Map([[10, "Dumbbell Chest Press"]]),
    exercisePrimaryMuscleLookup: new Map([[10, "UpperChest"]]),
    muscleGroupLookup: { idToName: new Map([[1, "UpperChest"]]) },
    now: new Date("2026-08-26T18:00:00.000Z"),
    zone: "America/Los_Angeles",
  });

  assert.match(snapshot.recentAchievementText, /^New PR: Dumbbell Chest Press:/);
  assert.match(snapshot.recentAchievementText, /Logged Aug 25, 2026, 6:19 AM$/);
  assert.equal(snapshot.recentAchievementTexts.length, 3);
  for (const achievement of snapshot.recentAchievementTexts) {
    assert.match(achievement, /^New PR: Dumbbell Chest Press:/);
    assert.match(achievement, /Logged Aug 25, 2026, 6:19 AM$/);
  }
});

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
      prescriptionSnapshotAvailable: true,
      prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
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

function muscleContext(overrides: Partial<MuscleTrainingContext> = {}): MuscleTrainingContext {
  return {
    muscleGroupId: 1,
    muscle: "UpperChest",
    displayName: "Upper Chest",
    stimulusRatio: 1,
    currentEffectiveSets: 10,
    mev: 6,
    mav: 12,
    mrv: 18,
    volumeStatus: "optimal",
    recoveryPercent: 85,
    fatiguePercent: 15,
    recoveryStatus: "Recovered",
    ...overrides,
  };
}

test("hypertrophy recognizes multi-exposure rep progress before every set reaches the ceiling", () => {
  const history = exposureHistory([[10, 9, 8], [11, 10, 9], [11, 11, 10]]);
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", DEFAULT_COACH_SETTINGS);
  assert.equal(trend.status, "Improving");
  const previous = getPreviousExercisePerformance(history, 10, "Incline Press");
  const recovery = evaluateRecovery(history, { idToName: new Map([[1, "UpperChest"]]) }, new Date("2026-07-10T12:00:00.000Z"))
    .find((state) => state.muscle === "UpperChest")!;
  const progression = evaluateGoalAwareProgressionV2({
    goal: "hypertrophy",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous,
    trend,
    settings: DEFAULT_COACH_SETTINGS,
    recovery,
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    muscleContexts: [muscleContext({ currentEffectiveSets: 10.5 })],
  });
  assert.equal(progression.recommendation, "Add Reps");
  assert.equal(progression.setRecommendation, "Maintain Sets");
});

test("repeated RIR zero prevents blind hypertrophy load progression", () => {
  const history = exposureHistory([[12, 12, 12], [12, 12, 12], [12, 12, 12]], 0);
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", DEFAULT_COACH_SETTINGS);
  const previous = getPreviousExercisePerformance(history, 10, "Incline Press");
  const progression = evaluateGoalAwareProgressionV2({
    goal: "hypertrophy",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous,
    trend,
    settings: DEFAULT_COACH_SETTINGS,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 20, recoveryPercent: 80, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    muscleContexts: [muscleContext()],
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

test("goal profiles keep coaching priorities distinct", () => {
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
  const result = evaluateGoalAwareProgressionV2({
    goal: "muscular_endurance",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 10, targetRepsMax: 12, targetRir: 2 },
    previous,
    trend,
    settings: DEFAULT_COACH_SETTINGS,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 10, recoveryPercent: 90, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    muscleContexts: [muscleContext()],
  });
  assert.equal(result.recommendation, "Add Reps");
});

function historyWithRirs(reps: number[][], rirs: number[]): HistorySessionInput[] {
  return exposureHistory(reps).map((session) => ({
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, rir: rirs[session.id - 1] })),
    })),
  }));
}

function v2Result(history: HistorySessionInput[], goal: "hypertrophy" | "strength" | "general_fitness" | "mobility" | "muscular_endurance") {
  const settings = { ...DEFAULT_COACH_SETTINGS, minComparableExposures: 2 };
  const trend = evaluateExerciseTrend(history, 10, goal, "reps", settings);
  return evaluateGoalAwareProgressionV2({
    goal,
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous: getPreviousExercisePerformance(history, 10, "Incline Press"),
    trend,
    settings,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 15, recoveryPercent: 85, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    muscleContexts: [muscleContext()],
  });
}

test("multi-muscle context constrains added volume without cancelling the compound", () => {
  const contexts = [
    muscleContext({ currentEffectiveSets: 4, volumeStatus: "under" }),
    muscleContext({
      muscleGroupId: 2,
      muscle: "Triceps",
      displayName: "Triceps",
      stimulusRatio: 0.35,
      currentEffectiveSets: 19,
      volumeStatus: "excessive",
      recoveryPercent: 35,
      fatiguePercent: 65,
      recoveryStatus: "Needs Rest",
    }),
  ];
  const limiting = identifyLimitingMuscles(contexts, "hypertrophy");
  assert.equal(limiting[0]?.context.muscle, "Triceps");

  const history = historyWithRirs([[9, 9, 9], [10, 10, 10], [11, 11, 11]], [2, 2, 2]);
  const settings = { ...DEFAULT_COACH_SETTINGS, minComparableExposures: 2 };
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", settings);
  const result = evaluateGoalAwareProgressionV2({
    goal: "hypertrophy",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous: getPreviousExercisePerformance(history, 10, "Incline Press"),
    trend,
    settings,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 15, recoveryPercent: 85, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    muscleContexts: contexts,
  });
  assert.notEqual(result.setRecommendation, "Add Set");
  assert.match(result.reason, /do not add direct Triceps volume/i);
  assert.notEqual(result.recommendation, "Reduce Or Delay");
});

test("RIR-normalized progression distinguishes adaptation from extra effort", () => {
  const sameEffort = v2Result(historyWithRirs([[10, 9, 8], [11, 10, 9]], [2, 2]), "hypertrophy");
  assert.equal(sameEffort.effortNormalizedStatus, "improving");
  assert.equal(sameEffort.recommendation, "Add Reps");

  const harder = v2Result(historyWithRirs([[10, 9, 8], [11, 10, 9]], [2, 0]), "hypertrophy");
  assert.equal(harder.rirAdherence.status, "too_hard");
  assert.equal(harder.effortNormalizedStatus, "uncertain");
  assert.equal(harder.recommendation, "Hold Weight");

  const easier = v2Result(historyWithRirs([[10, 9, 8], [10, 9, 8]], [0, 2]), "hypertrophy");
  assert.equal(easier.effortNormalizedStatus, "improving");
  assert.equal(easier.rirAdherence.status, "on_target");
});

test("fatigue ignores cross-exercise pounds and respects the exercise cost override", () => {
  const exercise = (exerciseId: number, weight: number) => ({
    exerciseId,
    exerciseOrder: 1,
    exerciseName: exerciseId === 1 ? "Leg Press" : "Cable Lateral Raise",
    primaryMuscleGroupId: 1,
    intensityTechnique: "Normal",
    failureTarget: "Never",
    sets: [1, 2, 3].map((setNumber) => ({ setNumber, setType: "Working" as const, weight, reps: 10, rir: 2, completed: true })),
  });
  const legPressFatigue = estimateExerciseFatigue(exercise(1, 500));
  const lateralRaiseFatigue = estimateExerciseFatigue(exercise(2, 15));
  assert.equal(legPressFatigue, lateralRaiseFatigue);
  assert.ok(estimateExerciseFatigue(exercise(1, 500), { exerciseFatigueCosts: { 1: 1.5 } }) > legPressFatigue);
});

test("the native V2 engine changes progression priorities by goal", () => {
  const history = historyWithRirs([[8, 8, 8], [9, 9, 9], [10, 10, 10]], [2, 2, 2]);
  assert.equal(v2Result(history, "hypertrophy").recommendation, "Add Reps");
  assert.equal(v2Result(history, "strength").recommendation, "Increase Weight");
  assert.equal(v2Result(history, "general_fitness").recommendation, "Add Reps");
  assert.equal(v2Result(history, "mobility").recommendation, "Increase Control");
  assert.equal(v2Result(history, "muscular_endurance").recommendation, "Add Reps");
});

test("goal and experience resolve different effective training methods without changing the template", () => {
  const template = { targetSets: 5, targetRepsMin: 8, targetRepsMax: 12, targetRir: 1, restSeconds: 60 };
  const beginner = resolveGoalExperiencePrescription({
    goal: "strength",
    experience: "beginner",
    trackingMode: "reps",
    prescription: template,
  });
  const advanced = resolveGoalExperiencePrescription({
    goal: "strength",
    experience: "advanced",
    trackingMode: "reps",
    prescription: template,
  });

  assert.deepEqual([beginner.targetRepsMin, beginner.targetRepsMax, beginner.targetSets, beginner.targetRir], [5, 8, 3, 2]);
  assert.deepEqual([advanced.targetRepsMin, advanced.targetRepsMax, advanced.targetSets, advanced.targetRir], [2, 6, 5, 1]);
  assert.equal(beginner.restSeconds, 120);
  assert.equal(advanced.restSeconds, 180);
  assert.match(beginner.adjustmentNote ?? "", /saved template was not changed/i);
  assert.deepEqual(template, { targetSets: 5, targetRepsMin: 8, targetRepsMax: 12, targetRir: 1, restSeconds: 60 });
});

test("working-set targets use explicit set structure and repair legacy warm-up padding", () => {
  assert.equal(resolveWorkingSetCount({ targetSets: 6, topSets: 1, backoffSets: 2 }), 3);
  assert.equal(resolveWorkingSetCount({ targetSets: 3, warmupSets: 3 }), 3);
  assert.equal(resolveWorkingSetCount(
    { targetSets: 6 },
    [
      ...Array.from({ length: 3 }, () => ({ setType: "Warmup" })),
      ...Array.from({ length: 3 }, () => ({ setType: "Working" })),
    ],
  ), 3);
});

test("equipment increments and rep projections model the next available load", () => {
  const dumbbells = { equipment: "Dumbbell" as const, minWeight: 5, maxWeight: 60, weightIncrement: 5 };
  assert.equal(nextAvailableWeight(55, dumbbells), 60);
  assert.equal(nextAvailableWeight(60, dumbbells), null);
  assert.equal(nextAvailableWeight(52, dumbbells), 55);

  const projection = calculateRepProjection({
    weight: 55,
    reps: 10,
    rir: 1,
    targetWeight: 60,
    targetReps: 6,
    targetRir: 1,
  });
  assert.equal(projection?.projectedRepsAtTargetWeight, 6);
  assert.equal(projection?.requiredRepsAtCurrentWeight, 10);
});

test("named equipment profiles resolve per exercise without changing their base category", () => {
  const profiles = [
    { id: 1, name: "Cable Tower A", equipment: "Cable" as const, minWeight: 10, maxWeight: 200, weightIncrement: 10 },
    { id: 2, name: "Functional Trainer", equipment: "Cable" as const, minWeight: 5, maxWeight: 160, weightIncrement: 5 },
  ];
  assert.equal(resolveEquipmentProfile(profiles, "Cable", 2)?.name, "Functional Trainer");
  assert.equal(resolveEquipmentProfile(profiles, "Cable")?.name, "Cable Tower A");
  assert.equal(resolveEquipmentProfile(profiles, "Dumbbell", 2), null);
});

test("Coach builds reps when an equipment jump would fall below the prescribed range", () => {
  const history = exposureHistory([[12, 12, 12], [12, 12, 12], [12, 12, 12]], 2);
  const settings = { ...DEFAULT_COACH_SETTINGS, minComparableExposures: 2 };
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", settings);
  const result = evaluateGoalAwareProgressionV2({
    goal: "hypertrophy",
    experience: "intermediate",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous: getPreviousExercisePerformance(history, 10, "Incline Press"),
    trend,
    settings,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 10, recoveryPercent: 90, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    muscleContexts: [muscleContext({ recoveryPercent: 90, fatiguePercent: 10 })],
    weightSettings: { equipment: "Dumbbell", minWeight: 5, maxWeight: 200, weightIncrement: 10 },
  });

  assert.equal(result.recommendation, "Add Reps");
  assert.equal(result.suggestedWeight, 75);
  assert.match(result.nextGoalText, /before the 85 lb jump/i);
});

test("beginner and intermediate policies do not inherit hidden advanced overrides", () => {
  const customized = {
    ...DEFAULT_COACH_SETTINGS,
    progressionStyle: "load_first" as const,
    minComparableExposures: 6,
    trendHistoryLimit: 8,
    volumeProgressionSensitivity: "aggressive" as const,
  };
  const beginner = applyExperienceCoachSettings(customized, "beginner");
  const intermediate = applyExperienceCoachSettings(customized, "intermediate");
  const advanced = applyExperienceCoachSettings(customized, "advanced");

  assert.equal(beginner.progressionStyle, "automatic");
  assert.equal(beginner.minComparableExposures, 2);
  assert.equal(beginner.volumeProgressionSensitivity, "normal");
  assert.equal(intermediate.minComparableExposures, 3);
  assert.equal(advanced.progressionStyle, "load_first");
  assert.equal(advanced.minComparableExposures, 6);
});

test("beginner coaching states exactly how many similar sessions remain", () => {
  const history = exposureHistory([[10, 10, 10]]);
  const settings = applyExperienceCoachSettings(DEFAULT_COACH_SETTINGS, "beginner");
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", settings);
  const input = {
    goal: "hypertrophy" as const,
    experience: "beginner" as const,
    trackingMode: "reps" as const,
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous: getPreviousExercisePerformance(history, 10, "Incline Press"),
    trend,
    settings,
    recovery: { muscle: "UpperChest" as const, displayName: "Upper Chest", fatiguePercent: 15, recoveryPercent: 85, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered" as const, summary: "" },
    fatigue: { status: "Learning" as const, summary: "2 more workout sessions needed.", riskScore: 10, deloadSuggested: false },
    muscleContexts: [muscleContext()],
  };
  const progression = evaluateGoalAwareProgressionV2(input);
  const suggestion = buildGoalAwareWorkoutSuggestion(input, progression);

  assert.equal(progression.learningSessionsRemaining, 1);
  assert.equal(progression.learningText, "1 more similar session needed before Coach can evaluate your trend.");
  assert.equal(suggestion.learningText, progression.learningText);
  assert.doesNotMatch(suggestion.suggestedGoal, /RIR/i);
  assert.match(suggestion.effortGuidance ?? "", /2 more good reps/i);
  assert.match(suggestion.restGuidance ?? "", /1.5 minutes/i);
});

test("fatigue learning states show the exact remaining workout-session count", () => {
  assert.equal(
    evaluateFatigueTrend([]).summary,
    "3 more workout sessions needed before fatigue trends can be evaluated.",
  );
  assert.equal(
    evaluateFatigueTrend(exposureHistory([[10, 10, 10], [10, 10, 10]])).summary,
    "1 more workout session needed before fatigue trends can be evaluated.",
  );
});

test("explicit progression styles produce distinct behavior and automatic follows the goal", () => {
  assert.equal(resolveProgressionStyle("strength", "automatic"), "load_first");
  assert.equal(resolveProgressionStyle("hypertrophy", "automatic"), "rep_first");
  assert.equal(resolveProgressionStyle("general_fitness", "automatic"), "balanced");

  const history = historyWithRirs([[8, 8, 8], [9, 9, 9], [10, 10, 10]], [2, 2, 2]);
  const resultFor = (progressionStyle: "rep_first" | "load_first") => {
    const settings = { ...DEFAULT_COACH_SETTINGS, minComparableExposures: 2, progressionStyle };
    const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", settings);
    return evaluateGoalAwareProgressionV2({
      goal: "hypertrophy",
      experience: "advanced",
      trackingMode: "reps",
      prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
      previous: getPreviousExercisePerformance(history, 10, "Incline Press"),
      trend,
      settings,
      recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 15, recoveryPercent: 85, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
      fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
      muscleContexts: [muscleContext()],
    });
  };

  assert.equal(resultFor("rep_first").recommendation, "Add Reps");
  assert.equal(resultFor("load_first").recommendation, "Increase Weight");
});

test("fatigue and recovery override every goal-specific progression", () => {
  const history = historyWithRirs([[10, 10, 10], [11, 11, 11], [12, 12, 12]], [2, 2, 2]);
  const settings = { ...DEFAULT_COACH_SETTINGS, minComparableExposures: 2 };
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", settings);
  const result = evaluateGoalAwareProgressionV2({
    goal: "hypertrophy",
    experience: "intermediate",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous: getPreviousExercisePerformance(history, 10, "Incline Press"),
    trend,
    settings,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 80, recoveryPercent: 20, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Needs Rest", summary: "" },
    fatigue: { status: "Fatigue Risk", summary: "", riskScore: 82, deloadSuggested: true },
    muscleContexts: [muscleContext({ recoveryPercent: 20, fatiguePercent: 80, recoveryStatus: "Needs Rest" })],
  });

  assert.equal(result.recommendation, "Reduce Or Delay");
  assert.equal(result.setRecommendation, "Reduce Set");
  assert.equal(result.prescribedSets, 2);
  assert.ok(result.suggestedWeight < 75);
});

test("a global watch trend does not freeze a recovered improving exercise", () => {
  const history = historyWithRirs([[10, 10, 10], [11, 11, 11], [12, 12, 12]], [2, 2, 2]);
  const settings = { ...DEFAULT_COACH_SETTINGS, minComparableExposures: 2 };
  const trend = evaluateExerciseTrend(history, 10, "hypertrophy", "reps", settings);
  const result = evaluateGoalAwareProgressionV2({
    goal: "hypertrophy",
    experience: "intermediate",
    trackingMode: "reps",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2 },
    previous: getPreviousExercisePerformance(history, 10, "Incline Press"),
    trend,
    settings,
    recovery: { muscle: "UpperChest", displayName: "Upper Chest", fatiguePercent: 10, recoveryPercent: 90, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Watch Trend", summary: "", riskScore: 60, deloadSuggested: false },
    muscleContexts: [muscleContext({ recoveryPercent: 90, fatiguePercent: 10 })],
  });

  assert.equal(result.recommendation, "Increase Weight");
  assert.equal(result.prescribedSets, 3);
  assert.doesNotMatch(result.reason, /fatigue is elevated/i);
});

test("duration progression compares the per-hold average rather than total session time", () => {
  const history: HistorySessionInput[] = [1, 2, 3].map((id) => ({
    id,
    workoutTemplateId: 1,
    workoutName: "Mobility",
    startedAt: new Date(`2026-08-0${id}T12:00:00.000Z`),
    exercises: [{
      exerciseId: 99,
      exerciseOrder: 1,
      exerciseName: "Wall Sit",
      trackingMode: "duration",
      primaryMuscleGroupId: 1,
      intensityTechnique: "Normal",
      failureTarget: "Never",
      sets: [1, 2, 3].map((setNumber) => ({
        setNumber,
        setType: "Working" as const,
        weight: 0,
        reps: 0,
        durationSeconds: 30,
        rir: null,
        completed: true,
      })),
    }],
  }));
  const settings = { ...DEFAULT_COACH_SETTINGS, minComparableExposures: 2 };
  const trend = evaluateExerciseTrend(history, 99, "mobility", "duration", settings);
  const result = evaluateGoalAwareProgressionV2({
    goal: "mobility",
    experience: "intermediate",
    trackingMode: "duration",
    prescription: { targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetDurationMinSeconds: 30, targetDurationMaxSeconds: 60, targetRir: 3 },
    previous: getPreviousExercisePerformance(history, 99, "Wall Sit"),
    trend,
    settings,
    recovery: { muscle: "Quads", displayName: "Quads", fatiguePercent: 15, recoveryPercent: 85, lastTrainedAt: null, hoursSinceLastTrained: 0, status: "Recovered", summary: "" },
    fatigue: { status: "Stable", summary: "", riskScore: 15, deloadSuggested: false },
    muscleContexts: [muscleContext({ muscle: "Quads", displayName: "Quads" })],
  });

  assert.equal(result.recommendation, "Add Hold Time");
  assert.match(result.nextGoalText, /per hold/i);
});

test("learned volume range favors productive completed weeks and rejects a declining high week", () => {
  const dates = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02", "2026-02-09"];
  const setCounts = [8, 10, 12, 14, 16, 20];
  const repsPerSet = [8, 9, 10, 11, 11, 9];
  const history: HistorySessionInput[] = dates.map((date, index) => ({
    id: index + 1,
    workoutTemplateId: 1,
    workoutName: "Side Delts",
    startedAt: new Date(`${date}T18:00:00.000Z`),
    exercises: [{
      exerciseId: 50,
      exerciseOrder: 1,
      exerciseName: "Cable Lateral Raise",
      primaryMuscleGroupId: 7,
      stimulus: [{ muscleGroupId: 7, stimulusRatio: 1 }],
      intensityTechnique: "Normal",
      failureTarget: "Never",
      sets: Array.from({ length: setCounts[index] }, (_, setIndex) => ({
        setNumber: setIndex + 1,
        setType: "Working" as const,
        weight: 15,
        reps: repsPerSet[index],
        rir: 2,
        completed: true,
      })),
    }],
  }));
  const learned = learnPersonalVolumeRanges(history, new Date("2026-02-23T12:00:00.000Z"), "UTC").find((item) => item.muscleGroupId === 7)!;
  assert.equal(learned.validWeekCount, 5);
  assert.equal(learned.productiveLow, 10);
  assert.equal(learned.productiveHigh, 16);
  assert.match(learned.explanation, /10-16 effective sets/);
});
