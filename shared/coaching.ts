// ---------------------------------------------------------------------------
// Forge coaching logic — pure, testable utility functions.
// No side effects, no I/O. Implements the formulas from app_spec.md.
// ---------------------------------------------------------------------------

export interface WorkingSetInput {
  weight: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
}

// ---------------------------------------------------------------------------
// 1. Estimated 1RM — Epley formula
// ---------------------------------------------------------------------------
export function estimate1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

// ---------------------------------------------------------------------------
// 2. Progressive Overload — Double Progression
// ---------------------------------------------------------------------------
export type ProgressionAction = "increase_weight" | "add_rep" | "hold_weight";

export interface RepRange {
  min: number; // bottom of range, e.g. 8
  max: number; // top of range, e.g. 12
}

export const DEFAULT_REP_RANGE: RepRange = { min: 8, max: 12 };

export interface ProgressionSuggestion {
  action: ProgressionAction;
  suggestedWeight: number;
  suggestedRepTarget: number;
  reasoning: string;
}

/**
 * Given the working (non-warmup) sets from the most recent session for an
 * exercise, determine the top working set (heaviest weight; ties broken by
 * best estimated 1RM) and produce a double-progression suggestion.
 *
 * weightIncrement: smallest reasonable jump for the equipment type
 *   (e.g. 5 lb for barbell, 2.5 lb dumbbell/machine/cable).
 */
export function suggestNextSession(
  workingSets: WorkingSetInput[],
  repRange: RepRange = DEFAULT_REP_RANGE,
  weightIncrement: number = 5,
): ProgressionSuggestion | null {
  const valid = workingSets.filter((s) => !s.isWarmup);
  if (valid.length === 0) return null;

  // Top working set = heaviest weight; tie-break by best e1RM.
  const topSet = valid.reduce((best, s) => {
    if (s.weight > best.weight) return s;
    if (s.weight === best.weight && estimate1RM(s.weight, s.reps) > estimate1RM(best.weight, best.reps)) {
      return s;
    }
    return best;
  }, valid[0]);

  // "All working sets at current top weight met/exceeded top of range" check:
  // sets performed at the top working weight
  const setsAtTopWeight = valid.filter((s) => s.weight === topSet.weight);
  const allAtTopRepMax = setsAtTopWeight.every((s) => s.reps >= repRange.max);

  if (allAtTopRepMax) {
    return {
      action: "increase_weight",
      suggestedWeight: topSet.weight + weightIncrement,
      suggestedRepTarget: repRange.min,
      reasoning: `You hit ${repRange.max}+ reps on all working sets at ${topSet.weight} lb. Increase weight to ${
        topSet.weight + weightIncrement
      } lb and aim for ${repRange.min} reps.`,
    };
  }

  if (topSet.reps >= repRange.min && topSet.reps < repRange.max) {
    return {
      action: "add_rep",
      suggestedWeight: topSet.weight,
      suggestedRepTarget: topSet.reps + 1,
      reasoning: `You got ${topSet.reps} reps at ${topSet.weight} lb — within range but not maxed. Stay at ${topSet.weight} lb and aim for ${
        topSet.reps + 1
      } reps next time.`,
    };
  }

  // topSet.reps < repRange.min
  return {
    action: "hold_weight",
    suggestedWeight: topSet.weight,
    suggestedRepTarget: repRange.min,
    reasoning: `You got ${topSet.reps} reps at ${topSet.weight} lb — below the target range of ${repRange.min}-${repRange.max}. Hold the weight at ${topSet.weight} lb and focus on hitting ${repRange.min} reps before progressing.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Volume Tracking — MEV / MAV / MRV categorization
// ---------------------------------------------------------------------------
export type VolumeStatus = "under" | "optimal" | "high" | "excessive";

export interface VolumeLandmarks {
  mev: number;
  mav: number;
  mrv: number;
}

export function categorizeVolume(
  weeklySets: number,
  landmarks: VolumeLandmarks,
): VolumeStatus {
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

/**
 * Compute credited weekly volume (sets) per muscle group from a list of
 * working sets (non-warmup), each tagged with primary and optional
 * secondary muscle group ids. Primary gets full credit (1.0), secondary
 * gets half credit (0.5).
 */
export interface SetMuscleTag {
  primaryMuscleGroupId: number;
  secondaryMuscleGroupId: number | null;
  isWarmup: boolean;
}

export function computeWeeklyVolumeByMuscleGroup(
  taggedSets: SetMuscleTag[],
): Map<number, number> {
  const volume = new Map<number, number>();
  for (const s of taggedSets) {
    if (s.isWarmup) continue;
    volume.set(
      s.primaryMuscleGroupId,
      (volume.get(s.primaryMuscleGroupId) ?? 0) + 1,
    );
    if (s.secondaryMuscleGroupId != null) {
      volume.set(
        s.secondaryMuscleGroupId,
        (volume.get(s.secondaryMuscleGroupId) ?? 0) + 0.5,
      );
    }
  }
  return volume;
}

// ---------------------------------------------------------------------------
// 4. Deload / Fatigue Detection
// ---------------------------------------------------------------------------
export interface DeloadReason {
  reason: string;
  detail: string;
}

export interface DeloadResult {
  shouldDeload: boolean;
  reasons: DeloadReason[];
}

/** A single tracked session's estimated 1RM for a "main lift", in chronological order (oldest -> newest). */
export interface TrackedLiftSession {
  exerciseId: number;
  exerciseName: string;
  e1RM: number;
}

/**
 * Condition A: e1RM on 2+ tracked main lifts has decreased or stalled
 * (no improvement) for 3 consecutive sessions in a row.
 *
 * `sessionsByExercise` maps exerciseId -> chronological array (oldest first)
 * of e1RM values (most recent last). We need at least 4 sessions to evaluate
 * 3 consecutive non-improvements (session[n] <= session[n-1] for 3 steps).
 */
export function detectStalledLifts(
  sessionsByExercise: Map<number, { name: string; e1RMs: number[] }>,
): { exerciseId: number; name: string }[] {
  const stalled: { exerciseId: number; name: string }[] = [];
  for (const [exerciseId, { name, e1RMs }] of Array.from(sessionsByExercise.entries())) {
    if (e1RMs.length < 4) continue;
    const lastFour = e1RMs.slice(-4);
    let stalledStreak = true;
    for (let i = 1; i < lastFour.length; i++) {
      if (lastFour[i] > lastFour[i - 1]) {
        stalledStreak = false;
        break;
      }
    }
    if (stalledStreak) stalled.push({ exerciseId, name });
  }
  return stalled;
}

/**
 * Condition B: average RPE on working sets has been >= 9 for the last 2
 * weeks of sessions for a given muscle group.
 */
export function isRpeElevated(
  avgRpeLastTwoWeeks: number | null,
  threshold: number = 9,
): boolean {
  if (avgRpeLastTwoWeeks == null) return false;
  return avgRpeLastTwoWeeks >= threshold;
}

/**
 * Condition C: weekly volume has exceeded MRV for 2+ consecutive weeks for
 * a muscle group. `weeklyVolumes` should be ordered oldest -> newest, and
 * we check whether the last 2+ entries all exceed MRV.
 */
export function hasExceededMrvConsecutively(
  weeklyVolumes: number[],
  mrv: number,
  consecutiveWeeks: number = 2,
): boolean {
  if (weeklyVolumes.length < consecutiveWeeks) return false;
  const lastN = weeklyVolumes.slice(-consecutiveWeeks);
  return lastN.every((v) => v > mrv);
}

export interface MuscleGroupDeloadInput {
  muscleGroupId: number;
  muscleGroupName: string;
  avgRpeLastTwoWeeks: number | null;
  weeklyVolumes: number[]; // oldest -> newest
  mrv: number;
}

/**
 * Evaluate the 3 deload conditions and return an overall recommendation.
 * - stalledLifts: result of detectStalledLifts() across tracked main lifts (global)
 * - muscleGroups: per-muscle-group RPE + volume history
 */
export function detectDeload(
  stalledLifts: { exerciseId: number; name: string }[],
  muscleGroups: MuscleGroupDeloadInput[],
): DeloadResult {
  const reasons: DeloadReason[] = [];

  // Condition 1: 2+ stalled lifts
  if (stalledLifts.length >= 2) {
    reasons.push({
      reason: "Stalled strength on multiple lifts",
      detail: `Estimated 1RM has decreased or stalled for 3 consecutive sessions on: ${stalledLifts
        .map((l) => l.name)
        .join(", ")}.`,
    });
  }

  // Conditions 2 & 3: per muscle group
  for (const mg of muscleGroups) {
    if (isRpeElevated(mg.avgRpeLastTwoWeeks)) {
      reasons.push({
        reason: `High RPE — ${mg.muscleGroupName}`,
        detail: `Average RPE for ${mg.muscleGroupName} has been ${mg.avgRpeLastTwoWeeks?.toFixed(
          1,
        )} (>= 9) over the last 2 weeks, indicating high accumulated fatigue.`,
      });
    }
    if (hasExceededMrvConsecutively(mg.weeklyVolumes, mg.mrv)) {
      reasons.push({
        reason: `Volume over MRV — ${mg.muscleGroupName}`,
        detail: `Weekly volume for ${mg.muscleGroupName} has exceeded MRV (${mg.mrv} sets) for 2+ consecutive weeks.`,
      });
    }
  }

  return {
    shouldDeload: reasons.length > 0,
    reasons,
  };
}
