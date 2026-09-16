import type { WorkoutExerciseSuggestion } from "@shared/coaching";
import { applyAdvancedMesocyclePlan, advancedVolumeKey, type AdvancedExerciseVolumeProfile,
  type AdvancedTemplateExercise, type VolumeLandmark } from "@shared/advanced-trainer";
import type { GuidedPlanExerciseInput } from "@shared/guided-workout";
import type { EffectiveCoachContext, EffectiveMuscleCoachSettings } from "./coach-settings";

export type IntegratedSuggestion = WorkoutExerciseSuggestion & { exerciseId: number };

// Split chest/back rows share one allowance, never two full weekly targets.
// Explicit overrides win; when several customize one group, use the more
// conservative target. Defaults combine with max, not addition.
export function resolveCycleVolumeLandmarks(muscles: EffectiveMuscleCoachSettings[]): Record<string, VolumeLandmark> {
  const keys = Array.from(new Set(muscles.map((muscle) => advancedVolumeKey(muscle.muscle))));
  return Object.fromEntries(keys.map((key) => {
    const grouped = muscles.filter((muscle) => advancedVolumeKey(muscle.muscle) === key);
    const custom = grouped.filter((muscle) => muscle.customized.volumeLandmarks);
    const chosen = custom.length ? custom : grouped;
    const combine = custom.length ? Math.min : Math.max;
    return [key, { label: key, mev: combine(...chosen.map((muscle) => muscle.mev)),
      mav: combine(...chosen.map((muscle) => muscle.mav)), mrv: combine(...chosen.map((muscle) => muscle.mrv)) }];
  }));
}

export function integrateCycleSuggestions(args: {
  context: Pick<EffectiveCoachContext, "loggingMode" | "cycle" | "muscles"> & Partial<Pick<EffectiveCoachContext, "experienceProfile">>;
  suggestions: IntegratedSuggestion[];
  exercises: GuidedPlanExerciseInput[];
  allTemplateExercises: AdvancedTemplateExercise[];
  volumeProfiles: AdvancedExerciseVolumeProfile[];
  equipmentById: Map<number, { minWeight: number; maxWeight: number; weightIncrement: number }>;
}): IntegratedSuggestion[] {
  const { context } = args;
  if (context.loggingMode !== "advanced_guided") return args.suggestions;
  if (!context.cycle || context.cycle.phase === "review") {
    const notice = context.cycle ? "Review this mesocycle and explicitly start the next one before training."
      : "Start a mesocycle in Advanced Guided Trainer before training. These are baseline Coach targets, not a started cycle.";
    return args.suggestions.map((suggestion) => ({ ...suggestion, mesocycle: null, cycleNotice: notice, sessionAvailable: false }));
  }
  const limitedIds = args.suggestions.filter((suggestion) => ["Reduce Or Delay", "Reduce Load", "Hold Progression", "Hold Weight", "Repeat Or Reduce"].includes(suggestion.recommendation)
    || suggestion.setRecommendation === "Reduce Set" || suggestion.limitingMuscleNote
    || suggestion.fatiguePercent >= 70 || suggestion.muscleContexts?.some((muscle) => muscle.volumeStatus === "excessive" || muscle.volumeStatus === "high" || muscle.recoveryStatus === "Needs Rest"))
    .map((suggestion) => suggestion.exerciseId);
  const plan = applyAdvancedMesocyclePlan({ exercises: args.exercises, allTemplateExercises: args.allTemplateExercises,
    volumeProfiles: args.volumeProfiles, state: context.cycle, volumeLandmarks: resolveCycleVolumeLandmarks(context.muscles),
    recoveryLimitedExerciseIds: limitedIds, maxRecommendedSets: context.experienceProfile?.maxRecommendedSets });
  const planById = new Map(plan.exercises.map((exercise) => [exercise.exerciseId, exercise]));
  return args.suggestions.map((suggestion) => {
    const target = planById.get(suggestion.exerciseId);
    if (!target) return suggestion;
    if (target.skipped) return { ...suggestion, recommendation: "Session Volume Cap", recommendedWorkingSets: 0, prescribedSets: 0,
      suggestedGoal: "Omit from this session: your muscle/session set cap is already reached.", nextGoalText: "Keep the earlier planned exercises; do not add more direct work for this muscle today.",
      reason: "Your active mesocycle's muscle/session set cap takes priority over this template exercise.",
      plainLanguageReason: "Your muscle/session set cap is already reached.", excludeFromSession: true, mesocycle: plan.metadata,
      sessionAvailable: true, cycleNotice: "Omitted to respect your muscle/session set cap." };
    const equipment = args.equipmentById.get(suggestion.exerciseId);
    let weight = target.targetWeight;
    if (context.cycle!.phase === "deload" && equipment && weight > 0) {
      // Reduce onto available equipment, never round a deload load upward.
      weight = Math.max(0, Math.min(equipment.maxWeight, Math.round((equipment.minWeight
        + Math.floor((weight - equipment.minWeight) / equipment.weightIncrement) * equipment.weightIncrement) * 100) / 100));
    }
    const duration = suggestion.trackingMode === "duration";
    const goal = duration ? `${target.workingSets} holds x ${target.targetDurationMinSeconds}-${target.targetDurationMaxSeconds} sec`
      : `${target.workingSets} sets x ${target.targetRepsMin}-${target.targetRepsMax} @ RIR ${target.targetRirMin}-${target.targetRirMax}`;
    const suggestedGoal = goal + (weight > 0 ? ` at ${weight} lb` : "");
    const limited = limitedIds.includes(suggestion.exerciseId);
    const cycleReason = context.cycle!.phase === "deload" ? `Deload week: reduced working sets and about ${context.cycle!.settings.deloadLoadPercent}% of normal load, rounded down to your equipment. No failure work.`
      : `Cycle #${context.cycle!.cycleId}, accumulation week ${context.cycle!.weekNumber}: cycle volume and RIR use your active settings and effective muscle-volume landmarks.`;
    const reason = `${cycleReason} ${limited ? "Recovery/volume limits override planned increases. " : ""}${context.cycle!.phase === "deload" ? "Accumulation progression is paused during this recovery week." : suggestion.reason}`;
    return { ...suggestion, recommendation: context.cycle!.phase === "deload" ? "Deload Technique" : limited ? suggestion.recommendation : "Mesocycle Target",
      suggestedGoal, nextGoalText: `Next session: ${suggestedGoal}. ${limited ? "Take additional rest if needed." : "Use consistent technique."}`,
      reason, plainLanguageReason: reason, effortGuidance: duration ? suggestion.effortGuidance : `Stop with ${target.targetRirMin}-${target.targetRirMax} good reps in reserve.`,
      suggestedWeight: weight, recommendedWorkingSets: target.workingSets, prescribedSets: target.workingSets,
      targetRirMin: target.targetRirMin, targetRirMax: target.targetRirMax,
      prescribedRirMin: target.targetRirMin, prescribedRirMax: target.targetRirMax,
      targetRepsMin: target.targetRepsMin, targetRepsMax: target.targetRepsMax,
      setRecommendation: context.cycle!.phase === "deload" ? "Reduce Set" : limited ? suggestion.setRecommendation : "Maintain Sets",
      mesocycle: plan.metadata, cycleNotice: cycleReason, sessionAvailable: true };
  });
}
