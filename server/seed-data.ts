import type { MuscleGroupName, Equipment, ExerciseRole, FailureTarget } from "@shared/schema";

// ---------------------------------------------------------------------------
// Muscle groups — starter MEV/MAV/MRV landmarks for the 20-group hypertrophy
// taxonomy. These application defaults are editable in code and are not
// individualized physiological constants.
// ---------------------------------------------------------------------------
export const MUSCLE_GROUPS: { name: MuscleGroupName; mev: number; mav: number; mrv: number }[] = [
  // Starter application defaults, not individualized physiological constants.
  { name: "UpperChest", mev: 4, mav: 9, mrv: 14 },
  { name: "MidLowerChest", mev: 6, mav: 12, mrv: 18 },
  { name: "Lats", mev: 6, mav: 14, mrv: 22 },
  { name: "UpperMidBack", mev: 6, mav: 14, mrv: 22 },
  { name: "Traps", mev: 4, mav: 10, mrv: 18 },
  { name: "SpinalErectors", mev: 3, mav: 7, mrv: 12 },
  { name: "FrontDelts", mev: 2, mav: 7, mrv: 12 },
  { name: "SideDelts", mev: 6, mav: 16, mrv: 24 },
  { name: "RearDelts", mev: 5, mav: 13, mrv: 20 },
  { name: "Biceps", mev: 6, mav: 14, mrv: 22 },
  { name: "Triceps", mev: 6, mav: 14, mrv: 22 },
  { name: "Forearms", mev: 4, mav: 10, mrv: 16 },
  { name: "Quads", mev: 8, mav: 16, mrv: 22 },
  { name: "Hamstrings", mev: 6, mav: 14, mrv: 20 },
  { name: "Glutes", mev: 4, mav: 12, mrv: 20 },
  { name: "Adductors", mev: 3, mav: 8, mrv: 14 },
  { name: "Abductors", mev: 3, mav: 8, mrv: 14 },
  { name: "Calves", mev: 8, mav: 16, mrv: 25 },
  { name: "Abs", mev: 6, mav: 16, mrv: 25 },
  { name: "Obliques", mev: 4, mav: 10, mrv: 18 },
];

// ---------------------------------------------------------------------------
// Exercises — built-in catalog with curated effective-set stimulus defaults.
// ---------------------------------------------------------------------------
export interface SeedExercise {
  name: string;
  stimulus: Partial<Record<MuscleGroupName, number>>;
  equipment: Equipment;
  movementPattern: string;
  isCompound: boolean;
  isUnilateral: boolean;
}

export const EXERCISES: SeedExercise[] = [
  // Chest
  { name: "Barbell Bench Press", stimulus: { MidLowerChest: 1, UpperChest: 0.35, FrontDelts: 0.4, Triceps: 0.35 }, equipment: "Barbell", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  { name: "Incline Dumbbell Press", stimulus: { UpperChest: 1, MidLowerChest: 0.5, FrontDelts: 0.4, Triceps: 0.35 }, equipment: "Dumbbell", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  { name: "Cable Fly", stimulus: { MidLowerChest: 1, UpperChest: 0.3, FrontDelts: 0.15 }, equipment: "Cable", movementPattern: "Horizontal Push", isCompound: false, isUnilateral: false },
  { name: "Dip (Chest-Focused)", stimulus: { MidLowerChest: 1, Triceps: 0.45, FrontDelts: 0.25 }, equipment: "Bodyweight", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  // Back / Lats
  { name: "Lat Pulldown", stimulus: { Lats: 1, UpperMidBack: 0.3, Biceps: 0.4, Forearms: 0.15 }, equipment: "Cable", movementPattern: "Vertical Pull", isCompound: true, isUnilateral: false },
  { name: "Pull-Up", stimulus: { Lats: 1, UpperMidBack: 0.35, Biceps: 0.4, Forearms: 0.2 }, equipment: "Bodyweight", movementPattern: "Vertical Pull", isCompound: true, isUnilateral: false },
  { name: "Barbell Row", stimulus: { UpperMidBack: 1, Lats: 0.65, RearDelts: 0.35, Biceps: 0.4, Forearms: 0.2, SpinalErectors: 0.35 }, equipment: "Barbell", movementPattern: "Horizontal Pull", isCompound: true, isUnilateral: false },
  { name: "Seated Cable Row", stimulus: { UpperMidBack: 1, Lats: 0.7, RearDelts: 0.3, Biceps: 0.4, Forearms: 0.15, SpinalErectors: 0.15 }, equipment: "Cable", movementPattern: "Horizontal Pull", isCompound: true, isUnilateral: false },
  { name: "Deadlift", stimulus: { SpinalErectors: 1, Glutes: 0.7, Hamstrings: 0.55, Traps: 0.5, UpperMidBack: 0.25, Forearms: 0.3, Quads: 0.2 }, equipment: "Barbell", movementPattern: "Hinge", isCompound: true, isUnilateral: false },
  { name: "Straight-Arm Pulldown", stimulus: { Lats: 1, Triceps: 0.1 }, equipment: "Cable", movementPattern: "Vertical Pull", isCompound: false, isUnilateral: false },
  // Traps
  { name: "Barbell Shrug", stimulus: { Traps: 1, Forearms: 0.2 }, equipment: "Barbell", movementPattern: "Shrug", isCompound: false, isUnilateral: false },
  // Delts
  { name: "Overhead Press", stimulus: { FrontDelts: 1, SideDelts: 0.45, Triceps: 0.45, UpperChest: 0.15 }, equipment: "Barbell", movementPattern: "Vertical Push", isCompound: true, isUnilateral: false },
  { name: "Dumbbell Lateral Raise", stimulus: { SideDelts: 1, Traps: 0.1 }, equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Cable Lateral Raise", stimulus: { SideDelts: 1, Traps: 0.1 }, equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Rear Delt Fly", stimulus: { RearDelts: 1, UpperMidBack: 0.3, Traps: 0.2 }, equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Face Pull", stimulus: { RearDelts: 1, UpperMidBack: 0.45, Traps: 0.35, SideDelts: 0.15 }, equipment: "Cable", movementPattern: "Horizontal Pull", isCompound: false, isUnilateral: false },
  // Arms
  { name: "Barbell Curl", stimulus: { Biceps: 1, Forearms: 0.25 }, equipment: "Barbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Incline Dumbbell Curl", stimulus: { Biceps: 1, Forearms: 0.2 }, equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Hammer Curl", stimulus: { Biceps: 0.75, Forearms: 0.65 }, equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Triceps Pushdown", stimulus: { Triceps: 1 }, equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Overhead Triceps Extension", stimulus: { Triceps: 1 }, equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Close-Grip Bench Press", stimulus: { Triceps: 1, MidLowerChest: 0.5, FrontDelts: 0.3, UpperChest: 0.15 }, equipment: "Barbell", movementPattern: "Horizontal Push", isCompound: true, isUnilateral: false },
  { name: "Wrist Curl", stimulus: { Forearms: 1 }, equipment: "Dumbbell", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  // Core
  { name: "Cable Crunch", stimulus: { Abs: 1 }, equipment: "Cable", movementPattern: "Flexion", isCompound: false, isUnilateral: false },
  { name: "Hanging Leg Raise", stimulus: { Abs: 1, Obliques: 0.2 }, equipment: "Bodyweight", movementPattern: "Flexion", isCompound: false, isUnilateral: false },
  { name: "Cable Woodchopper", stimulus: { Obliques: 1, Abs: 0.4 }, equipment: "Cable", movementPattern: "Rotation", isCompound: false, isUnilateral: true },
  // Legs
  { name: "Barbell Back Squat", stimulus: { Quads: 1, Glutes: 0.7, Adductors: 0.4, SpinalErectors: 0.3, Hamstrings: 0.15 }, equipment: "Barbell", movementPattern: "Squat", isCompound: true, isUnilateral: false },
  { name: "Leg Press", stimulus: { Quads: 1, Glutes: 0.6, Adductors: 0.3, Hamstrings: 0.1 }, equipment: "Machine", movementPattern: "Squat", isCompound: true, isUnilateral: false },
  { name: "Leg Extension", stimulus: { Quads: 1 }, equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Romanian Deadlift", stimulus: { Hamstrings: 1, Glutes: 0.75, SpinalErectors: 0.4, Forearms: 0.15 }, equipment: "Barbell", movementPattern: "Hinge", isCompound: true, isUnilateral: false },
  { name: "Lying Leg Curl", stimulus: { Hamstrings: 1 }, equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Hip Thrust", stimulus: { Glutes: 1, Hamstrings: 0.25, Quads: 0.15 }, equipment: "Barbell", movementPattern: "Hinge", isCompound: true, isUnilateral: false },
  { name: "Cable Kickback", stimulus: { Glutes: 1, Hamstrings: 0.1 }, equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Standing Calf Raise", stimulus: { Calves: 1 }, equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Seated Calf Raise", stimulus: { Calves: 1 }, equipment: "Machine", movementPattern: "Isolation", isCompound: false, isUnilateral: false },
  { name: "Cable Hip Adduction", stimulus: { Adductors: 1 }, equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Cable Hip Abduction", stimulus: { Abductors: 1, Glutes: 0.25 }, equipment: "Cable", movementPattern: "Isolation", isCompound: false, isUnilateral: true },
  { name: "Back Extension", stimulus: { SpinalErectors: 1, Glutes: 0.55, Hamstrings: 0.45 }, equipment: "Bodyweight", movementPattern: "Hinge", isCompound: false, isUnilateral: false },
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
