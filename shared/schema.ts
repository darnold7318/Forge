import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------- Muscle Groups ----------
export const muscleGroups = sqliteTable("muscle_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  mev: real("mev").notNull(), // Minimum Effective Volume (sets/week)
  mav: real("mav").notNull(), // Maximum Adaptive Volume (sets/week)
  mrv: real("mrv").notNull(), // Maximum Recoverable Volume (sets/week)
});

export const insertMuscleGroupSchema = createInsertSchema(muscleGroups).omit({
  id: true,
});

export type InsertMuscleGroup = z.infer<typeof insertMuscleGroupSchema>;
export type MuscleGroup = typeof muscleGroups.$inferSelect;

// ---------- Exercises ----------
export const equipmentTypes = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
] as const;
export type Equipment = (typeof equipmentTypes)[number];

export const exercises = sqliteTable("exercises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  primaryMuscleGroupId: integer("primary_muscle_group_id")
    .notNull()
    .references(() => muscleGroups.id),
  secondaryMuscleGroupId: integer("secondary_muscle_group_id").references(
    () => muscleGroups.id,
  ),
  equipment: text("equipment").notNull(), // one of equipmentTypes
});

export const insertExerciseSchema = createInsertSchema(exercises)
  .omit({ id: true })
  .extend({
    equipment: z.enum(equipmentTypes),
  });

export type InsertExercise = z.infer<typeof insertExerciseSchema>;
export type Exercise = typeof exercises.$inferSelect;

// ---------- Workouts ----------
export const workouts = sqliteTable("workouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // ISO date string
  name: text("name"), // optional e.g. "Push Day"
  notes: text("notes"),
});

export const insertWorkoutSchema = createInsertSchema(workouts).omit({
  id: true,
});

export type InsertWorkout = z.infer<typeof insertWorkoutSchema>;
export type Workout = typeof workouts.$inferSelect;

// ---------- Sets ----------
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
  rpe: real("rpe"), // nullable, 1-10
  isWarmup: integer("is_warmup", { mode: "boolean" }).notNull().default(false),
});

export const insertSetSchema = createInsertSchema(sets).omit({ id: true });

export type InsertSet = z.infer<typeof insertSetSchema>;
export type Set = typeof sets.$inferSelect;

// ---------- Bodyweight Logs ----------
export const bodyweightLogs = sqliteTable("bodyweight_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  weight: real("weight").notNull(),
});

export const insertBodyweightLogSchema = createInsertSchema(
  bodyweightLogs,
).omit({ id: true });

export type InsertBodyweightLog = z.infer<typeof insertBodyweightLogSchema>;
export type BodyweightLog = typeof bodyweightLogs.$inferSelect;

// ---------- Composite types for API responses ----------
export type SetWithExercise = Set & { exercise: Exercise };
export type WorkoutWithSets = Workout & { sets: SetWithExercise[] };
