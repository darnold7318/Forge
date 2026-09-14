import type { AdvancedTrainerSettings, MuscleGroupName } from "./schema";
import type {
  AdvancedTrainerPlanMetadata,
  GuidedPlanExerciseInput,
} from "./guided-workout";
import { guidedSessionPlanSchema } from "./guided-workout";
import { addCivilDays } from "./timezone";

export type AdvancedTrainerPhase = "accumulation" | "deload" | "review";

export interface AdvancedTrainerState {
  cycleId: number;
  startedOn: string;
  weekNumber: number;
  totalWeeks: number;
  phase: AdvancedTrainerPhase;
  settings: AdvancedTrainerSettings;
  configuredSettings: AdvancedTrainerSettings;
  daysRemaining: number;
}

export interface AdvancedCycleWorkout {
  id: number;
  date: string;
  name: string | null;
  status: string;
  weekNumber: number;
  phase: "accumulation" | "deload";
  workingSets: number;
}

export interface AdvancedCycleDateChange {
  id: number;
  previousStartedOn: string;
  newStartedOn: string;
  changedAt: string;
  workoutId: number | null;
  undoOfChangeId: number | null;
}

export interface AdvancedStartAlignment {
  eligible: boolean;
  reason: string;
  workoutId: number | null;
  date: string | null;
}

export interface AdvancedTrainerOverview {
  state: AdvancedTrainerState | null;
  settings: AdvancedTrainerSettings;
  dates: { startedOn: string; deloadOn: string; reviewOn: string };
  workouts: AdvancedCycleWorkout[];
  dateChanges: AdvancedCycleDateChange[];
  alignment: AdvancedStartAlignment;
  undo: { eligible: boolean; reason: string; changeId: number | null };
}

export function parseAdvancedWorkoutMetadata(sessionPlan: string | null | undefined): AdvancedTrainerPlanMetadata | null {
  if (!sessionPlan) return null;
  try {
    const parsed = guidedSessionPlanSchema.safeParse(JSON.parse(sessionPlan));
    return parsed.success ? parsed.data.advancedTrainer ?? null : null;
  } catch {
    return null;
  }
}

export function advancedCycleDates(startedOn: string, settings: AdvancedTrainerSettings) {
  return {
    startedOn,
    deloadOn: addCivilDays(startedOn, settings.accumulationWeeks * 7),
    reviewOn: addCivilDays(startedOn, (settings.accumulationWeeks + 1) * 7),
  };
}

export function validateAdvancedCycleAnchor(args: {
  startedOn: string;
  today: string;
  settings: AdvancedTrainerSettings;
  workouts: AdvancedCycleWorkout[];
  hasActiveWorkout: boolean;
}): string | null {
  if (args.hasActiveWorkout) return "Finish or discard the active workout before changing the cycle start.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startedOn) || addCivilDays(args.startedOn, 0) !== args.startedOn) return "Invalid cycle start date.";
  if (args.startedOn > args.today) return "The cycle cannot start in the future.";
  for (const workout of args.workouts) {
    if (workout.date < args.startedOn) return "The new start would exclude a linked workout.";
    const timing = resolveAdvancedTrainerTiming({ startedOn: args.startedOn, today: workout.date, settings: args.settings });
    if (timing.weekNumber !== workout.weekNumber || timing.phase !== workout.phase) {
      return "The new start would conflict with a workout's saved week or phase.";
    }
  }
  return null;
}

export function advancedStartAlignment(args: {
  startedOn: string;
  today: string;
  settings: AdvancedTrainerSettings;
  workouts: AdvancedCycleWorkout[];
  hasActiveWorkout: boolean;
}): AdvancedStartAlignment {
  const blocked = (reason: string): AdvancedStartAlignment => ({ eligible: false, reason, workoutId: null, date: null });
  if (args.workouts.length !== 1) return blocked("Alignment requires exactly one completed workout linked to this cycle.");
  const first = args.workouts[0];
  if (first.status !== "completed" || first.weekNumber !== 1 || first.phase !== "accumulation") {
    return blocked("The first workout must be completed week-1 accumulation work.");
  }
  if (first.date === args.startedOn) return blocked("The cycle already starts on your first workout's date.");
  const reason = validateAdvancedCycleAnchor({ ...args, startedOn: first.date });
  if (reason) return blocked(reason);
  return { eligible: true, reason: "Align the existing cycle to its first completed workout without changing workout history.", workoutId: first.id, date: first.date };
}

export interface AdvancedTemplateExercise {
  exerciseId: number;
  targetSets: number;
}

export interface AdvancedExerciseVolumeProfile {
  exerciseId: number;
  primaryMuscle: MuscleGroupName;
  stimulus: Array<{ muscleGroupName: MuscleGroupName; stimulusRatio: number }>;
}

export interface AdvancedPlanResult {
  exercises: GuidedPlanExerciseInput[];
  metadata: AdvancedTrainerPlanMetadata;
  warnings: string[];
}

interface VolumeLandmark {
  label: string;
  mev: number;
  mav: number;
  mrv: number;
}

// RP-style direct-set landmarks. Chest and back are deliberately aggregated:
// upper/lower chest and lat/upper-back rows are useful for exercise balance,
// but must not each receive a full independent weekly volume allowance.
const VOLUME_LANDMARKS: Record<string, VolumeLandmark> = {
  Chest: { label: "Chest", mev: 6, mav: 16, mrv: 24 },
  Back: { label: "Back", mev: 10, mav: 20, mrv: 25 },
  Triceps: { label: "Triceps", mev: 5, mav: 16, mrv: 20 },
  Biceps: { label: "Biceps", mev: 9, mav: 20, mrv: 26 },
  Quads: { label: "Quads", mev: 5, mav: 14, mrv: 18 },
  Hamstrings: { label: "Hamstrings", mev: 3, mav: 8, mrv: 14 },
  Glutes: { label: "Glutes", mev: 7, mav: 24, mrv: 30 },
  Calves: { label: "Calves", mev: 5, mav: 16, mrv: 24 },
  Abs: { label: "Abs", mev: 2, mav: 12, mrv: 20 },
  Obliques: { label: "Obliques", mev: 2, mav: 10, mrv: 18 },
  FrontDelts: { label: "Front Delts", mev: 1, mav: 8, mrv: 12 },
  SideDelts: { label: "Side Delts", mev: 7, mav: 24, mrv: 30 },
  RearDelts: { label: "Rear Delts", mev: 2, mav: 12, mrv: 20 },
  Traps: { label: "Traps", mev: 2, mav: 12, mrv: 20 },
  Forearms: { label: "Forearms", mev: 4, mav: 24, mrv: 30 },
  SpinalErectors: { label: "Spinal Erectors", mev: 2, mav: 8, mrv: 12 },
  Adductors: { label: "Adductors", mev: 3, mav: 8, mrv: 14 },
  Abductors: { label: "Abductors", mev: 3, mav: 8, mrv: 14 },
};

export function advancedVolumeKey(muscle: MuscleGroupName): string {
  if (muscle === "UpperChest" || muscle === "MidLowerChest") return "Chest";
  if (muscle === "Lats" || muscle === "UpperMidBack") return "Back";
  return muscle;
}

function civilDayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function resolveAdvancedTrainerTiming(args: {
  startedOn: string;
  today: string;
  settings: AdvancedTrainerSettings;
}): Pick<AdvancedTrainerState, "weekNumber" | "totalWeeks" | "phase" | "daysRemaining"> {
  const elapsedDays = Math.max(0, civilDayNumber(args.today) - civilDayNumber(args.startedOn));
  const totalWeeks = args.settings.accumulationWeeks + 1;
  const rawWeek = Math.floor(elapsedDays / 7) + 1;
  if (rawWeek > totalWeeks) {
    return { weekNumber: totalWeeks, totalWeeks, phase: "review", daysRemaining: 0 };
  }
  const phase: AdvancedTrainerPhase = rawWeek === totalWeeks ? "deload" : "accumulation";
  return {
    weekNumber: rawWeek,
    totalWeeks,
    phase,
    daysRemaining: Math.max(0, totalWeeks * 7 - elapsedDays),
  };
}

export function targetRirForWeek(settings: AdvancedTrainerSettings, weekNumber: number): number {
  if (weekNumber > settings.accumulationWeeks) return 4;
  if (settings.accumulationWeeks <= 1) return settings.endRir;
  const progress = (Math.max(1, weekNumber) - 1) / (settings.accumulationWeeks - 1);
  return Math.round(settings.startRir + (settings.endRir - settings.startRir) * progress);
}

function targetSetsFor(key: string, state: AdvancedTrainerState): number | null {
  const landmark = VOLUME_LANDMARKS[key];
  if (!landmark) return null;
  if (state.phase === "deload") {
    return Math.max(1, Math.round(landmark.mev * state.settings.deloadSetPercent / 100));
  }
  const progress = state.settings.accumulationWeeks <= 1
    ? 1
    : (state.weekNumber - 1) / (state.settings.accumulationWeeks - 1);
  return Math.round(landmark.mev + (landmark.mav - landmark.mev) * Math.max(0, Math.min(1, progress)));
}

const roundOne = (value: number) => Math.round(value * 10) / 10;

export function refreshAdvancedPlanMetadata(
  metadata: AdvancedTrainerPlanMetadata,
  exercises: Array<Pick<GuidedPlanExerciseInput, "exerciseId" | "workingSets">>,
  volumeProfiles: AdvancedExerciseVolumeProfile[],
): AdvancedTrainerPlanMetadata {
  const profileByExercise = new Map(volumeProfiles.map((profile) => [profile.exerciseId, profile]));
  return {
    ...metadata,
    volumeSummary: metadata.volumeSummary.map((summary) => {
      const matching = exercises.filter((exercise) => {
        const profile = profileByExercise.get(exercise.exerciseId);
        if (!profile) return false;
        const key = advancedVolumeKey(profile.primaryMuscle);
        return (VOLUME_LANDMARKS[key]?.label ?? key) === summary.muscleGroup;
      });
      let secondaryStimulus = 0;
      let fatigueLoad = 0;
      for (const exercise of matching) {
        const profile = profileByExercise.get(exercise.exerciseId)!;
        const directKey = advancedVolumeKey(profile.primaryMuscle);
        for (const stimulus of profile.stimulus) {
          const contribution = exercise.workingSets * stimulus.stimulusRatio;
          fatigueLoad += contribution;
          if (advancedVolumeKey(stimulus.muscleGroupName) !== directKey || stimulus.stimulusRatio < 1) {
            secondaryStimulus += contribution;
          }
        }
      }
      return {
        ...summary,
        prescribedDirectSets: matching.reduce((sum, exercise) => sum + exercise.workingSets, 0),
        secondaryStimulus: roundOne(secondaryStimulus),
        fatigueLoad: roundOne(fatigueLoad),
      };
    }),
  };
}

/**
 * Applies a mesocycle prescription to one Guided session without modifying the
 * saved template. Weekly landmarks use only the primary/prime-mover set. All
 * stimulus ratios still contribute to secondary-stimulus and fatigue totals.
 */
export function applyAdvancedMesocyclePlan(args: {
  exercises: GuidedPlanExerciseInput[];
  allTemplateExercises: AdvancedTemplateExercise[];
  volumeProfiles: AdvancedExerciseVolumeProfile[];
  state: AdvancedTrainerState;
}): AdvancedPlanResult {
  if (args.state.phase === "review") throw new Error("Complete the mesocycle review before starting another workout");

  const profileByExercise = new Map(args.volumeProfiles.map((profile) => [profile.exerciseId, profile]));
  const templateDirect = new Map<string, number>();
  for (const row of args.allTemplateExercises) {
    const profile = profileByExercise.get(row.exerciseId);
    if (!profile) continue;
    const key = advancedVolumeKey(profile.primaryMuscle);
    templateDirect.set(key, (templateDirect.get(key) ?? 0) + Math.max(0, row.targetSets));
  }

  const sessionUsed = new Map<string, number>();
  const prescribedWeekly = new Map<string, number>();
  const targetRir = targetRirForWeek(args.state.settings, args.state.weekNumber);
  const warnings: string[] = [];
  const exercises = args.exercises.map((exercise) => {
    const profile = profileByExercise.get(exercise.exerciseId);
    const key = profile ? advancedVolumeKey(profile.primaryMuscle) : null;
    const weeklyBase = key ? templateDirect.get(key) ?? 0 : 0;
    const weeklyTarget = key ? targetSetsFor(key, args.state) : null;
    const scaled = weeklyTarget != null && weeklyBase > 0
      ? Math.max(1, Math.round(exercise.templateWorkingSets * weeklyTarget / weeklyBase))
      : exercise.workingSets;
    const recoveryCap = exercise.fatiguePercent >= 70 ? Math.max(1, exercise.workingSets - 1) : Number.POSITIVE_INFINITY;
    const exerciseCap = Math.min(args.state.settings.maxSetsPerExercise, recoveryCap);
    const alreadyUsed = key ? sessionUsed.get(key) ?? 0 : 0;
    const sessionAvailable = Math.max(1, args.state.settings.maxSetsPerMuscleSession - alreadyUsed);
    const workingSets = Math.max(1, Math.min(scaled, exerciseCap, sessionAvailable));
    if (key) {
      sessionUsed.set(key, alreadyUsed + workingSets);
      prescribedWeekly.set(key, (prescribedWeekly.get(key) ?? 0) + workingSets);
    }

    const isDuration = exercise.trackingMode === "duration";
    const targetWeight = args.state.phase === "deload"
      ? roundOne(exercise.targetWeight * args.state.settings.deloadLoadPercent / 100)
      : exercise.targetWeight;
    return {
      ...exercise,
      workingSets,
      targetWeight,
      targetRepsMin: isDuration ? exercise.targetRepsMin : Math.max(5, Math.min(30, exercise.targetRepsMin)),
      targetRepsMax: isDuration ? exercise.targetRepsMax : Math.max(5, Math.min(30, exercise.targetRepsMax)),
      targetRirMin: targetRir,
      targetRirMax: Math.min(5, targetRir + 1),
      recommendation: args.state.phase === "deload" ? "Deload Technique" : "Mesocycle Target",
      recommendationReason: args.state.phase === "deload"
        ? `Reduce fatigue with ${workingSets} crisp set${workingSets === 1 ? "" : "s"}, about ${args.state.settings.deloadLoadPercent}% of normal load, and no failure work.`
        : `Week ${args.state.weekNumber}/${args.state.settings.accumulationWeeks}: direct volume progresses from MEV toward MAV at RIR ${targetRir}-${Math.min(5, targetRir + 1)}.`,
    };
  });

  const keys = new Set<string>();
  for (const profile of args.volumeProfiles) keys.add(advancedVolumeKey(profile.primaryMuscle));
  const summary = Array.from(keys).flatMap((key) => {
    const sessionExercises = exercises.filter((exercise) => {
      const profile = profileByExercise.get(exercise.exerciseId);
      return profile && advancedVolumeKey(profile.primaryMuscle) === key;
    });
    if (sessionExercises.length === 0) return [];
    let secondaryStimulus = 0;
    let fatigueLoad = 0;
    for (const exercise of sessionExercises) {
      const profile = profileByExercise.get(exercise.exerciseId)!;
      for (const stimulus of profile.stimulus) {
        const contribution = exercise.workingSets * stimulus.stimulusRatio;
        fatigueLoad += contribution;
        if (advancedVolumeKey(stimulus.muscleGroupName) !== key || stimulus.stimulusRatio < 1) {
          secondaryStimulus += contribution;
        }
      }
    }
    return [{
      muscleGroup: VOLUME_LANDMARKS[key]?.label ?? key,
      templateDirectSets: templateDirect.get(key) ?? 0,
      prescribedDirectSets: prescribedWeekly.get(key) ?? 0,
      secondaryStimulus: roundOne(secondaryStimulus),
      fatigueLoad: roundOne(fatigueLoad),
    }];
  });

  if (args.state.phase === "deload") {
    warnings.push("Deload week: keep technique crisp, avoid failure and intensity techniques, and finish fresher than you started.");
  } else {
    warnings.push("Direct sets use RP-style weekly landmarks; secondary stimulus is tracked as fatigue instead of consuming another direct-set allowance.");
  }
  if (Array.from(sessionUsed.values()).some((sets) => sets >= args.state.settings.maxSetsPerMuscleSession)) {
    warnings.push(`Per-session direct work is capped at ${args.state.settings.maxSetsPerMuscleSession} sets per muscle group.`);
  }

  return {
    exercises,
    metadata: {
      cycleId: args.state.cycleId,
      weekNumber: args.state.weekNumber,
      totalWeeks: args.state.totalWeeks,
      phase: args.state.phase,
      targetRir,
      deloadLoadPercent: args.state.phase === "deload" ? args.state.settings.deloadLoadPercent : null,
      volumeSummary: summary,
    },
    warnings,
  };
}
