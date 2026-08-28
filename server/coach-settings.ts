import { storage } from "./storage";
import {
  trainingGoalIds,
  trainingLevelIds,
  type TrainingGoalId,
  type TrainingLevelId,
  type MuscleGroupName,
  type CoachSettings,
  type RecoverySettings,
  muscleGroupDisplayNames,
} from "@shared/schema";
import {
  RECOVERY_HALF_LIFE_HOURS,
  applyExperienceCoachSettings,
  resolveGoalCoachingProfile,
  resolveExperienceCoachingProfile,
  type GoalCoachingProfile,
  type ExperienceCoachingProfile,
  type RecoveryModelOverrides,
} from "@shared/coaching";

export interface EffectiveMuscleCoachSettings {
  muscleGroupId: number;
  muscle: MuscleGroupName;
  displayName: string;
  recoveryHalfLifeHours: number;
  mev: number;
  mav: number;
  mrv: number;
  customized: {
    recoveryHalfLifeHours: boolean;
    volumeLandmarks: boolean;
  };
  learnedRange: { productiveLow: number | null; productiveHigh: number | null; confidence: number; validWeekCount: number; explanation: string };
  forgeDefaults: { recoveryHalfLifeHours: number; mev: number; mav: number; mrv: number };
}

export interface EffectiveCoachContext {
  goal: TrainingGoalId;
  profile: GoalCoachingProfile;
  experience: TrainingLevelId;
  experienceProfile: ExperienceCoachingProfile;
  settings: CoachSettings;
  recoverySettings: RecoverySettings;
  muscles: EffectiveMuscleCoachSettings[];
  muscleById: Map<number, EffectiveMuscleCoachSettings>;
  recoveryOverrides: RecoveryModelOverrides;
  exerciseFatigueCosts: Record<number, number>;
}

export async function getEffectiveCoachContext(userId: number): Promise<EffectiveCoachContext> {
  const [user, settings, recoverySettings, muscleGroups, muscleOverrides, exerciseOverrides, learnedRanges] = await Promise.all([
    storage.getUser(userId),
    storage.getCoachSettings(userId),
    storage.getRecoverySettings(userId),
    storage.getMuscleGroups(),
    storage.getMuscleCoachOverrides(userId),
    storage.getExerciseCoachOverrides(userId),
    storage.getLearnedVolumeRanges(userId),
  ]);
  const rawGoal = user?.trainingGoal as TrainingGoalId | undefined;
  const goal = rawGoal && trainingGoalIds.includes(rawGoal) ? rawGoal : "hypertrophy";
  const rawExperience = user?.trainingLevel as TrainingLevelId | undefined;
  const experience = rawExperience && trainingLevelIds.includes(rawExperience) ? rawExperience : "beginner";
  const effectiveSettings = applyExperienceCoachSettings(settings, experience);
  const overrideByMuscle = new Map(muscleOverrides.map((item) => [item.muscleGroupId, item]));
  const learnedByMuscle = new Map(learnedRanges.map((item) => [item.muscleGroupId, item]));
  const muscles = muscleGroups.map((muscle) => {
    const name = muscle.name as MuscleGroupName;
    const override = overrideByMuscle.get(muscle.id);
    const learned = learnedByMuscle.get(muscle.id);
    const mev = override?.mev ?? muscle.mev;
    const mav = override?.mav ?? muscle.mav;
    const mrv = override?.mrv ?? muscle.mrv;
    // Invalid legacy combinations safely fall back as a unit.
    const validLandmarks = mev >= 0 && mev < mav && mav < mrv;
    return {
      muscleGroupId: muscle.id,
      muscle: name,
      displayName: muscleGroupDisplayNames[name],
      recoveryHalfLifeHours: override?.recoveryHalfLifeHours ?? RECOVERY_HALF_LIFE_HOURS[name],
      mev: validLandmarks ? mev : muscle.mev,
      mav: validLandmarks ? mav : muscle.mav,
      mrv: validLandmarks ? mrv : muscle.mrv,
      customized: {
        recoveryHalfLifeHours: override?.recoveryHalfLifeHours != null,
        volumeLandmarks: override?.mev != null || override?.mav != null || override?.mrv != null,
      },
      learnedRange: learned ?? {
        productiveLow: null,
        productiveHigh: null,
        confidence: 0,
        validWeekCount: 0,
        explanation: "4 more comparable training weeks needed before Coach can estimate this range.",
      },
      forgeDefaults: {
        recoveryHalfLifeHours: RECOVERY_HALF_LIFE_HOURS[name],
        mev: muscle.mev,
        mav: muscle.mav,
        mrv: muscle.mrv,
      },
    };
  });
  const exerciseFatigueCosts = Object.fromEntries(exerciseOverrides.map((item) => [item.exerciseId, item.fatigueCost]));
  const sensitivityMultiplier = effectiveSettings.failureFatigueSensitivity === "low"
    ? 0.75
    : effectiveSettings.failureFatigueSensitivity === "high"
      ? 1.25
      : 1;
  return {
    goal,
    profile: resolveGoalCoachingProfile(goal),
    experience,
    experienceProfile: resolveExperienceCoachingProfile(experience),
    settings: effectiveSettings,
    recoverySettings,
    muscles,
    muscleById: new Map(muscles.map((item) => [item.muscleGroupId, item])),
    recoveryOverrides: {
      muscleHalfLifeHours: Object.fromEntries(muscles.map((item) => [item.muscle, item.recoveryHalfLifeHours])),
      exerciseFatigueCosts,
      failureFatigueMultiplier: sensitivityMultiplier,
    },
    exerciseFatigueCosts,
  };
}
