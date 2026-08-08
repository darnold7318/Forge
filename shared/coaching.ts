// ---------------------------------------------------------------------------
// Forge coaching logic — pure, testable utility functions.
// Ported faithfully from the reference C# WPF app's coaching engines:
// ProgressionEngine, RecoveryEngine, FatigueEngine, ReadinessEngine,
// PersonalRecordEngine, WorkoutRecommendationEngine, WorkoutAnalyzer,
// DashboardService.
// No side effects, no I/O — all inputs are plain data.
// ---------------------------------------------------------------------------

import {
  muscleGroupNames,
  muscleGroupDisplayNames,
  type MuscleGroupName,
  type WorkoutSplitId,
  type ExerciseRole,
  type FailureTarget,
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
  rir: number | null;
  completed: boolean;
}

export interface HistoryExerciseInput {
  exerciseId: number;
  exerciseOrder: number;
  exerciseName: string;
  primaryMuscleGroupId: number;
  intensityTechnique: string; // default "Normal"
  failureTarget: string; // default "Never"
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
  return sets.filter((s) => s.completed && s.reps > 0);
}

export function exerciseVolume(ex: HistoryExerciseInput): number {
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
  const completed = completedSetsOf(ex.sets);
  if (completed.length === 0) return 0;
  return Math.max(...completed.map((s) => estimateOneRepMax(s.weight, s.reps)));
}

export function exerciseBestSet(ex: HistoryExerciseInput): HistorySetInput | null {
  const completed = completedSetsOf(ex.sets);
  if (completed.length === 0) return null;
  return [...completed].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.reps - a.reps;
  })[0];
}

export function exerciseBestSetText(ex: HistoryExerciseInput): string {
  const best = exerciseBestSet(ex);
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

const HALF_LIFE_HOURS: Record<MuscleGroupName, number> = {
  LowerBack: 72,
  Quads: 60,
  Hamstrings: 60,
  Glutes: 60,
  Chest: 48,
  Back: 48,
  Lats: 48,
  Calves: 30,
  Forearms: 30,
  Abs: 30,
  Traps: 40,
  RearDelts: 40,
  SideDelts: 40,
  FrontDelts: 40,
  Biceps: 40,
  Triceps: 40,
  Obliques: 40,
  Adductors: 40,
  Abductors: 40,
};

function resolveDecay(muscle: MuscleGroupName, hoursAgo: number): number {
  const halfLife = HALF_LIFE_HOURS[muscle] ?? 40;
  return Math.pow(0.5, hoursAgo / halfLife);
}

const RELATED_MUSCLES: Partial<Record<MuscleGroupName, MuscleGroupName[]>> = {
  Chest: ["FrontDelts", "Triceps"],
  Lats: ["Back", "Biceps", "RearDelts"],
  Back: ["Lats", "Traps", "RearDelts"],
  Quads: ["Glutes", "Adductors"],
  Hamstrings: ["Glutes", "LowerBack"],
  Glutes: ["Hamstrings", "Quads"],
  SideDelts: ["FrontDelts", "RearDelts", "Traps"],
  Biceps: ["Forearms", "Lats"],
  Triceps: ["Chest", "FrontDelts"],
};

function estimateFatigue(ex: HistoryExerciseInput): number {
  const completed = completedSetsOf(ex.sets);
  const setLoad = completed.length * 8;
  const rirVals = completed.filter((s) => s.rir != null).map((s) => s.rir as number);
  const averageRir = rirVals.length > 0 ? rirVals.reduce((a, b) => a + b, 0) / rirVals.length : 2;
  const rirPenalty = Math.min(Math.max(4 - averageRir, 0), 4) * 2;
  const techniqueBonus = ex.intensityTechnique && ex.intensityTechnique !== "Normal" ? 5 : 0;
  const failureBonus = ex.failureTarget && ex.failureTarget !== "Never" ? 4 : 0;
  const volume = completed.reduce((sum, s) => sum + s.weight * s.reps, 0);
  const volumeBonus = volume > 0 ? Math.min(10, volume / 800) : 0;
  const result = setLoad + rirPenalty + techniqueBonus + failureBonus + volumeBonus;
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
): MuscleRecoveryState[] {
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const recentSessions = history.filter((s) => s.startedAt >= tenDaysAgo);

  const fatigueSum = new Map<MuscleGroupName, number>();
  const lastTrained = new Map<MuscleGroupName, Date>();

  for (const session of recentSessions) {
    const hoursAgo = Math.max(0, (now.getTime() - session.startedAt.getTime()) / (1000 * 60 * 60));
    for (const ex of session.exercises) {
      const completed = completedSetsOf(ex.sets);
      if (completed.length === 0) continue;
      const primary = lookup.idToName.get(ex.primaryMuscleGroupId);
      if (!primary) continue;

      const baseFatigue = estimateFatigue(ex);
      const decayed = baseFatigue * resolveDecay(primary, hoursAgo);

      fatigueSum.set(primary, (fatigueSum.get(primary) ?? 0) + decayed);
      if (!lastTrained.has(primary) || session.startedAt > lastTrained.get(primary)!) {
        lastTrained.set(primary, session.startedAt);
      }

      const related = RELATED_MUSCLES[primary] ?? [];
      for (const rel of related) {
        const relDecayed = baseFatigue * 0.45 * resolveDecay(rel, hoursAgo);
        fatigueSum.set(rel, (fatigueSum.get(rel) ?? 0) + relDecayed);
        if (!lastTrained.has(rel) || session.startedAt > lastTrained.get(rel)!) {
          lastTrained.set(rel, session.startedAt);
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
}

export function evaluateFatigueTrend(history: HistorySessionInput[]): FatigueSignal {
  if (history.length < 3) {
    return {
      status: "Learning",
      summary: "Log at least three workouts before fatigue trends are evaluated.",
      riskScore: 10,
      deloadSuggested: false,
    };
  }

  // history is most-recent-first; take 3 most recent, then order ascending (oldest of the 3 first)
  const lastThreeDesc = [...history]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 3);
  const lastThreeAsc = [...lastThreeDesc].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const volumes = lastThreeAsc.map(sessionTotalVolume);
  const reps = lastThreeAsc.map((s) =>
    s.exercises.reduce((sum, e) => sum + completedSetsOf(e.sets).reduce((rs, st) => rs + st.reps, 0), 0),
  );
  const setsCount = lastThreeAsc.map(sessionCompletedSetCount);

  const volumeDeclining = volumes[2] < volumes[1] && volumes[1] < volumes[0];
  const repsDeclining = reps[2] < reps[1] && reps[1] < reps[0];
  const setVolumeDeclining =
    setsCount[2] > 0 &&
    setsCount[1] > 0 &&
    setsCount[0] > 0 &&
    volumes[2] / setsCount[2] < volumes[1] / setsCount[1] &&
    volumes[1] / setsCount[1] < volumes[0] / setsCount[0];

  let riskScore = 15 + (volumeDeclining ? 35 : 0) + (repsDeclining ? 25 : 0) + (setVolumeDeclining ? 25 : 0);
  riskScore = Math.min(riskScore, 100);

  if (riskScore >= 70) {
    return {
      status: "Fatigue Risk",
      summary: "Recent workout performance is declining across multiple sessions. Consider extra recovery or a lighter session.",
      riskScore,
      deloadSuggested: true,
    };
  }
  if (riskScore >= 45) {
    return {
      status: "Watch Trend",
      summary: "Some recent performance markers are trending down. Monitor recovery and avoid forcing progression.",
      riskScore,
      deloadSuggested: false,
    };
  }
  return {
    status: "Stable",
    summary: "Recent workout performance does not show a meaningful fatigue trend.",
    riskScore,
    deloadSuggested: false,
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

// ---------------------------------------------------------------------------
// 5. PersonalRecordEngine — getPersonalRecords
// ---------------------------------------------------------------------------

export interface PersonalRecord {
  exerciseName: string;
  recordType: "Heaviest Set" | "Estimated 1RM" | "Best Set Volume" | "Exercise Volume";
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
  isWarmup: boolean;
}

export interface LivePrResult {
  isPr: boolean;
  recordType?: "Heaviest Set" | "Estimated 1RM";
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
  let seenAny = false;

  for (const s of setsChronological) {
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
  if (rows.length > 0 && compoundCount === 0) warnings.push("No compound movement assigned.");
  if (!rows.some((r) => r.exerciseRole.toLowerCase() === "primary compound")) {
    warnings.push("No primary compound movement assigned.");
  }
  if (totalSets > 30) warnings.push("High total set count. Check fatigue and session length.");

  const failureSetCount = rows.filter(
    (r) => r.failureTarget.toLowerCase() === "every set" || r.failureTarget.toLowerCase() === "technical failure",
  ).length;
  if (failureSetCount >= 3) warnings.push("Multiple exercises target frequent failure.");

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

  const fatigue = evaluateFatigueTrend(history);
  const recoveryStates = evaluateRecovery(history, muscleGroupLookup, now);
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
    const evaluation = evaluateProgression(prescription, {
      ...previous,
      exerciseName: resolvedExerciseName,
    });
    const primaryMuscle = exercisePrimaryMuscleLookup.get(prescription.exerciseId);
    const recovery = primaryMuscle ? getPrimaryRecovery(recoveryStates, primaryMuscle) : recoveryStates[0];
    const suggestion: DashboardExerciseSuggestion = {
      exerciseId: prescription.exerciseId,
      ...buildWorkoutSuggestion(prescription, previous, evaluation, recovery),
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
  primaryMuscleGroupId: number;
  secondaryMuscleGroupIds: number[];
  isWarmup: boolean;
}

export function computeWeeklyVolumeByMuscleGroup(taggedSets: SetMuscleTag[]): Map<number, number> {
  const volume = new Map<number, number>();
  for (const s of taggedSets) {
    if (s.isWarmup) continue;
    volume.set(s.primaryMuscleGroupId, (volume.get(s.primaryMuscleGroupId) ?? 0) + 1);
    for (const secId of s.secondaryMuscleGroupIds) {
      volume.set(secId, (volume.get(secId) ?? 0) + 0.5);
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
  Push: ["Chest", "FrontDelts", "SideDelts", "Triceps"],
  Pull: ["Lats", "Back", "Biceps", "RearDelts"],
  Legs: ["Quads", "Hamstrings", "Glutes", "Calves"],
  Upper: ["Chest", "Lats", "Back", "FrontDelts", "SideDelts", "Biceps", "Triceps"],
  Lower: ["Quads", "Hamstrings", "Glutes", "Calves"],
  "Full Body A": ["Quads", "Chest", "Lats", "SideDelts"],
  "Full Body B": ["Hamstrings", "Back", "FrontDelts", "Biceps"],
  "Full Body C": ["Glutes", "Chest", "Lats", "Triceps"],
  Chest: ["Chest", "FrontDelts", "Triceps"],
  Back: ["Back", "Lats", "Traps", "Biceps"],
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

