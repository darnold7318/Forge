import type { MuscleGroupName, Equipment, ExerciseRole, FailureTarget } from "@shared/schema";

// ---------------------------------------------------------------------------
// Muscle groups — 19 groups, MEV/MAV/MRV landmarks (sets/week) derived
// proportionally from the old 10-group values. Shoulders (8/16/24) split
// across FrontDelts/SideDelts/RearDelts with SideDelts weighted highest
// since it responds well to higher frequency/volume.
// ---------------------------------------------------------------------------
export const MUSCLE_GROUPS: { name: MuscleGroupName; mev: number; mav: number; mrv: number }[] = [
  { name: "Chest", mev: 8, mav: 16, mrv: 22 },
  { name: "Back", mev: 8, mav: 16, mrv: 24 },
  { name: "Lats", mev: 8, mav: 16, mrv: 24 },
  { name: "Traps", mev: 4, mav: 12, mrv: 20 },
  { name: "RearDelts", mev: 6, mav: 14, mrv: 22 },
  { name: "SideDelts", mev: 8, mav: 18, mrv: 26 },
  { name: "FrontDelts", mev: 2, mav: 8, mrv: 14 },
  { name: "Biceps", mev: 6, mav: 14, mrv: 22 },
  { name: "Triceps", mev: 6, mav: 14, mrv: 22 },
  { name: "Forearms", mev: 4, mav: 10, mrv: 16 },
  { name: "Abs", mev: 6, mav: 16, mrv: 25 },
  { name: "Obliques", mev: 4, mav: 12, mrv: 20 },
  { name: "Quads", mev: 8, mav: 16, mrv: 22 },
  { name: "Hamstrings", mev: 6, mav: 14, mrv: 20 },
  { name: "Glutes", mev: 4, mav: 12, mrv: 20 },
  { name: "Calves", mev: 8, mav: 16, mrv: 25 },
  { name: "Adductors", mev: 4, mav: 10, mrv: 16 },
  { name: "Abductors", mev: 4, mav: 10, mrv: 16 },
  { name: "LowerBack", mev: 4, mav: 9, mrv: 14 },
];

// ---------------------------------------------------------------------------
// Exercises — ~33 exercises remapped with structured primary/secondary
// muscles, equipment, movement pattern, compound/unilateral flags.
// ---------------------------------------------------------------------------
export interface SeedExercise {
  name: string;
  primaryMuscleGroup: MuscleGroupName;
  secondaryMuscleGroups: MuscleGroupName[];
  equipment: Equipment;
  movementPattern: string;
  isCompound: boolean;
  isUnilateral: boolean;
}

export const EXERCISES: SeedExercise[] = [
  // Chest
  { name: "Barbell Bench Press", primaryMuscleGroup: "Chest", secondaryMuscleGroups: ["FrontDelts", "Triceps"], equipment: "Barbell", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  { name: "Incline Dumbbell Press", primaryMuscleGroup: "Chest", secondaryMuscleGroups: ["FrontDelts", "Triceps"], equipment: "Dumbbell", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  { name: "Cable Fly", primaryMuscleGroup: "Chest", secondaryMuscleGroups: ["FrontDelts"], equipment: "Cable", movementPattern: "Horizontal Push", isCompound: false, isUnilateral: false },
  { name: "Dip (Chest-Focused)", primaryMuscleGroup: "Chest", secondaryMuscleGroups: ["Triceps", "FrontDelts"], equipment: "Bodyweight", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  // Back / Lats
  { name: "Lat Pulldown", primaryMuscleGroup: "Lats", secondaryMuscleGroups: ["Back", "Biceps"], equipment: "Cable", movementPattern: "Vertical Pull", isCompound: true, isUnilateral: false },
  { name: "Pull-Up", primaryMuscleGroup: "Lats", secondaryMuscleGroups: ["Back", "Biceps"], equipment: "Bodyweight", movementPattern: "Vertical Pull", isCompound: true, isUnilateral: false },
  { name: "Barbell Row", primaryMuscleGroup: "Back", secondaryMuscleGroups: ["Lats", "RearDelts", "Biceps"], equipment: "Barbell", movementPattern: "Horizontal Pull", isCompound: true, isUnilateral: false },
  { name: "Seated Cable Row", primaryMuscleGroup: "Back", secondaryMuscleGroups: ["Lats", "RearDelts", "Biceps"], equipment: "Cable", movementPattern: "Horizontal Pull", isCompound: true, isUnilateral: false },
  { name: "Deadlift", primaryMuscleGroup: "Back", secondaryMuscleGroups: ["Hamstrings", "Glutes", "Traps", "LowerBack"], equipment: "Barbell", movementPattern: "Hinge", isCompound: true, isUnilateral: false },
  { name: "Straight-Arm Pulldown", primaryMuscleGroup: "Lats", secondaryMuscleGroups: ["Triceps"], equipment: "Cable", movementPattern: "Vertical Pull", isCompound: false, isUnilateral: false },
  // Traps
  { name: "Barbell Shrug", primaryMuscleGroup: "Traps", secondaryMuscleGroups: ["Forearms"], equipment: "Barbell", movementPattern: "Shrug", isCompound: false, isUnilateral: false },
  // Delts
  { name: "Overhead Press", primaryMuscleGroup: "FrontDelts", secondaryMuscleGroups: ["SideDelts", "Triceps"], equipment: "Barbell", movementPattern: "Vertical Push", isCompound: true, isUnilateral: false },
  { name: "Dumbbell Lateral Raise", primaryMuscleGroup: "SideDelts", secondaryMuscleGroups: [], equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Cable Lateral Raise", primaryMuscleGroup: "SideDelts", secondaryMuscleGroups: [], equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Rear Delt Fly", primaryMuscleGroup: "RearDelts", secondaryMuscleGroups: ["Traps"], equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Face Pull", primaryMuscleGroup: "RearDelts", secondaryMuscleGroups: ["Traps", "SideDelts"], equipment: "Cable", movementPattern: "Horizontal Pull", isCompound: false, isUnilateral: false },
  // Arms
  { name: "Barbell Curl", primaryMuscleGroup: "Biceps", secondaryMuscleGroups: ["Forearms"], equipment: "Barbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Incline Dumbbell Curl", primaryMuscleGroup: "Biceps", secondaryMuscleGroups: ["Forearms"], equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Hammer Curl", primaryMuscleGroup: "Biceps", secondaryMuscleGroups: ["Forearms"], equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Triceps Pushdown", primaryMuscleGroup: "Triceps", secondaryMuscleGroups: [], equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Overhead Triceps Extension", primaryMuscleGroup: "Triceps", secondaryMuscleGroups: [], equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Close-Grip Bench Press", primaryMuscleGroup: "Triceps", secondaryMuscleGroups: ["Chest", "FrontDelts"], equipment: "Barbell", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  { name: "Wrist Curl", primaryMuscleGroup: "Forearms", secondaryMuscleGroups: [], equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  // Core
  { name: "Cable Crunch", primaryMuscleGroup: "Abs", secondaryMuscleGroups: [], equipment: "Cable", movementPattern: "Flexion", isCompound: false, isUnilateral: false },
  { name: "Hanging Leg Raise", primaryMuscleGroup: "Abs", secondaryMuscleGroups: ["Obliques"], equipment: "Bodyweight", movementPattern: "Flexion", isCompound: false, isUnilateral: false },
  { name: "Cable Woodchopper", primaryMuscleGroup: "Obliques", secondaryMuscleGroups: ["Abs"], equipment: "Cable", movementPattern: "Rotation", isCompound: false, isUnilateral: true },
  // Legs
  { name: "Barbell Back Squat", primaryMuscleGroup: "Quads", secondaryMuscleGroups: ["Glutes", "Adductors", "LowerBack"], equipment: "Barbell", movementPattern: "Squat", isCompound: true, isUnilateral: false },
  { name: "Leg Press", primaryMuscleGroup: "Quads", secondaryMuscleGroups: ["Glutes", "Adductors"], equipment: "Machine", movementPattern: "Squat", isCompound: true, isUnilateral: false },
  { name: "Leg Extension", primaryMuscleGroup: "Quads", secondaryMuscleGroups: [], equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Romanian Deadlift", primaryMuscleGroup: "Hamstrings", secondaryMuscleGroups: ["Glutes", "LowerBack"], equipment: "Barbell", movementPattern: "Hinge", isCompound: true, isUnilateral: false },
  { name: "Lying Leg Curl", primaryMuscleGroup: "Hamstrings", secondaryMuscleGroups: [], equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Hip Thrust", primaryMuscleGroup: "Glutes", secondaryMuscleGroups: ["Hamstrings", "Quads"], equipment: "Barbell", movementPattern: "Hinge", isCompound: true, isUnilateral: false },
  { name: "Cable Kickback", primaryMuscleGroup: "Glutes", secondaryMuscleGroups: [], equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Standing Calf Raise", primaryMuscleGroup: "Calves", secondaryMuscleGroups: [], equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Seated Calf Raise", primaryMuscleGroup: "Calves", secondaryMuscleGroups: [], equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Cable Hip Adduction", primaryMuscleGroup: "Adductors", secondaryMuscleGroups: [], equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Cable Hip Abduction", primaryMuscleGroup: "Abductors", secondaryMuscleGroups: ["Glutes"], equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Back Extension", primaryMuscleGroup: "LowerBack", secondaryMuscleGroups: ["Glutes", "Hamstrings"], equipment: "Bodyweight", movementPattern: "Hinge", isCompound: false, isUnilateral: false },
];

// ---------------------------------------------------------------------------
// Workout templates — 2-3 sample templates with realistic prescriptions
// ---------------------------------------------------------------------------
export interface SeedTemplateExercise {
  exerciseName: string;
  exerciseOrder: number;
  exerciseRole: ExerciseRole;
  warmupSets: number;
  topSets: number;
  backoffSets: number;
  backoffReductionPercent: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  tempo?: string;
  targetRir: number;
  failureTarget: FailureTarget;
  intensityTechnique?: string;
  restSeconds: number;
  notes?: string;
}

export interface SeedTemplate {
  name: string;
  notes: string;
  exercises: SeedTemplateExercise[];
}

export const WORKOUT_TEMPLATES: SeedTemplate[] = [
  {
    name: "Push Day",
    notes: "Chest, shoulders, and triceps focused push session.",
    exercises: [
      { exerciseName: "Barbell Bench Press", exerciseOrder: 1, exerciseRole: "Primary Compound", warmupSets: 2, topSets: 1, backoffSets: 3, backoffReductionPercent: 10, targetSets: 4, targetRepsMin: 5, targetRepsMax: 8, tempo: "Controlled", targetRir: 2, failureTarget: "Never", restSeconds: 150 },
      { exerciseName: "Incline Dumbbell Press", exerciseOrder: 2, exerciseRole: "Secondary Compound", warmupSets: 1, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2, failureTarget: "Never", restSeconds: 120 },
      { exerciseName: "Overhead Press", exerciseOrder: 3, exerciseRole: "Secondary Compound", warmupSets: 1, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 6, targetRepsMax: 10, targetRir: 2, failureTarget: "Never", restSeconds: 120 },
      { exerciseName: "Cable Fly", exerciseOrder: 4, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 10, targetRepsMax: 15, targetRir: 1, failureTarget: "Last Set", restSeconds: 75 },
      { exerciseName: "Dumbbell Lateral Raise", exerciseOrder: 5, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 4, targetRepsMin: 12, targetRepsMax: 20, targetRir: 1, failureTarget: "Every Set", restSeconds: 60 },
      { exerciseName: "Triceps Pushdown", exerciseOrder: 6, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 10, targetRepsMax: 15, targetRir: 1, failureTarget: "Last Set", restSeconds: 60 },
    ],
  },
  {
    name: "Pull Day",
    notes: "Back, lats, rear delts, and biceps focused pull session.",
    exercises: [
      { exerciseName: "Deadlift", exerciseOrder: 1, exerciseRole: "Primary Compound", warmupSets: 3, topSets: 1, backoffSets: 2, backoffReductionPercent: 12, targetSets: 3, targetRepsMin: 3, targetRepsMax: 6, tempo: "Controlled", targetRir: 2, failureTarget: "Never", restSeconds: 180 },
      { exerciseName: "Pull-Up", exerciseOrder: 2, exerciseRole: "Secondary Compound", warmupSets: 1, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 4, targetRepsMin: 6, targetRepsMax: 10, targetRir: 2, failureTarget: "Never", restSeconds: 120 },
      { exerciseName: "Barbell Row", exerciseOrder: 3, exerciseRole: "Secondary Compound", warmupSets: 1, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2, failureTarget: "Never", restSeconds: 120 },
      { exerciseName: "Seated Cable Row", exerciseOrder: 4, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 10, targetRepsMax: 15, targetRir: 1, failureTarget: "Last Set", restSeconds: 90 },
      { exerciseName: "Face Pull", exerciseOrder: 5, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 12, targetRepsMax: 20, targetRir: 1, failureTarget: "Last Set", restSeconds: 60 },
      { exerciseName: "Barbell Curl", exerciseOrder: 6, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 1, failureTarget: "Last Set", restSeconds: 75 },
      { exerciseName: "Hammer Curl", exerciseOrder: 7, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 10, targetRepsMax: 15, targetRir: 1, failureTarget: "Last Set", restSeconds: 60 },
    ],
  },
  {
    name: "Leg Day",
    notes: "Quad-dominant compound work with posterior chain and calves.",
    exercises: [
      { exerciseName: "Barbell Back Squat", exerciseOrder: 1, exerciseRole: "Primary Compound", warmupSets: 3, topSets: 1, backoffSets: 3, backoffReductionPercent: 10, targetSets: 4, targetRepsMin: 5, targetRepsMax: 8, tempo: "Controlled", targetRir: 2, failureTarget: "Never", restSeconds: 180 },
      { exerciseName: "Romanian Deadlift", exerciseOrder: 2, exerciseRole: "Secondary Compound", warmupSets: 1, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRir: 2, failureTarget: "Never", restSeconds: 120 },
      { exerciseName: "Leg Press", exerciseOrder: 3, exerciseRole: "Secondary Compound", warmupSets: 1, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 10, targetRepsMax: 15, targetRir: 1, failureTarget: "Last Set", restSeconds: 120 },
      { exerciseName: "Leg Extension", exerciseOrder: 4, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 12, targetRepsMax: 18, targetRir: 1, failureTarget: "Last Set", restSeconds: 75 },
      { exerciseName: "Lying Leg Curl", exerciseOrder: 5, exerciseRole: "Isolation", warmupSets: 0, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 3, targetRepsMin: 10, targetRepsMax: 15, targetRir: 1, failureTarget: "Last Set", restSeconds: 75 },
      { exerciseName: "Standing Calf Raise", exerciseOrder: 6, exerciseRole: "Isolation", warmupSets: 1, topSets: 0, backoffSets: 0, backoffReductionPercent: 0, targetSets: 4, targetRepsMin: 10, targetRepsMax: 15, targetRir: 1, failureTarget: "Every Set", restSeconds: 60 },
    ],
  },
];
