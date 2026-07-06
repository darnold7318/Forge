import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Users — lightweight named profiles for data separation (no auth/passwords)
// ---------------------------------------------------------------------------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  colorAccent: text("color_accent"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ---------------------------------------------------------------------------
// Muscle Groups — 19 groups matching the reference C# MuscleGroup enum
// ---------------------------------------------------------------------------
export const muscleGroupNames = [
  "Chest",
  "Back",
  "Lats",
  "Traps",
  "RearDelts",
  "SideDelts",
  "FrontDelts",
  "Biceps",
  "Triceps",
  "Forearms",
  "Abs",
  "Obliques",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Adductors",
  "Abductors",
  "LowerBack",
] as const;
export type MuscleGroupName = (typeof muscleGroupNames)[number];

export const muscleGroupDisplayNames: Record<MuscleGroupName, string> = {
  Chest: "Chest",
  Back: "Back",
  Lats: "Lats",
  Traps: "Traps",
  RearDelts: "Rear Delts",
  SideDelts: "Side Delts",
  FrontDelts: "Front Delts",
  Biceps: "Biceps",
  Triceps: "Triceps",
  Forearms: "Forearms",
  Abs: "Abs",
  Obliques: "Obliques",
  Quads: "Quads",
  Hamstrings: "Hamstrings",
  Glutes: "Glutes",
  Calves: "Calves",
  Adductors: "Adductors",
  Abductors: "Abductors",
  LowerBack: "Lower Back",
};

export const muscleGroups = sqliteTable("muscle_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(), // one of muscleGroupNames
  mev: real("mev").notNull(), // Minimum Effective Volume (sets/week)
  mav: real("mav").notNull(), // Maximum Adaptive Volume (sets/week)
  mrv: real("mrv").notNull(), // Maximum Recoverable Volume (sets/week)
});

export const insertMuscleGroupSchema = createInsertSchema(muscleGroups)
  .omit({ id: true })
  .extend({ name: z.enum(muscleGroupNames) });

export type InsertMuscleGroup = z.infer<typeof insertMuscleGroupSchema>;
export type MuscleGroup = typeof muscleGroups.$inferSelect;

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------
export const equipmentTypes = [
  "Barbell",
  "Dumbbell",
  "Cable",
  "Machine",
  "SmithMachine",
  "Bodyweight",
  "Band",
  "Kettlebell",
  "PlateLoaded",
  "Other",
] as const;
export type Equipment = (typeof equipmentTypes)[number];

export const exercises = sqliteTable("exercises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  primaryMuscleGroupId: integer("primary_muscle_group_id")
    .notNull()
    .references(() => muscleGroups.id),
  // JSON array of muscle group IDs (text column — SQLite has no array type)
  secondaryMuscles: text("secondary_muscles").notNull().default("[]"),
  equipment: text("equipment").notNull(), // one of equipmentTypes
  movementPattern: text("movement_pattern"),
  isCompound: integer("is_compound", { mode: "boolean" })
    .notNull()
    .default(false),
  isUnilateral: integer("is_unilateral", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const insertExerciseSchema = createInsertSchema(exercises)
  .omit({ id: true })
  .extend({
    equipment: z.enum(equipmentTypes),
    secondaryMuscles: z.array(z.number()).default([]).transform((v) => JSON.stringify(v)),
  });

export type InsertExercise = z.infer<typeof insertExerciseSchema>;
export type Exercise = typeof exercises.$inferSelect;
// Convenience client-side shape with secondaryMuscles parsed back to number[]
export type ExerciseWithParsedMuscles = Omit<Exercise, "secondaryMuscles"> & {
  secondaryMuscles: number[];
};

// ---------------------------------------------------------------------------
// Workout Templates
// ---------------------------------------------------------------------------
export const workoutTemplates = sqliteTable("workout_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  notes: text("notes"),
});

export const insertWorkoutTemplateSchema = createInsertSchema(
  workoutTemplates,
).omit({ id: true });

export type InsertWorkoutTemplate = z.infer<
  typeof insertWorkoutTemplateSchema
>;
export type WorkoutTemplate = typeof workoutTemplates.$inferSelect;

export const exerciseRoles = [
  "Primary Compound",
  "Secondary Compound",
  "Isolation",
] as const;
export type ExerciseRole = (typeof exerciseRoles)[number];

export const failureTargets = [
  "Never",
  "Last Set",
  "Every Set",
  "Technical Failure",
] as const;
export type FailureTarget = (typeof failureTargets)[number];

export const workoutTemplateExercises = sqliteTable(
  "workout_template_exercises",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workoutTemplateId: integer("workout_template_id")
      .notNull()
      .references(() => workoutTemplates.id),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id),
    exerciseOrder: integer("exercise_order").notNull(),
    exerciseRole: text("exercise_role").notNull().default("Isolation"),
    warmupSets: integer("warmup_sets").notNull().default(0),
    topSets: integer("top_sets").notNull().default(0),
    backoffSets: integer("backoff_sets").notNull().default(0),
    backoffReductionPercent: real("backoff_reduction_percent")
      .notNull()
      .default(0),
    targetSets: integer("target_sets").notNull().default(3),
    targetRepsMin: integer("target_reps_min").notNull().default(8),
    targetRepsMax: integer("target_reps_max").notNull().default(12),
    tempo: text("tempo"),
    targetRir: integer("target_rir").notNull().default(2),
    failureTarget: text("failure_target").notNull().default("Never"),
    intensityTechnique: text("intensity_technique"),
    restSeconds: integer("rest_seconds").notNull().default(90),
    notes: text("notes"),
  },
);

export const insertWorkoutTemplateExerciseSchema = createInsertSchema(
  workoutTemplateExercises,
)
  .omit({ id: true })
  .extend({
    exerciseRole: z.enum(exerciseRoles).default("Isolation"),
    failureTarget: z.enum(failureTargets).default("Never"),
  });

export type InsertWorkoutTemplateExercise = z.infer<
  typeof insertWorkoutTemplateExerciseSchema
>;
export type WorkoutTemplateExercise =
  typeof workoutTemplateExercises.$inferSelect;

// ---------------------------------------------------------------------------
// Workouts (logged sessions)
// ---------------------------------------------------------------------------
export const workouts = sqliteTable("workouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  date: text("date").notNull(), // ISO date string (startedAt)
  name: text("name"), // e.g. "Push Day"
  notes: text("notes"),
  workoutTemplateId: integer("workout_template_id").references(
    () => workoutTemplates.id,
  ),
});

export const insertWorkoutSchema = createInsertSchema(workouts).omit({
  id: true,
});

export type InsertWorkout = z.infer<typeof insertWorkoutSchema>;
export type Workout = typeof workouts.$inferSelect;

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------
export const sets = sqliteTable("sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workoutId: integer("workout_id")
    .notNull()
    .references(() => workouts.id),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => exercises.id),
  setNumber: integer("set_number").notNull(),
  weight: real("weight").notNull(),
  reps: integer("reps").notNull(),
  rir: real("rir"), // nullable, Reps In Reserve (0-4+)
  isWarmup: integer("is_warmup", { mode: "boolean" }).notNull().default(false),
});

export const insertSetSchema = createInsertSchema(sets).omit({ id: true });

export type InsertSet = z.infer<typeof insertSetSchema>;
export type Set = typeof sets.$inferSelect;

// ---------------------------------------------------------------------------
// Bodyweight Logs
// ---------------------------------------------------------------------------
export const bodyweightLogs = sqliteTable("bodyweight_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  date: text("date").notNull(),
  weight: real("weight").notNull(),
});

export const insertBodyweightLogSchema = createInsertSchema(
  bodyweightLogs,
).omit({ id: true });

export type InsertBodyweightLog = z.infer<typeof insertBodyweightLogSchema>;
export type BodyweightLog = typeof bodyweightLogs.$inferSelect;
