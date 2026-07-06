import type { InsertMuscleGroup, InsertExercise } from "@shared/schema";

// RP-style landmark defaults from the spec.
export const MUSCLE_GROUPS: InsertMuscleGroup[] = [
  { name: "Chest", mev: 8, mav: 14, mrv: 22 },
  { name: "Back", mev: 10, mav: 16, mrv: 25 },
  { name: "Shoulders", mev: 8, mav: 16, mrv: 24 },
  { name: "Biceps", mev: 6, mav: 14, mrv: 20 },
  { name: "Triceps", mev: 6, mav: 12, mrv: 18 },
  { name: "Quads", mev: 8, mav: 14, mrv: 20 },
  { name: "Hamstrings", mev: 6, mav: 12, mrv: 16 },
  { name: "Glutes", mev: 4, mav: 12, mrv: 16 },
  { name: "Calves", mev: 8, mav: 14, mrv: 20 },
  { name: "Abs", mev: 0, mav: 12, mrv: 20 },
];

// Exercises reference muscle groups by NAME here; seeding logic resolves to IDs.
export interface ExerciseSeed {
  name: string;
  primaryMuscleGroup: string;
  secondaryMuscleGroup: string | null;
  equipment: InsertExercise["equipment"];
}

export const EXERCISES: ExerciseSeed[] = [
  // Chest
  { name: "Bench Press", primaryMuscleGroup: "Chest", secondaryMuscleGroup: "Triceps", equipment: "barbell" },
  { name: "Incline DB Press", primaryMuscleGroup: "Chest", secondaryMuscleGroup: "Shoulders", equipment: "dumbbell" },
  { name: "Machine Chest Press", primaryMuscleGroup: "Chest", secondaryMuscleGroup: "Triceps", equipment: "machine" },
  { name: "Cable Fly", primaryMuscleGroup: "Chest", secondaryMuscleGroup: null, equipment: "cable" },
  { name: "Push-Up", primaryMuscleGroup: "Chest", secondaryMuscleGroup: "Triceps", equipment: "bodyweight" },
  // Back
  { name: "Lat Pulldown", primaryMuscleGroup: "Back", secondaryMuscleGroup: "Biceps", equipment: "cable" },
  { name: "Barbell Row", primaryMuscleGroup: "Back", secondaryMuscleGroup: "Biceps", equipment: "barbell" },
  { name: "Pull-Up", primaryMuscleGroup: "Back", secondaryMuscleGroup: "Biceps", equipment: "bodyweight" },
  { name: "Seated Cable Row", primaryMuscleGroup: "Back", secondaryMuscleGroup: "Biceps", equipment: "cable" },
  { name: "Deadlift", primaryMuscleGroup: "Back", secondaryMuscleGroup: "Hamstrings", equipment: "barbell" },
  // Shoulders
  { name: "Overhead Press", primaryMuscleGroup: "Shoulders", secondaryMuscleGroup: "Triceps", equipment: "barbell" },
  { name: "Lateral Raise", primaryMuscleGroup: "Shoulders", secondaryMuscleGroup: null, equipment: "dumbbell" },
  { name: "Rear Delt Fly", primaryMuscleGroup: "Shoulders", secondaryMuscleGroup: "Back", equipment: "dumbbell" },
  { name: "Machine Shoulder Press", primaryMuscleGroup: "Shoulders", secondaryMuscleGroup: "Triceps", equipment: "machine" },
  // Biceps
  { name: "Barbell Curl", primaryMuscleGroup: "Biceps", secondaryMuscleGroup: null, equipment: "barbell" },
  { name: "Hammer Curl", primaryMuscleGroup: "Biceps", secondaryMuscleGroup: null, equipment: "dumbbell" },
  { name: "Cable Curl", primaryMuscleGroup: "Biceps", secondaryMuscleGroup: null, equipment: "cable" },
  // Triceps
  { name: "Tricep Pushdown", primaryMuscleGroup: "Triceps", secondaryMuscleGroup: null, equipment: "cable" },
  { name: "Skull Crusher", primaryMuscleGroup: "Triceps", secondaryMuscleGroup: null, equipment: "barbell" },
  { name: "Overhead Tricep Extension", primaryMuscleGroup: "Triceps", secondaryMuscleGroup: null, equipment: "dumbbell" },
  // Quads
  { name: "Back Squat", primaryMuscleGroup: "Quads", secondaryMuscleGroup: "Glutes", equipment: "barbell" },
  { name: "Leg Press", primaryMuscleGroup: "Quads", secondaryMuscleGroup: "Glutes", equipment: "machine" },
  { name: "Leg Extension", primaryMuscleGroup: "Quads", secondaryMuscleGroup: null, equipment: "machine" },
  { name: "Walking Lunge", primaryMuscleGroup: "Quads", secondaryMuscleGroup: "Glutes", equipment: "dumbbell" },
  // Hamstrings
  { name: "Romanian Deadlift", primaryMuscleGroup: "Hamstrings", secondaryMuscleGroup: "Glutes", equipment: "barbell" },
  { name: "Leg Curl", primaryMuscleGroup: "Hamstrings", secondaryMuscleGroup: null, equipment: "machine" },
  // Glutes
  { name: "Hip Thrust", primaryMuscleGroup: "Glutes", secondaryMuscleGroup: "Hamstrings", equipment: "barbell" },
  { name: "Cable Kickback", primaryMuscleGroup: "Glutes", secondaryMuscleGroup: null, equipment: "cable" },
  // Calves
  { name: "Standing Calf Raise", primaryMuscleGroup: "Calves", secondaryMuscleGroup: null, equipment: "machine" },
  { name: "Seated Calf Raise", primaryMuscleGroup: "Calves", secondaryMuscleGroup: null, equipment: "machine" },
  // Abs
  { name: "Cable Crunch", primaryMuscleGroup: "Abs", secondaryMuscleGroup: null, equipment: "cable" },
  { name: "Plank", primaryMuscleGroup: "Abs", secondaryMuscleGroup: null, equipment: "bodyweight" },
  { name: "Hanging Leg Raise", primaryMuscleGroup: "Abs", secondaryMuscleGroup: null, equipment: "bodyweight" },
];
