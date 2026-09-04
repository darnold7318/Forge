import { z } from "zod";

export const guidedTimeStrategyIds = ["standard", "smart_pairs"] as const;
export type GuidedTimeStrategy = (typeof guidedTimeStrategyIds)[number];

export const guidedPlanExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  exerciseName: z.string().min(1),
  exerciseOrder: z.number().int().nonnegative(),
  exerciseRole: z.string(),
  trackingMode: z.enum(["reps", "duration"]),
  equipment: z.string(),
  isCompound: z.boolean(),
  primaryMuscleGroupId: z.number().int().positive(),
  warmupSets: z.number().int().min(0),
  workingSets: z.number().int().min(1),
  templateWorkingSets: z.number().int().min(1),
  targetWeight: z.number().min(0),
  targetRepsMin: z.number().int().min(0),
  targetRepsMax: z.number().int().min(0),
  targetDurationMinSeconds: z.number().int().min(1).nullable(),
  targetDurationMaxSeconds: z.number().int().min(1).nullable(),
  targetRirMin: z.number().min(0),
  targetRirMax: z.number().min(0),
  restSeconds: z.number().int().min(0),
  recommendation: z.string(),
  recommendationReason: z.string(),
  recoveryPercent: z.number().min(0).max(100),
  fatiguePercent: z.number().min(0).max(100),
  pairGroup: z.number().int().positive().nullable(),
  skipped: z.boolean().default(false),
});

export const guidedSessionPlanSchema = z.object({
  version: z.literal(1),
  workoutTemplateId: z.number().int().positive().nullable(),
  workoutName: z.string().min(1),
  createdAt: z.string().datetime(),
  timeBudgetMinutes: z.number().int().min(15).max(240).nullable(),
  timeStrategy: z.enum(guidedTimeStrategyIds),
  estimatedMinutes: z.number().int().min(1),
  originalEstimatedMinutes: z.number().int().min(1),
  exercises: z.array(guidedPlanExerciseSchema).min(1),
  warnings: z.array(z.string()),
});

export type GuidedPlanExercise = z.infer<typeof guidedPlanExerciseSchema>;
export type GuidedSessionPlan = z.infer<typeof guidedSessionPlanSchema>;

export interface GuidedPlanExerciseInput extends Omit<GuidedPlanExercise, "pairGroup" | "skipped"> {}

function exerciseSeconds(exercise: Pick<GuidedPlanExercise, "warmupSets" | "workingSets" | "restSeconds" | "skipped">): number {
  if (exercise.skipped) return 0;
  const setCount = exercise.warmupSets + exercise.workingSets;
  return setCount * 40 + Math.max(0, setCount - 1) * exercise.restSeconds + 45;
}

export function estimateGuidedSessionMinutes(
  exercises: GuidedPlanExercise[],
  strategy: GuidedTimeStrategy = "standard",
): number {
  let seconds = exercises.reduce((sum, exercise) => sum + exerciseSeconds(exercise), 0);
  if (strategy === "smart_pairs") {
    const pairs = new Map<number, GuidedPlanExercise[]>();
    for (const exercise of exercises) {
      if (exercise.pairGroup == null || exercise.skipped) continue;
      const group = pairs.get(exercise.pairGroup) ?? [];
      group.push(exercise);
      pairs.set(exercise.pairGroup, group);
    }
    for (const pair of Array.from(pairs.values())) {
      if (pair.length !== 2) continue;
      const shorterRestWork = Math.min(
        Math.max(0, pair[0].warmupSets + pair[0].workingSets - 1) * pair[0].restSeconds,
        Math.max(0, pair[1].warmupSets + pair[1].workingSets - 1) * pair[1].restSeconds,
      );
      seconds -= shorterRestWork * 0.65;
    }
  }
  return Math.max(1, Math.ceil(seconds / 60));
}

function assignSmartPairs(exercises: GuidedPlanExercise[]): GuidedPlanExercise[] {
  const result: GuidedPlanExercise[] = exercises.map((exercise) => ({ ...exercise, pairGroup: null }));
  let pairGroup = 1;
  for (let index = 0; index < result.length - 1; index += 1) {
    const first = result[index];
    const second = result[index + 1];
    if (
      first.pairGroup == null &&
      second.pairGroup == null &&
      !first.isCompound &&
      !second.isCompound &&
      first.primaryMuscleGroupId !== second.primaryMuscleGroupId
    ) {
      first.pairGroup = pairGroup;
      second.pairGroup = pairGroup;
      pairGroup += 1;
      index += 1;
    }
  }
  return result;
}

export function buildGuidedSessionPlan(args: {
  workoutTemplateId: number | null;
  workoutName: string;
  exercises: GuidedPlanExerciseInput[];
  timeBudgetMinutes: number | null;
  timeStrategy?: GuidedTimeStrategy;
  now?: Date;
}): GuidedSessionPlan {
  const timeStrategy = args.timeStrategy ?? "standard";
  let exercises: GuidedPlanExercise[] = args.exercises
    .map((exercise) => ({ ...exercise, pairGroup: null, skipped: false }))
    .sort((a, b) => a.exerciseOrder - b.exerciseOrder);
  if (timeStrategy === "smart_pairs") exercises = assignSmartPairs(exercises);

  const originalEstimatedMinutes = estimateGuidedSessionMinutes(exercises, timeStrategy);
  const warnings: string[] = [];
  const budget = args.timeBudgetMinutes;
  if (budget != null) {
    // Preserve at least one quality working set for every selected exercise.
    // Remove lowest-priority work from the end before reducing useful rest.
    let guard = 500;
    while (estimateGuidedSessionMinutes(exercises, timeStrategy) > budget && guard > 0) {
      guard -= 1;
      const candidate = [...exercises]
        .reverse()
        .find((exercise) => !exercise.skipped && exercise.workingSets > 1);
      if (!candidate) break;
      candidate.workingSets -= 1;
    }
    if (exercises.some((exercise) => exercise.workingSets < exercise.templateWorkingSets)) {
      warnings.push("The time-budget version trims lower-priority working sets without changing your template.");
    }
    if (estimateGuidedSessionMinutes(exercises, timeStrategy) > budget) {
      warnings.push("This plan cannot fit the selected budget without removing an exercise or shortening recovery.");
    }
  }
  if (exercises.some((exercise) => exercise.fatiguePercent >= 70)) {
    warnings.push("One or more target muscles show high fatigue. Review the Coach adjustment before starting.");
  }
  if (timeStrategy === "smart_pairs" && exercises.some((exercise) => exercise.pairGroup != null)) {
    warnings.push("Smart pairs alternate non-competing accessory exercises. Switch to Standard if performance drops.");
  }

  return {
    version: 1,
    workoutTemplateId: args.workoutTemplateId,
    workoutName: args.workoutName,
    createdAt: (args.now ?? new Date()).toISOString(),
    timeBudgetMinutes: budget,
    timeStrategy,
    estimatedMinutes: estimateGuidedSessionMinutes(exercises, timeStrategy),
    originalEstimatedMinutes,
    exercises,
    warnings,
  };
}

export interface GuidedSetPerformance {
  reps: number;
  rir: number | null;
  weight: number;
  isWarmup: boolean;
}

export interface GuidedSetAdjustment {
  status: "on_plan" | "ready_to_progress" | "extend_rest" | "reduce_load" | "consider_stopping";
  message: string;
  nextRestSeconds: number;
  suggestedWeight: number;
  suggestTrimRemainingSet: boolean;
}

export function evaluateGuidedSetAdjustment(args: {
  exercise: GuidedPlanExercise;
  current: GuidedSetPerformance;
  previousWorkingSet?: GuidedSetPerformance;
  weightIncrement?: number;
}): GuidedSetAdjustment {
  const { exercise, current, previousWorkingSet } = args;
  const increment = Math.max(0.5, args.weightIncrement ?? 5);
  const roundWeight = (value: number) => Math.max(0, Math.round(value / increment) * increment);
  const base: GuidedSetAdjustment = {
    status: "on_plan",
    message: "Performance is on plan. Keep the same target for the next set.",
    nextRestSeconds: exercise.restSeconds,
    suggestedWeight: current.weight,
    suggestTrimRemainingSet: false,
  };
  if (current.isWarmup) return { ...base, message: "Warm-up logged. Continue when technique and range feel ready." };

  const repDrop = previousWorkingSet && previousWorkingSet.weight === current.weight && previousWorkingSet.reps > 0
    ? (previousWorkingSet.reps - current.reps) / previousWorkingSet.reps
    : 0;
  if (current.rir === 0 && current.reps < exercise.targetRepsMin) {
    return {
      status: "consider_stopping",
      message: "This set reached the limit below the target range. Reduce load or end this exercise rather than forcing another hard set.",
      nextRestSeconds: exercise.restSeconds + 45,
      suggestedWeight: roundWeight(current.weight * 0.9),
      suggestTrimRemainingSet: true,
    };
  }
  if ((current.rir != null && current.rir < exercise.targetRirMin) || repDrop >= 0.2) {
    return {
      status: repDrop >= 0.25 ? "consider_stopping" : "extend_rest",
      message: repDrop >= 0.2
        ? "Repetitions dropped sharply. Extend rest and consider trimming the final set if performance does not recover."
        : "Effort was harder than planned. Take more rest before deciding whether to repeat the load.",
      nextRestSeconds: exercise.restSeconds + 30,
      suggestedWeight: repDrop >= 0.25 ? roundWeight(current.weight * 0.95) : current.weight,
      suggestTrimRemainingSet: repDrop >= 0.25,
    };
  }
  if (current.reps < exercise.targetRepsMin) {
    return {
      status: "reduce_load",
      message: "The target rep range was missed. Use a small load reduction for the next set.",
      nextRestSeconds: exercise.restSeconds + 15,
      suggestedWeight: roundWeight(current.weight * 0.95),
      suggestTrimRemainingSet: false,
    };
  }
  if (current.reps >= exercise.targetRepsMax && current.rir != null && current.rir >= exercise.targetRirMax) {
    return {
      status: "ready_to_progress",
      message: "You reached the top of the range with reps in reserve. Keep quality high; this supports progression next session.",
      nextRestSeconds: exercise.restSeconds,
      suggestedWeight: current.weight,
      suggestTrimRemainingSet: false,
    };
  }
  return base;
}
