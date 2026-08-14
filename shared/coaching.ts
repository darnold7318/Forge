// ---------------------------------------------------------------------------
// Forge coaching logic — pure, testable utility functions.
// Ported faithfully from the reference C# WPF app's coaching engines:
// ProgressionEngine, RecoveryEngine, FatigueEngine, ReadinessEngine,
// PersonalRecordEngine, WorkoutRecommendationEngine, WorkoutAnalyzer,
// DashboardService.
// No side effects, no I/O — all inputs are plain data.
// ---------------------------------------------------------------------------

import {
  DEFAULT_RECOVERY_SETTINGS,
  DEFAULT_COACH_SETTINGS,
  muscleGroupNames,
  muscleGroupDisplayNames,
  type MuscleGroupName,
  type RecoverySettings,
  type WorkoutSplitId,
  type ExerciseRole,
  type FailureTarget,
  type TrackingMode,
  type TrainingGoalId,
  type CoachSettings,
} from "./schema";
import { civilDateInZone } from "./timezone";

const fmt1 = (n: number) => {
  // Mimic C#'s "0.#" format: up to 1 decimal, trimmed if whole number.
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

// ---------------------------------------------------------------------------
// Shared input shapes
// ---------------------------------------------------------------------------

export interface HistorySetInput {
  setNumber: number;
  setType: "Warmup" | "Working";
  weight: number;
  reps: number;
  durationSeconds?: number | null;
  rir: number | null;
  completed: boolean;
}

export interface HistoryExerciseInput {
  exerciseId: number;
  exerciseOrder: number;
  exerciseName: string;
  trackingMode?: TrackingMode;
  primaryMuscleGroupId: number;
  stimulus?: { muscleGroupId: number; stimulusRatio: number }[];
  intensityTechnique: string; // default "Normal"
  failureTarget: string; // default "Never"
  prescription?: {
    targetSets: number;
    targetRepsMin: number;
    targetRepsMax: number;
    targetDurationMinSeconds?: number | null;
    targetDurationMaxSeconds?: number | null;
    targetRir: number;
  } | null;
  prescriptionSnapshotAvailable?: boolean;
  sets: HistorySetInput[];
}

export interface HistorySessionInput {
  id: number;
  workoutTemplateId: number | null;
  workoutName: string;
  startedAt: Date;
  exercises: HistoryExerciseInput[];
}

// derived helpers on a session/exercise -------------------------------------

export function completedSetsOf(sets: HistorySetInput[]): HistorySetInput[] {
  return sets.filter((s) => s.completed && (s.reps > 0 || (s.durationSeconds ?? 0) > 0));
}

export function exerciseVolume(ex: HistoryExerciseInput): number {
  if (ex.trackingMode === "duration") return 0;
  return completedSetsOf(ex.sets).reduce((sum, s) => sum + s.weight * s.reps, 0);
}

export function exerciseCompletedSetCount(ex: HistoryExerciseInput): number {
  return completedSetsOf(ex.sets).length;
}

export function estimateOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30); // Epley
}

export function exerciseEstimatedOneRepMax(ex: HistoryExerciseInput): number {
  if (ex.trackingMode === "duration") return 0;
  const completed = completedSetsOf(ex.sets);
  if (completed.length === 0) return 0;
  return Math.max(...completed.map((s) => estimateOneRepMax(s.weight, s.reps)));
}

export function exerciseBestSet(ex: HistoryExerciseInput): HistorySetInput | null {
  const completed = completedSetsOf(ex.sets);
  if (completed.length === 0) return null;
  if (ex.trackingMode === "duration") {
    return [...completed].sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))[0];
  }
  return [...completed].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.reps - a.reps;
  })[0];
}

export function exerciseBestSetText(ex: HistoryExerciseInput): string {
  const best = exerciseBestSet(ex);
  if (ex.trackingMode === "duration") {
    return best ? `${best.durationSeconds ?? 0} sec` : "No completed holds";
  }
  return best ? `${fmt1(best.weight)} x ${best.reps}` : "No completed sets";
}

export function sessionTotalVolume(session: HistorySessionInput): number {
  return session.exercises.reduce((sum, e) => sum + exerciseVolume(e), 0);
}

export function sessionCompletedSetCount(session: HistorySessionInput): number {
  return session.exercises.reduce((sum, e) => sum + exerciseCompletedSetCount(e), 0);
}

// ---------------------------------------------------------------------------
// Previous exercise performance
// ---------------------------------------------------------------------------

export interface PreviousExercisePerformance {
  exerciseId: number;
  exerciseName: string;
  lastPerformedAt: Date | null;
  lastSets: HistorySetInput[];
  bestWeight: number;
  bestRepsAtWeight: number;
  bestVolume: number;
}

export function lastPerformanceText(prev: PreviousExercisePerformance): string {
  if (prev.lastSets.length === 0) return "No previous workout available.";
  return [...prev.lastSets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => `${s.setType} ${s.setNumber}: ${fmt1(s.weight)} lb x ${s.reps}${s.rir != null ? ` @ RIR ${s.rir}` : ""}`)
    .join("\n");
}

export function bestPerformanceText(prev: PreviousExercisePerformance): string {
  if (prev.bestWeight <= 0) return "No best set recorded yet.";
  return `Best: ${fmt1(prev.bestWeight)} x ${prev.bestRepsAtWeight} | Best volume: ${fmt1(prev.bestVolume)}`;
}

/** Build PreviousExercisePerformance for a given exercise from full history (most-recent-first). */
export function getPreviousExercisePerformance(
  history: HistorySessionInput[],
  exerciseId: number,
  exerciseName: string,
): PreviousExercisePerformance {
  let lastPerformedAt: Date | null = null;
  let lastSets: HistorySetInput[] = [];
  let bestWeight = 0;
  let bestRepsAtWeight = 0;
  let bestVolume = 0;
  let foundLast = false;

  // history assumed sorted most-recent-first
  for (const session of history) {
    const ex = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const completed = completedSetsOf(ex.sets);
    if (completed.length === 0) continue;

    if (!foundLast) {
      lastPerformedAt = session.startedAt;
      lastSets = ex.sets;
      foundLast = true;
    }

    for (const s of completed) {
      if (s.weight > bestWeight || (s.weight === bestWeight && s.reps > bestRepsAtWeight)) {
        bestWeight = s.weight;
        bestRepsAtWeight = s.reps;
      }
      const vol = s.weight * s.reps;
      if (vol > bestVolume) bestVolume = vol;
    }
  }

  return {
    exerciseId,
    exerciseName,
    lastPerformedAt,
    lastSets,
    bestWeight,
    bestRepsAtWeight,
    bestVolume,
  };
}

// ---------------------------------------------------------------------------
// 1. ProgressionEngine — evaluateProgression
// ---------------------------------------------------------------------------

export interface ProgressionPrescription {
  targetRepsMin: number;
  targetRepsMax: number;
  targetRir: number;
}

export interface ProgressionEvaluation {
  exerciseId: number;
  exerciseName: string;
  status: "No History" | "Progressing" | "Regressing" | "Maintaining";
  recommendation: string;
  reason: string;
  targetText: string;
  evidenceText: string;
  nextGoalText: string;
  confidenceScore: number;
  suggestedWeight: number;
}

export function evaluateProgression(
  prescription: ProgressionPrescription,
  previous: PreviousExercisePerformance,
): ProgressionEvaluation {
  const targetText = `Target: ${prescription.targetRepsMin}-${prescription.targetRepsMax} reps | RIR ${prescription.targetRir}`;
  const completed = completedSetsOf(previous.lastSets);
  let working = completed.filter((s) => s.setType === "Working");
  if (working.length === 0) working = completed;

  if (working.length === 0) {
    return {
      exerciseId: previous.exerciseId,
      exerciseName: previous.exerciseName,
      status: "No History",
      recommendation: "Start Conservative",
      reason: "No previous completed sets are available.",
      targetText,
      evidenceText: "No prior set data found.",
      nextGoalText: `Log all sets in the ${prescription.targetRepsMin}-${prescription.targetRepsMax} rep range.`,
      confidenceScore: 35,
      suggestedWeight: 0,
    };
  }

  const topWeight = Math.max(...working.map((s) => s.weight));
  const avgReps = working.reduce((sum, s) => sum + s.reps, 0) / working.length;
  const completedAtTopRepTarget = working.every((s) => s.reps >= prescription.targetRepsMax);
  const missedLowRepTarget = avgReps < prescription.targetRepsMin;

  const rirValues = working.filter((s) => s.rir != null).map((s) => s.rir as number);
  const averageRir = rirValues.length > 0
    ? rirValues.reduce((a, b) => a + b, 0) / rirValues.length
    : prescription.targetRir;
  const rirWasControlled = rirValues.length === 0 || averageRir >= prescription.targetRir;

  const evidenceText = `Last working sets averaged ${fmt1(avgReps)} reps (${prescription.targetRepsMin}-${prescription.targetRepsMax}) at up to ${fmt1(topWeight)} lb.`;

  if (completedAtTopRepTarget && rirWasControlled) {
    const increment = topWeight >= 100 ? 5 : 2.5;
    const suggestedWeight = topWeight + increment;
    return {
      exerciseId: previous.exerciseId,
      exerciseName: previous.exerciseName,
      status: "Progressing",
      recommendation: "Increase Weight",
      reason: "All working sets reached the top of the rep range with controlled RIR.",
      targetText,
      evidenceText,
      nextGoalText: `Try ${fmt1(suggestedWeight)} lb for ${prescription.targetRepsMin}-${prescription.targetRepsMax} reps.`,
      confidenceScore: rirValues.length === 0 ? 78 : 92,
      suggestedWeight,
    };
  }

  if (completedAtTopRepTarget) {
    return {
      exerciseId: previous.exerciseId,
      exerciseName: previous.exerciseName,
      status: "Progressing",
      recommendation: "Optional Increase",
      reason: "Top rep target was reached, but RIR suggests the load may already be challenging.",
      targetText,
      evidenceText,
      nextGoalText: `Repeat ${fmt1(topWeight)} lb or make a conservative increase if recovery is good.`,
      confidenceScore: 72,
      suggestedWeight: topWeight,
    };
  }

  if (missedLowRepTarget) {
    return {
      exerciseId: previous.exerciseId,
      exerciseName: previous.exerciseName,
      status: "Regressing",
      recommendation: "Repeat Or Reduce",
      reason: `Average reps were ${fmt1(avgReps)}, below the target range.`,
      targetText,
      evidenceText,
      nextGoalText: `Repeat ${fmt1(topWeight)} lb only if recovery is good; otherwise reduce slightly.`,
      confidenceScore: 84,
      suggestedWeight: topWeight,
    };
  }

  return {
    exerciseId: previous.exerciseId,
    exerciseName: previous.exerciseName,
    status: "Maintaining",
    recommendation: "Repeat Weight",
    reason: "Rep target has not been fully achieved yet.",
    targetText,
    evidenceText,
    nextGoalText: `Repeat ${fmt1(topWeight)} lb and try to add reps before increasing weight.`,
    confidenceScore: 86,
    suggestedWeight: topWeight,
  };
}

export function progressionDisplayText(p: ProgressionEvaluation): string {
  return p.suggestedWeight > 0
    ? `${p.recommendation}: ${fmt1(p.suggestedWeight)} lb | Confidence ${p.confidenceScore}% | ${p.reason}`
    : `${p.recommendation} | Confidence ${p.confidenceScore}% | ${p.reason}`;
}

// ---------------------------------------------------------------------------
// Goal-aware Coach V2
// ---------------------------------------------------------------------------

export interface GoalCoachingProfile {
  id: TrainingGoalId;
  label: string;
  progressionPriority: "reps" | "load" | "balanced" | "duration";
  readinessWeights: {
    recovery: number;
    trend: number;
    fatigue: number;
    volume: number;
    adherence: number;
    confidence: number;
  };
  usesHypertrophyVolume: boolean;
  requiresPrimaryCompound: boolean;
}

export const GOAL_COACHING_PROFILES: Record<TrainingGoalId, GoalCoachingProfile> = {
  hypertrophy: {
    id: "hypertrophy",
    label: "Hypertrophy",
    progressionPriority: "reps",
    readinessWeights: { recovery: 0.25, trend: 0.2, fatigue: 0.15, volume: 0.2, adherence: 0.1, confidence: 0.1 },
    usesHypertrophyVolume: true,
    requiresPrimaryCompound: false,
  },
  strength: {
    id: "strength",
    label: "Strength",
    progressionPriority: "load",
    readinessWeights: { recovery: 0.3, trend: 0.25, fatigue: 0.2, volume: 0.05, adherence: 0.1, confidence: 0.1 },
    usesHypertrophyVolume: false,
    requiresPrimaryCompound: true,
  },
  general_fitness: {
    id: "general_fitness",
    label: "General Fitness",
    progressionPriority: "balanced",
    readinessWeights: { recovery: 0.25, trend: 0.2, fatigue: 0.2, volume: 0.1, adherence: 0.15, confidence: 0.1 },
    usesHypertrophyVolume: false,
    requiresPrimaryCompound: false,
  },
  mobility: {
    id: "mobility",
    label: "Mobility",
    progressionPriority: "duration",
    readinessWeights: { recovery: 0.2, trend: 0.25, fatigue: 0.15, volume: 0.05, adherence: 0.25, confidence: 0.1 },
    usesHypertrophyVolume: false,
    requiresPrimaryCompound: false,
  },
  muscular_endurance: {
    id: "muscular_endurance",
    label: "Muscular Endurance",
    progressionPriority: "reps",
    readinessWeights: { recovery: 0.2, trend: 0.25, fatigue: 0.15, volume: 0.15, adherence: 0.15, confidence: 0.1 },
    usesHypertrophyVolume: false,
    requiresPrimaryCompound: false,
  },
};

export function resolveGoalCoachingProfile(goal: TrainingGoalId): GoalCoachingProfile {
  return GOAL_COACHING_PROFILES[goal] ?? GOAL_COACHING_PROFILES.hypertrophy;
}

export interface ExerciseExposureSummary {
  workoutId: number;
  performedAt: Date;
  totalReps: number;
  totalDurationSeconds: number;
  totalLoadVolume: number;
  topWeight: number;
  estimatedOneRepMax: number;
  workingSetCount: number;
  averageRir: number | null;
  rirCompleteness: number;
}

export interface ExerciseTrendEvaluation {
  status: "Learning" | "Improving" | "Stable" | "Regressing";
  exposureCount: number;
  exposures: ExerciseExposureSummary[];
  scoreChangePercent: number;
  averageRir: number | null;
  rirCompleteness: number;
  evidence: string;
}

function summarizeExposure(session: HistorySessionInput, exercise: HistoryExerciseInput): ExerciseExposureSummary | null {
  const working = completedSetsOf(exercise.sets).filter((set) => set.setType !== "Warmup");
  if (working.length === 0) return null;
  const rirValues = working.flatMap((set) => set.rir == null ? [] : [set.rir]);
  return {
    workoutId: session.id,
    performedAt: session.startedAt,
    totalReps: working.reduce((sum, set) => sum + set.reps, 0),
    totalDurationSeconds: working.reduce((sum, set) => sum + (set.durationSeconds ?? 0), 0),
    totalLoadVolume: working.reduce((sum, set) => sum + set.weight * set.reps, 0),
    topWeight: Math.max(...working.map((set) => set.weight)),
    estimatedOneRepMax: Math.max(...working.map((set) => estimateOneRepMax(set.weight, set.reps))),
    workingSetCount: working.length,
    averageRir: rirValues.length ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length : null,
    rirCompleteness: rirValues.length / working.length,
  };
}

function exposurePerformanceScore(exposure: ExerciseExposureSummary, goal: TrainingGoalId, trackingMode: TrackingMode): number {
  if (trackingMode === "duration" || goal === "mobility") return exposure.totalDurationSeconds || exposure.totalReps;
  if (goal === "strength") return exposure.estimatedOneRepMax;
  if (goal === "muscular_endurance") return exposure.totalReps + exposure.totalDurationSeconds / 10;
  if (goal === "hypertrophy") {
    // Total reps is the primary signal; a small load term recognizes productive
    // load increases without letting tonnage dominate exercise-to-exercise comparisons.
    return exposure.totalReps + exposure.topWeight * 0.08;
  }
  return exposure.totalReps + exposure.estimatedOneRepMax * 0.1;
}

export function evaluateExerciseTrend(
  history: HistorySessionInput[],
  exerciseId: number,
  goal: TrainingGoalId,
  trackingMode: TrackingMode,
  settings: Pick<CoachSettings, "minComparableExposures" | "trendHistoryLimit">,
): ExerciseTrendEvaluation {
  const exposures = history
    .map((session) => {
      const exercise = session.exercises.find((item) => item.exerciseId === exerciseId);
      return exercise ? summarizeExposure(session, exercise) : null;
    })
    .filter((item): item is ExerciseExposureSummary => item != null)
    .sort((a, b) => a.performedAt.getTime() - b.performedAt.getTime())
    .slice(-settings.trendHistoryLimit);

  const averageRirValues = exposures.flatMap((item) => item.averageRir == null ? [] : [item.averageRir]);
  const averageRir = averageRirValues.length
    ? averageRirValues.reduce((sum, value) => sum + value, 0) / averageRirValues.length
    : null;
  const rirCompleteness = exposures.length
    ? exposures.reduce((sum, item) => sum + item.rirCompleteness, 0) / exposures.length
    : 0;

  if (exposures.length < settings.minComparableExposures) {
    return {
      status: "Learning",
      exposureCount: exposures.length,
      exposures,
      scoreChangePercent: 0,
      averageRir,
      rirCompleteness,
      evidence: `${exposures.length}/${settings.minComparableExposures} comparable exposures logged.`,
    };
  }

  const scores = exposures.map((item) => exposurePerformanceScore(item, goal, trackingMode));
  const split = Math.max(1, Math.floor(scores.length / 2));
  const early = scores.slice(0, split).reduce((sum, value) => sum + value, 0) / split;
  const recentSlice = scores.slice(-split);
  const recent = recentSlice.reduce((sum, value) => sum + value, 0) / recentSlice.length;
  const scoreChangePercent = early > 0 ? ((recent - early) / early) * 100 : 0;
  const status = scoreChangePercent >= 3
    ? "Improving"
    : scoreChangePercent <= -5
      ? "Regressing"
      : "Stable";
  return {
    status,
    exposureCount: exposures.length,
    exposures,
    scoreChangePercent,
    averageRir,
    rirCompleteness,
    evidence: `${status} across ${exposures.length} comparable exposures (${scoreChangePercent >= 0 ? "+" : ""}${fmt1(scoreChangePercent)}%).`,
  };
}

export interface ConfidenceFactor {
  label: string;
  score: number;
  detail: string;
}

export function calculateCoachingConfidence(trend: ExerciseTrendEvaluation): { score: number; factors: ConfidenceFactor[] } {
  const exposureScore = Math.min(100, trend.exposureCount * 20);
  const rirScore = Math.round(trend.rirCompleteness * 100);
  const consistencyScore = trend.status === "Learning" ? 45 : trend.status === "Stable" ? 90 : 82;
  const factors: ConfidenceFactor[] = [
    { label: "Comparable history", score: exposureScore, detail: `${trend.exposureCount} exposures` },
    { label: "RIR coverage", score: rirScore, detail: `${Math.round(trend.rirCompleteness * 100)}% of working sets` },
    { label: "Trend clarity", score: consistencyScore, detail: trend.status },
  ];
  return {
    score: Math.round(exposureScore * 0.5 + rirScore * 0.25 + consistencyScore * 0.25),
    factors,
  };
}

export interface MuscleVolumeContext {
  muscleGroupId: number;
  muscleName: string;
  currentEffectiveSets: number;
  mev: number;
  mav: number;
  mrv: number;
  status: "under" | "optimal" | "high" | "excessive";
  learnedLow?: number | null;
  learnedHigh?: number | null;
  learnedConfidence?: number;
}

export interface GoalAwareProgressionInput {
  goal: TrainingGoalId;
  trackingMode: TrackingMode;
  prescription: ProgressionPrescription & {
    targetSets?: number;
    targetDurationMinSeconds?: number | null;
    targetDurationMaxSeconds?: number | null;
  };
  previous: PreviousExercisePerformance;
  trend: ExerciseTrendEvaluation;
  settings: CoachSettings;
  recovery: MuscleRecoveryState;
  fatigue: FatigueSignal;
  volumeContext?: MuscleVolumeContext | null;
}

export interface GoalAwareProgressionEvaluation extends ProgressionEvaluation {
  trend: ExerciseTrendEvaluation["status"];
  trendEvidence: string;
  confidenceFactors: ConfidenceFactor[];
  setRecommendation: "Add Set" | "Maintain Sets" | "Reduce Set" | "Learning";
  prescribedSets: number;
  prescribedRirMin: number;
  prescribedRirMax: number;
  volumeContext?: MuscleVolumeContext | null;
}

export function evaluateGoalAwareProgression(input: GoalAwareProgressionInput): GoalAwareProgressionEvaluation {
  const { goal, trackingMode, prescription, previous, trend, settings, recovery, fatigue, volumeContext } = input;
  const base = evaluateProgression(prescription, previous);
  const confidence = calculateCoachingConfidence(trend);
  const latest = trend.exposures.at(-1);
  const templateRir = prescription.targetRir;
  const rirMin = templateRir != null ? templateRir : settings.preferredRirMin;
  const rirMax = templateRir != null ? templateRir : settings.preferredRirMax;
  let recommendation = base.recommendation;
  let reason = base.reason;
  let nextGoalText = base.nextGoalText;
  let suggestedWeight = base.suggestedWeight;

  if (trackingMode === "duration") {
    const targetMax = prescription.targetDurationMaxSeconds ?? 60;
    const bestDuration = latest?.totalDurationSeconds ?? 0;
    recommendation = bestDuration >= targetMax ? "Increase Hold Duration" : "Add Hold Time";
    reason = `${trend.evidence} Duration is the relevant progression signal for this exercise.`;
    nextGoalText = bestDuration > 0
      ? `Add 5-${bestDuration >= targetMax ? 10 : 5} seconds while maintaining control.`
      : `Start within ${prescription.targetDurationMinSeconds ?? 20}-${targetMax} seconds.`;
    suggestedWeight = latest?.topWeight ?? 0;
  } else if (trend.status === "Regressing") {
    recommendation = recovery.fatiguePercent >= 55 || fatigue.riskScore >= 55 ? "Reduce Or Delay" : "Repeat Or Reduce";
    reason = `${trend.evidence} Avoid forcing progression until performance stabilizes.`;
    nextGoalText = "Repeat the prior load with cleaner execution, or reduce load/sets if the decline continues.";
  } else if (goal === "strength" && trend.status === "Improving" && recovery.fatiguePercent < 55) {
    recommendation = "Increase Weight";
    const current = latest?.topWeight ?? base.suggestedWeight;
    suggestedWeight = current > 0 ? current + (current >= 100 ? 5 : 2.5) : base.suggestedWeight;
    reason = `${trend.evidence} Estimated strength and recovery support a conservative load increase.`;
    nextGoalText = `Try ${fmt1(suggestedWeight)} lb while staying at RIR ${rirMin}-${rirMax}.`;
  } else if (goal === "muscular_endurance" && trend.status === "Improving" && settings.progressionStyle !== "load_first") {
    recommendation = "Add Reps";
    reason = `${trend.evidence} Endurance coaching prioritizes total repetitions before load.`;
    nextGoalText = `Keep the load and add 2-5 total reps while staying at RIR ${rirMin}-${rirMax}.`;
  } else if (goal === "hypertrophy" && trend.status === "Improving" && !base.recommendation.includes("Increase")) {
    recommendation = "Add Reps";
    reason = `${trend.evidence} Progress is occurring before every set has reached the top of the range.`;
    nextGoalText = `Keep the load and add 1-2 total reps while staying at RIR ${rirMin}-${rirMax}.`;
  } else if (goal === "mobility") {
    recommendation = trend.status === "Improving" ? "Increase Control" : "Maintain";
    reason = `${trend.evidence} Forge is using duration and consistency, not hypertrophy volume, for this goal.`;
    nextGoalText = "Maintain controlled execution and add duration or repetitions only when quality remains stable.";
  } else if (settings.progressionStyle === "rep_first" && recommendation === "Optional Increase") {
    recommendation = "Add Reps";
    nextGoalText = `Repeat the load and improve total repetitions at RIR ${rirMin}-${rirMax}.`;
  } else if (settings.progressionStyle === "load_first" && trend.status === "Improving" && recovery.fatiguePercent < 45) {
    recommendation = "Increase Weight";
  }

  let setRecommendation: GoalAwareProgressionEvaluation["setRecommendation"] = "Learning";
  const enoughHistory = trend.exposureCount >= settings.minComparableExposures;
  if (enoughHistory) {
    if (trend.status === "Regressing" || recovery.fatiguePercent >= 65 || fatigue.riskScore >= 70 || volumeContext?.status === "excessive") {
      setRecommendation = "Reduce Set";
    } else if (
      goal === "hypertrophy" &&
      trend.status === "Improving" &&
      recovery.fatiguePercent <= 35 &&
      volumeContext?.status === "under"
    ) {
      setRecommendation = settings.volumeProgressionSensitivity === "conservative" ? "Maintain Sets" : "Add Set";
    } else {
      setRecommendation = "Maintain Sets";
    }
  }

  const targetSets = prescription.targetSets ?? latest?.workingSetCount ?? 3;
  const prescribedSets = Math.max(1, targetSets + (setRecommendation === "Add Set" ? 1 : setRecommendation === "Reduce Set" ? -1 : 0));
  return {
    ...base,
    status: trackingMode === "duration"
      ? trend.status === "Improving"
        ? "Progressing"
        : trend.status === "Regressing"
          ? "Regressing"
          : latest
            ? "Maintaining"
            : "No History"
      : trend.status === "Improving"
        ? "Progressing"
        : trend.status === "Regressing"
          ? "Regressing"
          : base.status,
    recommendation,
    reason,
    nextGoalText,
    confidenceScore: confidence.score,
    suggestedWeight,
    targetText: trackingMode === "duration"
      ? `Target: ${prescription.targetDurationMinSeconds ?? 20}-${prescription.targetDurationMaxSeconds ?? 60} seconds | RIR ${rirMin}-${rirMax}`
      : base.targetText,
    trend: trend.status,
    trendEvidence: trend.evidence,
    confidenceFactors: confidence.factors,
    setRecommendation,
    prescribedSets,
    prescribedRirMin: rirMin,
    prescribedRirMax: rirMax,
    volumeContext,
  };
}

// ---------------------------------------------------------------------------
// 2. RecoveryEngine — evaluateRecovery
// ---------------------------------------------------------------------------

export interface MuscleRecoveryState {
  muscle: MuscleGroupName;
  displayName: string;
  fatiguePercent: number;
  recoveryPercent: number;
  lastTrainedAt: Date | null;
  hoursSinceLastTrained: number;
  status: "Recovered" | "Recovering" | "Needs Rest";
  summary: string;
}

export const RECOVERY_HALF_LIFE_HOURS: Record<MuscleGroupName, number> = {
  UpperChest: 48,
  MidLowerChest: 48,
  Lats: 48,
  UpperMidBack: 48,
  Traps: 40,
  SpinalErectors: 72,
  FrontDelts: 40,
  SideDelts: 40,
  RearDelts: 40,
  Biceps: 40,
  Triceps: 40,
  Forearms: 30,
  Quads: 60,
  Hamstrings: 60,
  Glutes: 60,
  Adductors: 40,
  Abductors: 40,
  Calves: 30,
  Abs: 30,
  Obliques: 40,
};

export interface RecoveryModelOverrides {
  muscleHalfLifeHours?: Partial<Record<MuscleGroupName, number>>;
  exerciseFatigueCosts?: Record<number, number>;
  failureFatigueMultiplier?: number;
}

function resolveDecay(
  muscle: MuscleGroupName,
  hoursAgo: number,
  settings: RecoverySettings,
  overrides?: RecoveryModelOverrides,
): number {
  const muscleSpeed = settings.muscleRecoverySpeeds[muscle] ?? 1;
  const effectiveSpeed = settings.overallRecoverySpeed * muscleSpeed;
  const baseHalfLife = overrides?.muscleHalfLifeHours?.[muscle] ?? RECOVERY_HALF_LIFE_HOURS[muscle] ?? 40;
  const halfLife = baseHalfLife / effectiveSpeed;
  return Math.pow(0.5, hoursAgo / halfLife);
}

export const INTENSITY_TECHNIQUE_MODELS: Record<string, { stimulusMultiplier: number; fatigueMultiplier: number }> = {
  normal: { stimulusMultiplier: 1, fatigueMultiplier: 1 },
  "drop set": { stimulusMultiplier: 1.12, fatigueMultiplier: 1.22 },
  "rest pause": { stimulusMultiplier: 1.1, fatigueMultiplier: 1.2 },
  "myo reps": { stimulusMultiplier: 1.12, fatigueMultiplier: 1.18 },
  superset: { stimulusMultiplier: 1.05, fatigueMultiplier: 1.12 },
  "lengthened partials": { stimulusMultiplier: 1.1, fatigueMultiplier: 1.12 },
};

function estimateFatigue(ex: HistoryExerciseInput, overrides?: RecoveryModelOverrides): number {
  const completed = completedSetsOf(ex.sets).filter((set) => set.setType !== "Warmup");
  const setLoad = completed.length * 8;
  const rirVals = completed.filter((s) => s.rir != null).map((s) => s.rir as number);
  const averageRir = rirVals.length > 0 ? rirVals.reduce((a, b) => a + b, 0) / rirVals.length : 2;
  const rirPenalty = Math.min(Math.max(4 - averageRir, 0), 4) * 2;
  const technique = INTENSITY_TECHNIQUE_MODELS[ex.intensityTechnique?.toLowerCase()] ?? INTENSITY_TECHNIQUE_MODELS.normal;
  const failureBonus = ex.failureTarget && ex.failureTarget !== "Never"
    ? 4 * (overrides?.failureFatigueMultiplier ?? 1)
    : 0;
  const volume = completed.reduce((sum, s) => sum + s.weight * s.reps, 0);
  const volumeBonus = volume > 0 ? Math.min(10, volume / 800) : 0;
  const exerciseCost = overrides?.exerciseFatigueCosts?.[ex.exerciseId] ?? 1;
  const result = (setLoad + rirPenalty + failureBonus + volumeBonus) * technique.fatigueMultiplier * exerciseCost;
  return Math.min(Math.max(result, 4), 45);
}

/** Map from muscle group id -> MuscleGroupName, and reverse. Passed in from callers with DB access. */
export interface MuscleGroupLookup {
  idToName: Map<number, MuscleGroupName>;
}

export function evaluateRecovery(
  history: HistorySessionInput[],
  lookup: MuscleGroupLookup,
  now: Date = new Date(),
  settings: RecoverySettings = DEFAULT_RECOVERY_SETTINGS,
  overrides?: RecoveryModelOverrides,
): MuscleRecoveryState[] {
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const recentSessions = history.filter((s) => s.startedAt >= tenDaysAgo);

  const fatigueSum = new Map<MuscleGroupName, number>();
  const lastTrained = new Map<MuscleGroupName, Date>();

  for (const session of recentSessions) {
    const hoursAgo = Math.max(0, (now.getTime() - session.startedAt.getTime()) / (1000 * 60 * 60));
    for (const ex of session.exercises) {
      const completed = completedSetsOf(ex.sets).filter((set) => set.setType !== "Warmup");
      if (completed.length === 0) continue;

      const baseFatigue = estimateFatigue(ex, overrides) * settings.fatigueSensitivity;
      const stimulus = ex.stimulus?.length
        ? ex.stimulus
        : [{ muscleGroupId: ex.primaryMuscleGroupId, stimulusRatio: 1 }];
      for (const row of stimulus) {
        if (row.stimulusRatio <= 0) continue;
        const muscle = lookup.idToName.get(row.muscleGroupId);
        if (!muscle) continue;
        const decayed = baseFatigue * row.stimulusRatio * resolveDecay(muscle, hoursAgo, settings, overrides);
        fatigueSum.set(muscle, (fatigueSum.get(muscle) ?? 0) + decayed);
        if (!lastTrained.has(muscle) || session.startedAt > lastTrained.get(muscle)!) {
          lastTrained.set(muscle, session.startedAt);
        }
      }
    }
  }

  return muscleGroupNames.map((muscle) => {
    const displayName = muscleGroupDisplayNames[muscle];
    const rawFatigue = fatigueSum.get(muscle) ?? 0;
    const fatiguePercent = Math.min(Math.max(Math.round(rawFatigue), 0), 100);
    const recoveryPercent = 100 - fatiguePercent;
    const last = lastTrained.get(muscle) ?? null;
    const hoursSinceLastTrained = last ? Math.max(0, (now.getTime() - last.getTime()) / (1000 * 60 * 60)) : 0;

    let status: MuscleRecoveryState["status"];
    if (fatiguePercent <= 25) status = "Recovered";
    else if (fatiguePercent <= 60) status = "Recovering";
    else status = "Needs Rest";

    const summary = last
      ? `${displayName} recovery ${recoveryPercent}% - ${status}. Last trained ${Math.round(hoursSinceLastTrained)}h ago.`
      : `${displayName} has no recent fatigue logged.`;

    return {
      muscle,
      displayName,
      fatiguePercent,
      recoveryPercent,
      lastTrainedAt: last,
      hoursSinceLastTrained,
      status,
      summary,
    };
  });
}

/** Look up recovery state for a specific muscle group id (used for a given exercise's primary muscle). */
export function getPrimaryRecovery(
  states: MuscleRecoveryState[],
  muscle: MuscleGroupName,
): MuscleRecoveryState {
  return (
    states.find((s) => s.muscle === muscle) ?? {
      muscle,
      displayName: muscleGroupDisplayNames[muscle],
      fatiguePercent: 0,
      recoveryPercent: 100,
      lastTrainedAt: null,
      hoursSinceLastTrained: 0,
      status: "Recovered",
      summary: `${muscleGroupDisplayNames[muscle]} has no recent fatigue logged.`,
    }
  );
}

// ---------------------------------------------------------------------------
// 3. FatigueEngine — evaluateFatigueTrend
// ---------------------------------------------------------------------------

export interface FatigueSignal {
  status: "Learning" | "Stable" | "Watch Trend" | "Fatigue Risk";
  summary: string;
  riskScore: number;
  deloadSuggested: boolean;
  evidence?: string[];
}

export function evaluateFatigueTrend(
  history: HistorySessionInput[],
  sensitivity: CoachSettings["fatigueSensitivity"] = "normal",
): FatigueSignal {
  if (history.length < 3) {
    return {
      status: "Learning",
      summary: "Log at least three workouts before fatigue trends are evaluated.",
      riskScore: 10,
      deloadSuggested: false,
      evidence: ["Fewer than three workouts are available."],
    };
  }

  // Compare like with like: repeated exposures of the same exercise, never raw
  // tonnage from unrelated Push/Pull/Legs sessions.
  const byExercise = new Map<number, { name: string; values: number[] }>();
  for (const session of [...history].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
    for (const exercise of session.exercises) {
      const summary = summarizeExposure(session, exercise);
      if (!summary) continue;
      const value = exercise.trackingMode === "duration"
        ? summary.totalDurationSeconds
        : summary.estimatedOneRepMax + summary.totalReps * 0.15;
      const item = byExercise.get(exercise.exerciseId) ?? { name: exercise.exerciseName, values: [] };
      item.values.push(value);
      byExercise.set(exercise.exerciseId, item);
    }
  }

  const regressing: string[] = [];
  for (const item of Array.from(byExercise.values())) {
    const last = item.values.slice(-3);
    if (last.length < 3 || last[0] <= 0 || last[1] <= 0) continue;
    const firstDrop = (last[1] - last[0]) / last[0];
    const secondDrop = (last[2] - last[1]) / last[1];
    if (firstDrop <= -0.04 && secondDrop <= -0.04) regressing.push(item.name);
  }

  const templateRegressions: string[] = [];
  const byTemplate = new Map<number, HistorySessionInput[]>();
  for (const session of history) {
    if (session.workoutTemplateId == null) continue;
    const list = byTemplate.get(session.workoutTemplateId) ?? [];
    list.push(session);
    byTemplate.set(session.workoutTemplateId, list);
  }
  for (const sessions of Array.from(byTemplate.values())) {
    const last = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()).slice(-3);
    if (last.length < 3) continue;
    const scores = last.map((session) => {
      const values = session.exercises.flatMap((exercise) => {
        const summary = summarizeExposure(session, exercise);
        return summary ? [exercise.trackingMode === "duration" ? summary.totalDurationSeconds : summary.estimatedOneRepMax] : [];
      });
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    });
    if (scores[0] > 0 && scores[1] < scores[0] * 0.96 && scores[2] < scores[1] * 0.96) {
      templateRegressions.push(last[2].workoutName);
    }
  }

  const recentExercises = [...history]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 3)
    .flatMap((session) => session.exercises);
  const workingSets = recentExercises.flatMap((exercise) => completedSetsOf(exercise.sets).filter((set) => set.setType !== "Warmup"));
  const lowRirRate = workingSets.length
    ? workingSets.filter((set) => set.rir != null && set.rir <= 0).length / workingSets.length
    : 0;

  const evidence: string[] = [];
  if (regressing.length) evidence.push(`Repeated exercise regression: ${regressing.slice(0, 3).join(", ")}.`);
  if (templateRegressions.length) evidence.push(`Repeated template regression: ${templateRegressions.slice(0, 2).join(", ")}.`);
  if (lowRirRate >= 0.3) evidence.push(`${Math.round(lowRirRate * 100)}% of recent working sets reached RIR 0.`);
  if (!evidence.length) evidence.push("No repeated same-exercise or same-template decline detected.");

  const sensitivityMultiplier = sensitivity === "low" ? 0.8 : sensitivity === "high" ? 1.2 : 1;
  let riskScore = 15 + Math.min(45, regressing.length * 18) + Math.min(20, templateRegressions.length * 20) + (lowRirRate >= 0.3 ? 15 : 0);
  riskScore = Math.min(100, Math.round(riskScore * sensitivityMultiplier));

  if (riskScore >= 70) {
    return {
      status: "Fatigue Risk",
      summary: "Recent workout performance is declining across multiple sessions. Consider extra recovery or a lighter session.",
      riskScore,
      deloadSuggested: true,
      evidence,
    };
  }
  if (riskScore >= 45) {
    return {
      status: "Watch Trend",
      summary: "Some recent performance markers are trending down. Monitor recovery and avoid forcing progression.",
      riskScore,
      deloadSuggested: false,
      evidence,
    };
  }
  return {
    status: "Stable",
    summary: "Recent workout performance does not show a meaningful fatigue trend.",
    riskScore,
    deloadSuggested: false,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// 4. ReadinessEngine — evaluateReadiness
// ---------------------------------------------------------------------------

export interface ReadinessEvaluation {
  score: number;
  status: "Excellent" | "Ready" | "Caution" | "Needs Rest";
  summary: string;
  guidance: string;
}

export function evaluateReadiness(
  previous: PreviousExercisePerformance,
  progression: ProgressionEvaluation,
  recovery: MuscleRecoveryState,
): ReadinessEvaluation {
  const recoveryScore = Math.min(Math.max(recovery.recoveryPercent, 0), 100);
  const confidenceScore = Math.min(Math.max(progression.confidenceScore, 0), 100);
  const historyScore = previous.lastSets.length > 0 ? 100 : 72;

  let recommendationAdjustment: number;
  const recLower = progression.recommendation.toLowerCase();
  if (recovery.fatiguePercent >= 75 || recLower.includes("delay")) {
    recommendationAdjustment = 25;
  } else if (recovery.fatiguePercent >= 55 || recLower.includes("hold")) {
    recommendationAdjustment = 55;
  } else if (recLower.includes("increase")) {
    recommendationAdjustment = 95;
  } else {
    recommendationAdjustment = 78;
  }

  const score = Math.min(
    Math.max(
      Math.round(
        recoveryScore * 0.6 + confidenceScore * 0.2 + historyScore * 0.1 + recommendationAdjustment * 0.1,
      ),
      0,
    ),
    100,
  );

  let status: ReadinessEvaluation["status"];
  if (score >= 85) status = "Excellent";
  else if (score >= 70) status = "Ready";
  else if (score >= 55) status = "Caution";
  else status = "Needs Rest";

  const summary = `Readiness ${score}% - ${status}. ${recovery.displayName} recovery is ${recovery.recoveryPercent}% with ${recovery.fatiguePercent}% fatigue. Confidence is ${confidenceScore}%.`;

  let guidance: string;
  if (score >= 85) {
    guidance = recLower.includes("increase")
      ? "Green light for normal progression if warm-ups feel strong."
      : "Train normally and use clean execution as the limiter.";
  } else if (score >= 70) {
    guidance = "Proceed with the planned work, but avoid forcing extra volume.";
  } else if (score >= 55) {
    guidance = "Use caution: hold load, reduce intensity techniques, or trim one working set if performance drops.";
  } else {
    guidance = `Consider delaying or reducing ${recovery.displayName} work today.`;
  }

  return { score, status, summary, guidance };
}

export function evaluateGoalAwareReadiness(args: {
  goal: TrainingGoalId;
  recovery: MuscleRecoveryState;
  trend: ExerciseTrendEvaluation;
  fatigue: FatigueSignal;
  volumeContext?: MuscleVolumeContext | null;
  confidenceScore: number;
  prescriptionAdherence?: number;
}): ReadinessEvaluation {
  const profile = resolveGoalCoachingProfile(args.goal);
  const trendScore = args.trend.status === "Improving" ? 95 : args.trend.status === "Stable" ? 80 : args.trend.status === "Regressing" ? 35 : 60;
  const fatigueScore = 100 - args.fatigue.riskScore;
  const volumeScore = !args.volumeContext
    ? 75
    : args.volumeContext.status === "optimal"
      ? 95
      : args.volumeContext.status === "under"
        ? 75
        : args.volumeContext.status === "high"
          ? 65
          : 30;
  const adherenceScore = Math.min(100, Math.max(0, args.prescriptionAdherence ?? 80));
  const inputs = {
    recovery: args.recovery.recoveryPercent,
    trend: trendScore,
    fatigue: fatigueScore,
    volume: volumeScore,
    adherence: adherenceScore,
    confidence: args.confidenceScore,
  };
  const score = Math.round(Object.entries(profile.readinessWeights).reduce(
    (sum, [key, weight]) => sum + inputs[key as keyof typeof inputs] * weight,
    0,
  ));
  const status: ReadinessEvaluation["status"] = score >= 85 ? "Excellent" : score >= 70 ? "Ready" : score >= 55 ? "Caution" : "Needs Rest";
  const guidance = status === "Excellent"
    ? "Proceed with the planned progression if warm-ups confirm readiness."
    : status === "Ready"
      ? "Train as planned and keep the prescribed RIR as the limiter."
      : status === "Caution"
        ? "Hold load or trim a working set if performance is below trend."
        : `Delay or substantially reduce ${args.recovery.displayName} work.`;
  return {
    score,
    status,
    summary: `Readiness ${score}% - ${status}. Recovery, ${args.trend.status.toLowerCase()} exercise trend, fatigue risk, volume, adherence, and data confidence were evaluated for ${profile.label}.`,
    guidance,
  };
}

// ---------------------------------------------------------------------------
// 5. PersonalRecordEngine — getPersonalRecords
// ---------------------------------------------------------------------------

export interface PersonalRecord {
  exerciseName: string;
  recordType: "Heaviest Set" | "Estimated 1RM" | "Best Set Volume" | "Exercise Volume" | "Longest Hold";
  displayValue: string;
  achievedAt: Date;
}

export function personalRecordSummary(r: PersonalRecord): string {
  return r.exerciseName
    ? `${r.exerciseName}: ${r.recordType} - ${r.displayValue}`
    : `${r.recordType}: ${r.displayValue}`;
}

export function getPersonalRecords(
  history: HistorySessionInput[],
  take: number = 5,
): PersonalRecord[] {
  // Chronological ascending (oldest first)
  const sessionsAsc = [...history].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const bestWeight = new Map<number, number>();
  const bestE1RM = new Map<number, number>();
  const bestSetVolume = new Map<number, number>();
  const bestExerciseVolume = new Map<number, number>();
  const bestHoldDuration = new Map<number, number>();
  const records: PersonalRecord[] = [];

  const addIfNew = (
    map: Map<number, number>,
    exerciseId: number,
    value: number,
    exerciseName: string,
    recordType: PersonalRecord["recordType"],
    displayValue: string,
    achievedAt: Date,
  ) => {
    if (value <= 0) return;
    const prevBest = map.get(exerciseId);
    if (prevBest === undefined) {
      map.set(exerciseId, value);
      return; // first occurrence establishes baseline, not a PR event
    }
    if (value <= prevBest) return;
    map.set(exerciseId, value);
    records.push({ exerciseName, recordType, displayValue, achievedAt });
  };

  for (const session of sessionsAsc) {
    for (const ex of session.exercises) {
      const completed = completedSetsOf(ex.sets);
      if (completed.length === 0) continue;

      if (ex.trackingMode === "duration") {
        const workingHolds = completed.filter((set) => set.setType !== "Warmup");
        if (workingHolds.length === 0) continue;
        const longestHold = Math.max(...workingHolds.map((set) => set.durationSeconds ?? 0));
        addIfNew(
          bestHoldDuration,
          ex.exerciseId,
          longestHold,
          ex.exerciseName,
          "Longest Hold",
          `${longestHold} sec`,
          session.startedAt,
        );
        continue;
      }

      const heaviestSet = [...completed].sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return b.reps - a.reps;
      })[0];
      const bestOneRepMax = Math.max(...completed.map((s) => estimateOneRepMax(s.weight, s.reps)));
      const bestSetVol = Math.max(...completed.map((s) => s.weight * s.reps));
      const exVolume = completed.reduce((sum, s) => sum + s.weight * s.reps, 0);

      addIfNew(
        bestWeight,
        ex.exerciseId,
        heaviestSet.weight,
        ex.exerciseName,
        "Heaviest Set",
        `${fmt1(heaviestSet.weight)} x ${heaviestSet.reps}`,
        session.startedAt,
      );
      addIfNew(
        bestE1RM,
        ex.exerciseId,
        bestOneRepMax,
        ex.exerciseName,
        "Estimated 1RM",
        `${fmt1(bestOneRepMax)} lb`,
        session.startedAt,
      );
      addIfNew(
        bestSetVolume,
        ex.exerciseId,
        bestSetVol,
        ex.exerciseName,
        "Best Set Volume",
        fmt1(bestSetVol),
        session.startedAt,
      );
      addIfNew(
        bestExerciseVolume,
        ex.exerciseId,
        exVolume,
        ex.exerciseName,
        "Exercise Volume",
        fmt1(exVolume),
        session.startedAt,
      );
    }
  }

  return records
    .sort((a, b) => b.achievedAt.getTime() - a.achievedAt.getTime())
    .slice(0, take);
}

// ---------------------------------------------------------------------------
// 5b. Live PR check — used at set-save time to flag a newly logged set as a
// personal record immediately, without waiting for a Progress-page re-scan.
// Lighter than getPersonalRecords(): only needs prior working sets for ONE
// exercise, not the full session history.
// ---------------------------------------------------------------------------

export interface LivePrCheckInput {
  weight: number;
  reps: number;
  durationSeconds?: number | null;
  trackingMode?: TrackingMode;
  isWarmup: boolean;
}

export interface LivePrResult {
  isPr: boolean;
  recordType?: "Heaviest Set" | "Estimated 1RM" | "Longest Hold";
  displayValue?: string;
  previousBest?: string;
}

/**
 * Compare a just-logged set against the exercise's prior working sets and
 * report whether it's a new heaviest-weight or estimated-1RM personal record.
 * `priorSets` must NOT include the set being checked. Warmup sets are
 * ignored on both sides — PRs only apply to working sets.
 */
export function checkLivePersonalRecord(
  newSet: LivePrCheckInput,
  priorSets: LivePrCheckInput[],
): LivePrResult {
  if (newSet.trackingMode === "duration") {
    const duration = newSet.durationSeconds ?? 0;
    if (newSet.isWarmup || duration <= 0) return { isPr: false };
    const priorWorking = priorSets.filter(
      (set) => !set.isWarmup && set.trackingMode === "duration" && (set.durationSeconds ?? 0) > 0,
    );
    if (priorWorking.length === 0) return { isPr: false };
    const previous = Math.max(...priorWorking.map((set) => set.durationSeconds ?? 0));
    return duration > previous
      ? { isPr: true, recordType: "Longest Hold", displayValue: `${duration} sec`, previousBest: `${previous} sec` }
      : { isPr: false };
  }
  if (newSet.isWarmup || newSet.weight <= 0 || newSet.reps <= 0) {
    return { isPr: false };
  }
  const priorWorking = priorSets.filter((s) => !s.isWarmup && s.weight > 0 && s.reps > 0);

  // No history yet — first working set ever logged establishes a baseline,
  // not a PR event (mirrors getPersonalRecords()'s "first occurrence" rule).
  if (priorWorking.length === 0) return { isPr: false };

  const prevBestWeight = Math.max(...priorWorking.map((s) => s.weight));
  if (newSet.weight > prevBestWeight) {
    return {
      isPr: true,
      recordType: "Heaviest Set",
      displayValue: `${fmt1(newSet.weight)} x ${newSet.reps}`,
      previousBest: `${fmt1(prevBestWeight)} lb`,
    };
  }

  const newE1rm = estimateOneRepMax(newSet.weight, newSet.reps);
  const prevBestE1rm = Math.max(...priorWorking.map((s) => estimateOneRepMax(s.weight, s.reps)));
  if (newE1rm > prevBestE1rm) {
    return {
      isPr: true,
      recordType: "Estimated 1RM",
      displayValue: `${fmt1(newE1rm)} lb e1RM`,
      previousBest: `${fmt1(prevBestE1rm)} lb`,
    };
  }

  return { isPr: false };
}

/**
 * Given a chronologically-ordered (oldest first) list of sets for a single
 * exercise, return the ids of sets that were a personal record (heaviest
 * weight OR best e1RM) at the moment they were logged. Used to render PR
 * badges next to historical sets, consistent with checkLivePersonalRecord's
 * rules (warmups never count, first working set is a baseline not a PR).
 */
export function markHistoricalPrs<T extends LivePrCheckInput & { id: number }>(
  setsChronological: T[],
): Set<number> {
  const prIds = new Set<number>();
  let bestWeight = -Infinity;
  let bestE1rm = -Infinity;
  let bestDuration = -Infinity;
  let seenAny = false;

  for (const s of setsChronological) {
    if (s.trackingMode === "duration") {
      const duration = s.durationSeconds ?? 0;
      if (s.isWarmup || duration <= 0) continue;
      if (!seenAny) {
        seenAny = true;
        bestDuration = duration;
        continue;
      }
      if (duration > bestDuration) prIds.add(s.id);
      bestDuration = Math.max(bestDuration, duration);
      continue;
    }
    if (s.isWarmup || s.weight <= 0 || s.reps <= 0) continue;
    if (!seenAny) {
      seenAny = true;
      bestWeight = s.weight;
      bestE1rm = estimateOneRepMax(s.weight, s.reps);
      continue; // baseline, not a PR
    }
    const e1rm = estimateOneRepMax(s.weight, s.reps);
    if (s.weight > bestWeight || e1rm > bestE1rm) {
      prIds.add(s.id);
    }
    bestWeight = Math.max(bestWeight, s.weight);
    bestE1rm = Math.max(bestE1rm, e1rm);
  }
  return prIds;
}

// ---------------------------------------------------------------------------
// 6. WorkoutRecommendationEngine — buildWorkoutSuggestion
// ---------------------------------------------------------------------------

export interface WorkoutExerciseSuggestion {
  exerciseName: string;
  lastPerformance: string;
  recommendation: string;
  suggestedGoal: string;
  reason: string;
  evidenceText: string;
  nextGoalText: string;
  confidenceScore: number;
  recoveryStatus: string;
  recoveryText: string;
  recoveryPercent: number;
  fatiguePercent: number;
  readinessScore: number;
  readinessStatus: string;
  readinessText: string;
  readinessGuidance: string;
  goal?: TrainingGoalId;
  goalLabel?: string;
  trackingMode?: TrackingMode;
  trend?: ExerciseTrendEvaluation["status"];
  trendEvidence?: string;
  setRecommendation?: GoalAwareProgressionEvaluation["setRecommendation"];
  prescribedSets?: number;
  prescribedRirMin?: number;
  prescribedRirMax?: number;
  confidenceFactors?: ConfidenceFactor[];
  volumeContext?: MuscleVolumeContext | null;
  stimulusQuality?: "Understimulated" | "Productive" | "High Stimulus" | "Excessive Fatigue" | "Learning";
}

export function buildWorkoutSuggestion(
  prescription: ProgressionPrescription,
  previous: PreviousExercisePerformance,
  progression: ProgressionEvaluation,
  recovery: MuscleRecoveryState,
): WorkoutExerciseSuggestion {
  const suggestion: WorkoutExerciseSuggestion = {
    exerciseName: previous.exerciseName || progression.exerciseName,
    lastPerformance: lastPerformanceText(previous),
    suggestedGoal:
      progression.suggestedWeight > 0
        ? `${fmt1(progression.suggestedWeight)} lb x ${prescription.targetRepsMin}-${prescription.targetRepsMax}`
        : `${prescription.targetRepsMin}-${prescription.targetRepsMax} reps`,
    recommendation: progression.recommendation,
    reason: progression.reason,
    evidenceText: progression.evidenceText,
    nextGoalText: progression.nextGoalText,
    confidenceScore: progression.confidenceScore,
    recoveryStatus: recovery.status,
    recoveryText: `${recovery.displayName} recovery: ${recovery.recoveryPercent}%`,
    recoveryPercent: recovery.recoveryPercent,
    fatiguePercent: recovery.fatiguePercent,
    readinessScore: 0,
    readinessStatus: "Learning",
    readinessText: "",
    readinessGuidance: "",
  };

  applyRecoveryAdjustment(suggestion, progression, recovery, prescription);

  const readiness = evaluateReadiness(previous, progression, recovery);
  suggestion.readinessScore = readiness.score;
  suggestion.readinessStatus = readiness.status;
  suggestion.readinessText = readiness.summary;
  suggestion.readinessGuidance = readiness.guidance;

  return suggestion;
}

export function buildGoalAwareWorkoutSuggestion(
  input: GoalAwareProgressionInput,
  progression: GoalAwareProgressionEvaluation,
): WorkoutExerciseSuggestion {
  const latest = input.trend.exposures.at(-1);
  const duration = input.trackingMode === "duration";
  const suggestedGoal = duration
    ? `${progression.prescribedSets} holds x ${input.prescription.targetDurationMinSeconds ?? 20}-${input.prescription.targetDurationMaxSeconds ?? 60} sec`
    : `${progression.prescribedSets} sets x ${input.prescription.targetRepsMin}-${input.prescription.targetRepsMax} @ RIR ${progression.prescribedRirMin}-${progression.prescribedRirMax}${progression.suggestedWeight > 0 ? ` at ${fmt1(progression.suggestedWeight)} lb` : ""}`;
  const readiness = evaluateGoalAwareReadiness({
    goal: input.goal,
    recovery: input.recovery,
    trend: input.trend,
    fatigue: input.fatigue,
    volumeContext: input.volumeContext,
    confidenceScore: progression.confidenceScore,
    prescriptionAdherence: latest && input.prescription.targetSets
      ? Math.min(100, (latest.workingSetCount / input.prescription.targetSets) * 100)
      : 75,
  });
  const stimulusQuality: NonNullable<WorkoutExerciseSuggestion["stimulusQuality"]> = input.trend.status === "Learning"
    ? "Learning"
    : input.recovery.fatiguePercent >= 70 || input.volumeContext?.status === "excessive"
      ? "Excessive Fatigue"
      : input.volumeContext?.status === "under" && input.trend.status !== "Improving"
        ? "Understimulated"
        : input.trend.status === "Improving" && input.recovery.fatiguePercent <= 55
          ? "High Stimulus"
          : "Productive";
  return {
    exerciseName: input.previous.exerciseName,
    lastPerformance: latest
      ? duration
        ? `${latest.workingSetCount} holds, ${latest.totalDurationSeconds} sec total`
        : `${latest.workingSetCount} sets, ${latest.totalReps} total reps at up to ${fmt1(latest.topWeight)} lb`
      : "No previous workout available.",
    recommendation: progression.recommendation,
    suggestedGoal,
    reason: progression.reason,
    evidenceText: progression.trendEvidence,
    nextGoalText: progression.nextGoalText,
    confidenceScore: progression.confidenceScore,
    recoveryStatus: input.recovery.status,
    recoveryText: `${input.recovery.displayName} recovery: ${input.recovery.recoveryPercent}%`,
    recoveryPercent: input.recovery.recoveryPercent,
    fatiguePercent: input.recovery.fatiguePercent,
    readinessScore: readiness.score,
    readinessStatus: readiness.status,
    readinessText: readiness.summary,
    readinessGuidance: readiness.guidance,
    goal: input.goal,
    goalLabel: resolveGoalCoachingProfile(input.goal).label,
    trackingMode: input.trackingMode,
    trend: progression.trend,
    trendEvidence: progression.trendEvidence,
    setRecommendation: progression.setRecommendation,
    prescribedSets: progression.prescribedSets,
    prescribedRirMin: progression.prescribedRirMin,
    prescribedRirMax: progression.prescribedRirMax,
    confidenceFactors: progression.confidenceFactors,
    volumeContext: progression.volumeContext,
    stimulusQuality,
  };
}

function applyRecoveryAdjustment(
  suggestion: WorkoutExerciseSuggestion,
  progression: ProgressionEvaluation,
  recovery: MuscleRecoveryState,
  prescription: ProgressionPrescription,
): void {
  if (recovery.fatiguePercent >= 75) {
    suggestion.recommendation = "Reduce Or Delay";
    suggestion.suggestedGoal =
      progression.suggestedWeight > 0
        ? `${fmt1(Math.max(0, progression.suggestedWeight * 0.9))} lb x ${prescription.targetRepsMin}-${prescription.targetRepsMax}`
        : `Reduce volume for ${prescription.targetRepsMin}-${prescription.targetRepsMax} reps`;
    suggestion.reason = `${recovery.displayName} is still highly fatigued.`;
    suggestion.nextGoalText = "Use a lighter session, reduce sets, or delay this muscle group if possible.";
    suggestion.confidenceScore = Math.min(96, progression.confidenceScore + 8);
    return;
  }

  if (recovery.fatiguePercent >= 55) {
    suggestion.recommendation = "Hold Weight";
    suggestion.reason = `${recovery.displayName} is still recovering. Do not force load progression today.`;
    suggestion.nextGoalText =
      progression.suggestedWeight > 0
        ? `Repeat around ${fmt1(progression.suggestedWeight)} lb and prioritize clean reps.`
        : "Repeat the planned rep range and monitor effort.";
    suggestion.confidenceScore = Math.min(92, progression.confidenceScore + 4);
    return;
  }

  if (recovery.fatiguePercent <= 25 && progression.recommendation.toLowerCase().includes("increase")) {
    suggestion.reason = `${progression.reason} ${recovery.displayName} is recovered enough to support progression.`;
    suggestion.nextGoalText = `${progression.nextGoalText} Recovery is ${recovery.recoveryPercent}%.`;
    suggestion.confidenceScore = Math.min(98, progression.confidenceScore + 4);
    return;
  }

  suggestion.reason = `${progression.reason} ${recovery.displayName} recovery is ${recovery.recoveryPercent}%.`;
}

// ---------------------------------------------------------------------------
// 7. WorkoutAnalyzer — analyzeWorkoutComposition
// ---------------------------------------------------------------------------

export interface WorkoutCompositionExerciseInput {
  targetSets: number;
  restSeconds: number;
  isCompound: boolean;
  exerciseRole: string;
  failureTarget: string;
  primaryMuscleName: string;
  intensityTechnique?: string | null;
  effectiveMuscleSets?: { muscleName: string; effectiveSets: number; mrv?: number }[];
}

export interface WorkoutComposition {
  exerciseCount: number;
  workingSetCount: number;
  estimatedMinutes: number;
  compoundMovementCount: number;
  isolationMovementCount: number;
  fatigueRating: "Low" | "Medium" | "High";
  primaryMuscles: string;
  warnings: string;
}

export function analyzeWorkoutComposition(
  rows: WorkoutCompositionExerciseInput[],
  goal: TrainingGoalId = "hypertrophy",
): WorkoutComposition {
  const totalSets = rows.reduce((sum, r) => sum + r.targetSets, 0);
  const estimatedMinutes = Math.max(
    rows.length * 3 + rows.reduce((sum, r) => sum + r.targetSets * r.restSeconds, 0) / 60,
    0,
  );
  const compoundCount = rows.filter((r) => r.isCompound).length;
  const isolationCount = rows.length - compoundCount;
  const primaryMuscles = Array.from(
    new Set(rows.map((r) => r.primaryMuscleName).filter((m) => m && m.trim().length > 0)),
  ).sort();

  const warnings: string[] = [];
  if (rows.length === 0) warnings.push("This workout has no exercises yet.");
  const profile = resolveGoalCoachingProfile(goal);
  if (rows.length > 0 && profile.requiresPrimaryCompound && compoundCount === 0) warnings.push("No compound movement assigned for a strength-focused workout.");
  if (profile.requiresPrimaryCompound && !rows.some((r) => r.exerciseRole.toLowerCase() === "primary compound")) {
    warnings.push("No primary compound movement assigned.");
  }
  if (totalSets > 30) warnings.push("High total set count. Check fatigue and session length.");

  const failureSetCount = rows.filter(
    (r) => r.failureTarget.toLowerCase() === "every set" || r.failureTarget.toLowerCase() === "technical failure",
  ).length;
  if (failureSetCount >= 3) warnings.push("Multiple exercises target frequent failure.");
  const techniqueCount = rows.filter((row) => row.intensityTechnique && row.intensityTechnique.toLowerCase() !== "normal").length;
  if (techniqueCount >= 3) warnings.push("Multiple high-fatigue intensity techniques are planned.");
  const muscleTotals = new Map<string, { sets: number; mrv?: number }>();
  for (const row of rows) {
    for (const muscle of row.effectiveMuscleSets ?? []) {
      const current = muscleTotals.get(muscle.muscleName) ?? { sets: 0, mrv: muscle.mrv };
      current.sets += muscle.effectiveSets;
      current.mrv ??= muscle.mrv;
      muscleTotals.set(muscle.muscleName, current);
    }
  }
  for (const [muscle, value] of Array.from(muscleTotals.entries())) {
    if (value.mrv != null && value.sets > value.mrv) warnings.push(`${muscle} exceeds its effective-volume MRV in this workout.`);
  }
  if (estimatedMinutes > 120) warnings.push("Very long estimated session.");

  let fatigueRating: WorkoutComposition["fatigueRating"];
  if (totalSets >= 30 || failureSetCount >= 4) fatigueRating = "High";
  else if (totalSets >= 18 || failureSetCount >= 2) fatigueRating = "Medium";
  else fatigueRating = "Low";

  return {
    exerciseCount: rows.length,
    workingSetCount: totalSets,
    estimatedMinutes: Math.round(estimatedMinutes),
    compoundMovementCount: compoundCount,
    isolationMovementCount: isolationCount,
    fatigueRating,
    primaryMuscles: primaryMuscles.join(", "),
    warnings: warnings.length === 0 ? "No workout warnings." : warnings.join(" "),
  };
}

// ---------------------------------------------------------------------------
// 8. DashboardService — getDashboardSnapshot
// ---------------------------------------------------------------------------

export interface DashboardTemplateInput {
  id: number;
  name: string;
  exercises: Array<
    ProgressionPrescription & {
      exerciseId: number;
      exerciseOrder: number;
      targetSets: number;
      targetDurationMinSeconds?: number | null;
      targetDurationMaxSeconds?: number | null;
      trackingMode?: TrackingMode;
      warmupSets: number;
      topSets: number;
      backoffSets: number;
      restSeconds: number;
    }
  >;
}

export interface DashboardExerciseSuggestion extends WorkoutExerciseSuggestion {
  exerciseId: number;
}

export interface MuscleFatigueMapEntry {
  muscleName: string;
  displayName: string;
  fatiguePercent: number;
  recoveryPercent: number;
  status: string;
}

export interface DashboardSnapshot {
  todaysWorkoutName: string;
  workoutStatus: string;
  lastWorkoutText: string;
  recoveryText: string;
  fatigueStatus: string;
  fatigueText: string;
  fatigueRiskScore: number;
  recentAchievementText: string;
  estimatedDurationMinutes: number;
  exerciseCount: number;
  completedWorkouts: number;
  suggestions: DashboardExerciseSuggestion[];
  muscleFatigueMap: MuscleFatigueMapEntry[];
  isRestDay: boolean;
  scheduleSource: "schedule" | "fallback";
}

function resolveOverallRecovery(states: MuscleRecoveryState[]): number {
  const trained = states.filter((s) => s.lastTrainedAt != null);
  if (trained.length === 0) return 100;
  const avg = trained.reduce((sum, s) => sum + s.recoveryPercent, 0) / trained.length;
  return Math.min(Math.max(Math.round(avg), 0), 100);
}

function resolveWorkoutStatus(daysSinceLastWorkout: number | null, overallRecovery: number): string {
  if (overallRecovery < 40) return "Needs Rest";
  if (overallRecovery < 70) return "Recovering";
  if (daysSinceLastWorkout == null) return "Ready";
  switch (daysSinceLastWorkout) {
    case 0:
      return "Logged Today";
    case 1:
      return overallRecovery >= 75 ? "Likely Ready" : "Recovering";
    case 2:
      return "Likely Ready";
    default:
      return "Ready";
  }
}

function resolveRecoveryText(daysSinceLastWorkout: number | null, overallRecovery: number): string {
  if (daysSinceLastWorkout == null) {
    return "No recovery history yet. Log your first workout to start tracking readiness.";
  }
  const recoveryPhrase = `Estimated recovery: ${overallRecovery}%.`;
  let timingPhrase: string;
  switch (daysSinceLastWorkout) {
    case 0:
      timingPhrase = "You trained today. Recovery is still accumulating.";
      break;
    case 1:
      timingPhrase = "Last workout was yesterday. Choose lower-overlap work if needed.";
      break;
    case 2:
      timingPhrase = "Two days since last workout. Many muscle groups may be ready.";
      break;
    default:
      timingPhrase = `${daysSinceLastWorkout} days since last workout. You are likely ready to train.`;
  }
  return `${recoveryPhrase} ${timingPhrase}`;
}

function resolveRecentAchievement(history: HistorySessionInput[]): string {
  const recentRecords = getPersonalRecords(history, 3);
  if (recentRecords.length > 0) {
    return "New PR: " + personalRecordSummary(recentRecords[0]);
  }
  const latest = history[0];
  if (!latest) return "No achievements yet. Save your first workout to start tracking progress.";

  let bestExercise: HistoryExerciseInput | null = null;
  let bestVolume = -1;
  for (const ex of latest.exercises) {
    const vol = exerciseVolume(ex);
    if (vol > bestVolume) {
      bestVolume = vol;
      bestExercise = ex;
    }
  }
  if (!bestExercise) return `Latest workout saved: ${latest.workoutName}.`;
  return `Latest highlight: ${bestExercise.exerciseName} - ${exerciseBestSetText(bestExercise)}, ${fmt1(exerciseVolume(bestExercise))} volume.`;
}

function estimateDurationMinutes(exercises: DashboardTemplateInput["exercises"]): number {
  if (exercises.length === 0) return 0;
  const totalSets = exercises.reduce(
    (sum, e) => sum + Math.max(1, e.targetSets + (e.warmupSets ?? 0) + (e.topSets ?? 0) + (e.backoffSets ?? 0)),
    0,
  );
  const averageRestSeconds =
    exercises.reduce((sum, e) => sum + Math.max(60, e.restSeconds), 0) / exercises.length;
  const workSeconds = totalSets * 45;
  const restSeconds = totalSets * averageRestSeconds;
  return Math.max(20, Math.round((workSeconds + restSeconds) / 60));
}

// Today's resolved calendar day, passed straight from the ScheduleDay row (if any).
export interface DashboardScheduleInput {
  workoutTemplateId: number | null; // null = rest day
  label: string | null;
}

export interface GetDashboardSnapshotArgs {
  templates: DashboardTemplateInput[];
  history: HistorySessionInput[]; // most-recent-first, up to 50
  exerciseNameLookup: Map<number, string>;
  exercisePrimaryMuscleLookup: Map<number, MuscleGroupName>;
  muscleGroupLookup: MuscleGroupLookup;
  recoverySettings?: RecoverySettings;
  recoveryOverrides?: RecoveryModelOverrides;
  coachSettings?: CoachSettings;
  trainingGoal?: TrainingGoalId;
  now?: Date;
  schedule?: DashboardScheduleInput | null;
  /**
   * IANA zone used for anything the user reads as a wall-clock time or a
   * day count. Defaults to UTC, which is only correct on a UTC device — the
   * server always passes the user's effective zone.
   */
  zone?: string;
}

/** The calendar model already resolves "today" to a single row; this just reports whether one exists. */
function resolveScheduledSlot(
  schedule: DashboardScheduleInput | null | undefined,
): { matched: true; workoutTemplateId: number | null } | { matched: false } {
  if (!schedule) return { matched: false };
  return { matched: true, workoutTemplateId: schedule.workoutTemplateId };
}

export function getDashboardSnapshot(args: GetDashboardSnapshotArgs): DashboardSnapshot {
  const { templates, history, exerciseNameLookup, exercisePrimaryMuscleLookup, muscleGroupLookup } = args;
  const now = args.now ?? new Date();
  const zone = args.zone ?? "UTC";

  const coachSettings = args.coachSettings ?? DEFAULT_COACH_SETTINGS;
  const trainingGoal = args.trainingGoal ?? "hypertrophy";
  const fatigue = evaluateFatigueTrend(history, coachSettings.fatigueSensitivity);
  const recoveryStates = evaluateRecovery(history, muscleGroupLookup, now, args.recoverySettings, args.recoveryOverrides);
  const muscleFatigueMap: MuscleFatigueMapEntry[] = recoveryStates.map((s) => ({
    muscleName: s.muscle,
    displayName: s.displayName,
    fatiguePercent: s.fatiguePercent,
    recoveryPercent: s.recoveryPercent,
    status: s.status,
  }));

  const lastSession = history[0] ?? null;

  // Consult the schedule first (if one exists with at least one non-null slot).
  const scheduleResolution = resolveScheduledSlot(args.schedule);
  const scheduleSource: "schedule" | "fallback" = scheduleResolution.matched ? "schedule" : "fallback";
  const isRestDay = scheduleResolution.matched && scheduleResolution.workoutTemplateId == null;

  let selectedTemplate: DashboardTemplateInput | null = null;
  if (scheduleResolution.matched && scheduleResolution.workoutTemplateId != null) {
    selectedTemplate = templates.find((t) => t.id === scheduleResolution.workoutTemplateId) ?? null;
  }
  if (!scheduleResolution.matched) {
    // Fallback: exact previous behavior (last-used template, else first template).
    selectedTemplate =
      templates.length === 0
        ? null
        : (lastSession?.workoutTemplateId != null &&
            templates.find((t) => t.id === lastSession.workoutTemplateId)) ||
          templates[0];
  }

  if (isRestDay) {
    return {
      todaysWorkoutName: "Rest Day",
      workoutStatus: "Rest Day",
      lastWorkoutText: lastSession
        ? `Last workout: ${lastSession.workoutName} on ${formatInstantInZone(lastSession.startedAt, zone)}`
        : "No workouts saved yet",
      recoveryText: resolveRecoveryText(
        lastSession
          ? civilDaysBetween(lastSession.startedAt, now, zone)
          : null,
        resolveOverallRecovery(recoveryStates),
      ),
      fatigueStatus: fatigue.status,
      fatigueText: fatigue.summary,
      fatigueRiskScore: fatigue.riskScore,
      muscleFatigueMap,
      recentAchievementText: resolveRecentAchievement(history),
      estimatedDurationMinutes: 0,
      exerciseCount: 0,
      completedWorkouts: history.length,
      suggestions: [],
      isRestDay: true,
      scheduleSource: "schedule",
    };
  }

  if (!selectedTemplate) {
    return {
      todaysWorkoutName: "Create a workout template",
      workoutStatus: "Setup Needed",
      lastWorkoutText: history.length === 0 ? "No workouts saved yet" : `Last workout: ${lastSession!.workoutName}`,
      recoveryText: "Create a workout template to unlock training guidance.",
      fatigueStatus: fatigue.status,
      fatigueText: fatigue.summary,
      fatigueRiskScore: fatigue.riskScore,
      muscleFatigueMap,
      recentAchievementText: "Build a workout template, then log your first session.",
      estimatedDurationMinutes: 0,
      exerciseCount: 0,
      completedWorkouts: history.length,
      suggestions: [],
      isRestDay: false,
      scheduleSource,
    };
  }

  const templateExercises = [...selectedTemplate.exercises].sort((a, b) => a.exerciseOrder - b.exerciseOrder);
  const daysSinceLastWorkout = lastSession
    ? civilDaysBetween(lastSession.startedAt, now, zone)
    : null;
  const overallRecovery = resolveOverallRecovery(recoveryStates);

  const snapshot: DashboardSnapshot = {
    todaysWorkoutName: selectedTemplate.name,
    workoutStatus: fatigue.deloadSuggested ? "Deload Suggested" : resolveWorkoutStatus(daysSinceLastWorkout, overallRecovery),
    lastWorkoutText: lastSession
      ? `Last workout: ${lastSession.workoutName} on ${formatInstantInZone(lastSession.startedAt, zone)}`
      : "No workouts saved yet",
    recoveryText: resolveRecoveryText(daysSinceLastWorkout, overallRecovery),
    fatigueStatus: fatigue.status,
    fatigueText: fatigue.summary,
    fatigueRiskScore: fatigue.riskScore,
    muscleFatigueMap,
    recentAchievementText: resolveRecentAchievement(history),
    estimatedDurationMinutes: estimateDurationMinutes(templateExercises),
    exerciseCount: templateExercises.length,
    completedWorkouts: history.length,
    suggestions: [],
    isRestDay: false,
    scheduleSource,
  };

  for (const prescription of templateExercises.slice(0, 6)) {
    const fallbackName = exerciseNameLookup.get(prescription.exerciseId) ?? "Exercise";
    const previous = getPreviousExercisePerformance(history, prescription.exerciseId, fallbackName);
    if (!previous.exerciseName) previous.exerciseName = fallbackName;

    const resolvedExerciseName = previous.exerciseName || "Exercise";
    const resolvedPrevious = { ...previous, exerciseName: resolvedExerciseName };
    const primaryMuscle = exercisePrimaryMuscleLookup.get(prescription.exerciseId);
    const recovery = primaryMuscle ? getPrimaryRecovery(recoveryStates, primaryMuscle) : recoveryStates[0];
    const historicalExercise = history.flatMap((session) => session.exercises).find((exercise) => exercise.exerciseId === prescription.exerciseId);
    const trackingMode = prescription.trackingMode === "duration" || historicalExercise?.trackingMode === "duration"
      ? "duration" as const
      : "reps" as const;
    const trend = evaluateExerciseTrend(history, prescription.exerciseId, trainingGoal, trackingMode, coachSettings);
    const progressionInput: GoalAwareProgressionInput = {
      goal: trainingGoal,
      trackingMode,
      prescription,
      previous: resolvedPrevious,
      trend,
      settings: coachSettings,
      recovery,
      fatigue,
      volumeContext: null,
    };
    const evaluation = evaluateGoalAwareProgression(progressionInput);
    const suggestion: DashboardExerciseSuggestion = {
      exerciseId: prescription.exerciseId,
      ...buildGoalAwareWorkoutSuggestion(progressionInput, evaluation),
    };
    suggestion.exerciseName = resolvedExerciseName;

    if (fatigue.deloadSuggested) {
      suggestion.recommendation = "Hold Progression";
      suggestion.reason = "Fatigue trend detected. Avoid forcing load increases today.";
      suggestion.nextGoalText = "Use a lighter session or reduce volume until performance rebounds.";
      suggestion.confidenceScore = Math.min(95, suggestion.confidenceScore + 5);
    }

    snapshot.suggestions.push(suggestion);
  }

  return snapshot;
}

/**
 * Whole calendar days between two instants, counted in `zone`.
 *
 * Previously this used the *server's* local date, which on a UTC host meant a
 * Tuesday-evening Pacific workout was already "yesterday". Counting civil days
 * in the user's own zone makes "2 days ago" mean what they'd say out loud.
 */
function civilDaysBetween(from: Date, to: Date, zone: string): number {
  const a = Date.parse(`${civilDateInZone(from, zone)}T00:00:00Z`);
  const b = Date.parse(`${civilDateInZone(to, zone)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Wall-clock date+time of an instant, rendered in the user's zone. */
function formatInstantInZone(d: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

// ---------------------------------------------------------------------------
// Volume Tracking — MEV / MAV / MRV categorization (kept from v1, still valid)
// ---------------------------------------------------------------------------

export type VolumeStatus = "under" | "optimal" | "high" | "excessive";

export interface VolumeLandmarks {
  mev: number;
  mav: number;
  mrv: number;
}

export function categorizeVolume(weeklySets: number, landmarks: VolumeLandmarks): VolumeStatus {
  if (weeklySets < landmarks.mev) return "under";
  if (weeklySets <= landmarks.mav) return "optimal";
  if (weeklySets <= landmarks.mrv) return "high";
  return "excessive";
}

export const VOLUME_STATUS_LABEL: Record<VolumeStatus, string> = {
  under: "Under-training",
  optimal: "Optimal",
  high: "High",
  excessive: "Excessive / junk volume risk",
};

export interface SetMuscleTag {
  exerciseId: number;
  stimulus: { muscleGroupId: number; stimulusRatio: number }[];
  isWarmup: boolean;
}

export function computeWeeklyVolumeByMuscleGroup(taggedSets: SetMuscleTag[]): Map<number, number> {
  const volume = new Map<number, number>();
  for (const s of taggedSets) {
    if (s.isWarmup) continue;
    for (const row of s.stimulus) {
      if (row.stimulusRatio <= 0) continue;
      volume.set(row.muscleGroupId, (volume.get(row.muscleGroupId) ?? 0) + row.stimulusRatio);
    }
  }
  return volume;
}

// ---------------------------------------------------------------------------
// 9. Scheduler — buildAutoSchedule
// ---------------------------------------------------------------------------
// Pure planning function: given a split + mode + the user's existing templates
// + the global exercise catalog, decides (a) which existing template fills each
// "day archetype" of the split, or a starter-template spec to create when none
// matches, and (b) the resulting slot list (weekday-based or rotation-based).
// No DB access here — server/storage.ts executes the plan (creating any needed
// starter templates, then persisting schedule + slots).
// ---------------------------------------------------------------------------

export const SPLIT_DAY_ARCHETYPES: Record<Exclude<WorkoutSplitId, "custom">, string[]> = {
  ppl: ["Push", "Pull", "Legs"],
  upper_lower: ["Upper", "Lower"],
  full_body: ["Full Body A", "Full Body B", "Full Body C"],
  bro_split: ["Chest", "Back", "Shoulders", "Arms", "Legs"],
};

// Default training weekdays (0=Sun..6=Sat) used when the caller omits
// `trainingDays` for fixed mode. Chosen to spread sessions with sensible rest.
const DEFAULT_TRAINING_DAYS: Record<Exclude<WorkoutSplitId, "custom">, number[]> = {
  ppl: [1, 2, 3, 5, 6, 0], // Mon Tue Wed Fri Sat Sun, Thu rest
  upper_lower: [1, 2, 4, 5], // Mon Tue Thu Fri
  full_body: [1, 3, 5], // Mon Wed Fri
  bro_split: [1, 2, 3, 4, 5], // Mon-Fri
};

// Archetype -> primary muscle groups to draw exercises from when a starter
// template must be generated (order matters: first = primary compound focus).
const ARCHETYPE_MUSCLE_FOCUS: Record<string, MuscleGroupName[]> = {
  Push: ["MidLowerChest", "UpperChest", "FrontDelts", "SideDelts", "Triceps"],
  Pull: ["Lats", "UpperMidBack", "Biceps", "RearDelts"],
  Legs: ["Quads", "Hamstrings", "Glutes", "Calves"],
  Upper: ["MidLowerChest", "UpperChest", "Lats", "UpperMidBack", "FrontDelts", "SideDelts", "Biceps", "Triceps"],
  Lower: ["Quads", "Hamstrings", "Glutes", "Calves"],
  "Full Body A": ["Quads", "MidLowerChest", "Lats", "SideDelts"],
  "Full Body B": ["Hamstrings", "UpperMidBack", "FrontDelts", "Biceps"],
  "Full Body C": ["Glutes", "UpperChest", "Lats", "Triceps"],
  Chest: ["MidLowerChest", "UpperChest", "FrontDelts", "Triceps"],
  Back: ["UpperMidBack", "Lats", "Traps", "Biceps"],
  Shoulders: ["SideDelts", "FrontDelts", "RearDelts", "Traps"],
  Arms: ["Biceps", "Triceps", "Forearms"],
};

export interface ScheduleCatalogExercise {
  id: number;
  name: string;
  primaryMuscleGroupId: number;
  isCompound: boolean;
}

export interface ScheduleExistingTemplate {
  id: number;
  name: string;
}

export interface StarterTemplateExerciseSpec {
  exerciseId: number;
  exerciseOrder: number;
  exerciseRole: ExerciseRole;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRir: number;
  failureTarget: FailureTarget;
  restSeconds: number;
  warmupSets: number;
  topSets: number;
  backoffSets: number;
}

export interface StarterTemplateSpec {
  name: string;
  archetype: string;
  exercises: StarterTemplateExerciseSpec[];
}

function pickExercisesForArchetype(
  archetype: string,
  catalog: ScheduleCatalogExercise[],
  muscleGroupLookup: MuscleGroupLookup,
): StarterTemplateExerciseSpec[] {
  const focusNames = ARCHETYPE_MUSCLE_FOCUS[archetype] ?? [];
  const nameToId = new Map<MuscleGroupName, number>();
  muscleGroupLookup.idToName.forEach((name, id) => {
    nameToId.set(name, id);
  });
  const focusIds = focusNames
    .map((name) => nameToId.get(name))
    .filter((id): id is number => id != null);

  const byMuscle = new Map<number, ScheduleCatalogExercise[]>();
  for (const id of focusIds) byMuscle.set(id, []);
  for (const ex of catalog) {
    const bucket = byMuscle.get(ex.primaryMuscleGroupId);
    if (bucket) bucket.push(ex);
  }

  const picked: ScheduleCatalogExercise[] = [];
  const usedIds = new Set<number>();
  const takeFrom = (muscleId: number, preferCompound: boolean) => {
    const bucket = (byMuscle.get(muscleId) ?? []).filter((e) => !usedIds.has(e.id));
    if (bucket.length === 0) return null;
    const sorted = [...bucket].sort((a, b) => (preferCompound ? Number(b.isCompound) - Number(a.isCompound) : 0));
    const chosen = sorted[0];
    usedIds.add(chosen.id);
    picked.push(chosen);
    return chosen;
  };

  // 1 primary compound from the first focus muscle
  if (focusIds[0] != null) takeFrom(focusIds[0], true);
  // 1-2 secondary compound/isolation from remaining focus muscles
  for (const muscleId of focusIds.slice(1, 3)) {
    takeFrom(muscleId, true);
  }
  // Fill out to 4-5 total exercises with isolation work across focus muscles
  let cursor = 0;
  while (picked.length < Math.min(5, Math.max(4, focusIds.length + 1)) && focusIds.length > 0) {
    const muscleId = focusIds[cursor % focusIds.length];
    const before = picked.length;
    takeFrom(muscleId, false);
    cursor++;
    if (picked.length === before && cursor > focusIds.length * 3) break; // avoid infinite loop when catalog exhausted
  }

  return picked.map((ex, idx) => {
    const isFirst = idx === 0;
    const role: ExerciseRole = isFirst ? "Primary Compound" : ex.isCompound ? "Secondary Compound" : "Isolation";
    return {
      exerciseId: ex.id,
      exerciseOrder: idx + 1,
      exerciseRole: role,
      targetSets: isFirst ? 4 : 3,
      targetRepsMin: isFirst ? 5 : 8,
      targetRepsMax: isFirst ? 8 : 12,
      targetRir: isFirst ? 2 : 1,
      failureTarget: isFirst ? "Never" : "Last Set",
      restSeconds: isFirst ? 150 : 90,
      warmupSets: isFirst ? 2 : 0,
      topSets: 0,
      backoffSets: 0,
    };
  });
}

/** Build a single starter-template spec for one archetype label (e.g. "Push"). Pure — no DB access. */
export function buildStarterTemplate(args: {
  archetype: string;
  catalog: ScheduleCatalogExercise[];
  muscleGroupLookup: MuscleGroupLookup;
}): StarterTemplateSpec {
  const { archetype, catalog, muscleGroupLookup } = args;
  const exercises = pickExercisesForArchetype(archetype, catalog, muscleGroupLookup);
  return { name: `${archetype} Day (Auto)`, archetype, exercises };
}

/** Returns [startDate, endDate] (both YYYY-MM-DD, inclusive) for a given "YYYY-MM" month string. */
export function monthBounds(yearMonth: string): [string, string] {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = `${yearMonth}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this month
  const end = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  return [start, end];
}

/** Enumerate every date (YYYY-MM-DD) from startDate to endDate, inclusive. */
export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  // Parsed as UTC explicitly: these are civil dates, and enumerating them must
  // not depend on the host's timezone (or drift across a DST boundary).
  let cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

