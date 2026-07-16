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
  // App-wide accent theme (distinct from colorAccent, which is used only for
  // profile badge coloring in user-switcher.tsx). One of themeColorIds below.
  themeColor: text("theme_color").notNull().default("green"),
  // Light/dark mode preference, persisted per-user.
  themeMode: text("theme_mode").notNull().default("dark"),
  // Preferred workout split — stored preference only, informational.
  workoutSplit: text("workout_split").notNull().default("ppl"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ---------------------------------------------------------------------------
// User preferences — theme color, theme mode, workout split
// ---------------------------------------------------------------------------
export const themeColorIds = ["green", "blue", "orange", "purple", "red", "teal"] as const;
export type ThemeColorId = (typeof themeColorIds)[number];

export const themeModeIds = ["dark", "light"] as const;
export type ThemeModeId = (typeof themeModeIds)[number];

export const workoutSplitIds = ["ppl", "upper_lower", "full_body", "bro_split", "custom"] as const;
export type WorkoutSplitId = (typeof workoutSplitIds)[number];

export const workoutSplitLabels: Record<string, string> = {
  ppl: "Push / Pull / Legs",
  upper_lower: "Upper / Lower",
  full_body: "Full Body",
  bro_split: "Bro Split",
  custom: "Custom",
};

export const updateUserPreferencesSchema = createInsertSchema(users)
  .pick({ themeColor: true, themeMode: true, workoutSplit: true })
  .partial()
  .extend({
    themeColor: z.enum(themeColorIds).optional(),
    themeMode: z.enum(themeModeIds).optional(),
    workoutSplit: z.enum(workoutSplitIds).optional(),
  });

export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;

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
// Workout Schedule — per-user calendar plan of which template falls on which date
// ---------------------------------------------------------------------------

// One row per user holding schedule-level settings.
export const workoutSchedules = sqliteTable("workout_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  // Which split is actively auto-generating into the calendar (null = none / fully custom).
  activeSplit: text("active_split"), // one of workoutSplitIds, excluding "custom", or null
  // Ordered rotation cycle for the active split, e.g. ["push","pull","legs"].
  // Stored as JSON text since SQLite has no array column type.
  rotationCycle: text("rotation_cycle").notNull().default("[]"),
  // Index into rotationCycle for the next day that needs auto-generating.
  rotationCursor: integer("rotation_cursor").notNull().default(0),
  // Weekly recurring rest days, applied in perpetuity. JSON array of 0-6 ints (0=Sun..6=Sat).
  weeklyRestDays: text("weekly_rest_days").notNull().default("[]"),
  // Last calendar month (YYYY-MM) that has been auto-generated, so we know where to continue from.
  lastGeneratedMonth: text("last_generated_month"),
});

export const insertWorkoutScheduleSchema = createInsertSchema(workoutSchedules).omit({ id: true });
export type InsertWorkoutSchedule = z.infer<typeof insertWorkoutScheduleSchema>;
export type WorkoutSchedule = typeof workoutSchedules.$inferSelect;

// One row per calendar date (YYYY-MM-DD) that has content — training day or rest day.
// Absence of a row for a date means "unplanned" (shown blank on the calendar).
export const scheduleDays = sqliteTable("schedule_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduleId: integer("schedule_id").notNull().references(() => workoutSchedules.id),
  date: text("date").notNull(), // YYYY-MM-DD
  workoutTemplateId: integer("workout_template_id").references(() => workoutTemplates.id), // null = rest day
  label: text("label"), // e.g. "Push", "Pull", "Legs" — kept even if template later deleted
  // true if this day should be skipped by the rotation auto-fill walk (continueGeneration).
  // Set both for genuine user drags AND for system-seeded lead-in Rest days (Monday-start).
  isManualOverride: integer("is_manual_override", { mode: "boolean" }).notNull().default(false),
  // true ONLY when the user themselves dragged/swapped/set this day. Distinct from
  // isManualOverride so that switching splits can safely clear system-seeded days
  // (like Monday-start lead-in Rest) while still preserving the user's own edits.
  isUserPlaced: integer("is_user_placed", { mode: "boolean" }).notNull().default(false),
  // true if this day is blank/rest solely because of a weekly-recurring rest rule
  // (as opposed to a manually-dragged rest bubble). Kept separate so the user can still
  // drag a workout on top of a weekly-blocked day.
  isWeeklyBlocked: integer("is_weekly_blocked", { mode: "boolean" }).notNull().default(false),
  // Manual bonus add-on that sits alongside whatever else is on this day (Push/Pull/Legs/Rest).
  // Does not consume a rotation slot and is never touched by auto-generation.
  hasCoreAddon: integer("has_core_addon", { mode: "boolean" }).notNull().default(false),
});

export const insertScheduleDaySchema = createInsertSchema(scheduleDays).omit({ id: true });
export type InsertScheduleDay = z.infer<typeof insertScheduleDaySchema>;
export type ScheduleDay = typeof scheduleDays.$inferSelect;

// Maps a split to its ordered rotation of label keys. Used to auto-generate calendar days.
export const splitRotationCycles: Record<Exclude<WorkoutSplitId, "custom">, string[]> = {
  ppl: ["Push", "Pull", "Legs"],
  upper_lower: ["Upper", "Lower"],
  full_body: ["Full Body A", "Full Body B", "Full Body C"],
  bro_split: ["Chest", "Back", "Shoulders", "Arms", "Legs"],
};

export const generateScheduleSchema = z.object({
  split: z.enum(workoutSplitIds).exclude(["custom"]), // ppl | upper_lower | full_body | bro_split
  // Day of week (0=Sun..6=Sat) that the first cycle entry (e.g. "Push") should land on
  // for a fresh generation. Defaults to Monday. Ignored when continuing an existing split.
  startDayOfWeek: z.number().int().min(0).max(6).default(1),
});
export type GenerateScheduleInput = z.infer<typeof generateScheduleSchema>;

export const setWeeklyRestDaysSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)),
});
export type SetWeeklyRestDaysInput = z.infer<typeof setWeeklyRestDaysSchema>;

// Move/swap a single day's content to another date (drag-and-drop on the calendar).
export const moveScheduleDaySchema = z.object({
  fromDate: z.string(), // YYYY-MM-DD
  toDate: z.string(), // YYYY-MM-DD
  // When dropping a Rest bubble onto an occupied training day, the client resolves
  // the shift-vs-skip prompt and tells the server which behavior to apply.
  mode: z.enum(["swap", "shift", "skip"]).default("swap"),
});
export type MoveScheduleDayInput = z.infer<typeof moveScheduleDaySchema>;

// Directly set a single day's content (used for the "drag Rest onto a day" base case
// and for manual per-day edits from a day-detail popover).
export const setScheduleDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  workoutTemplateId: z.number().int().nullable(),
  label: z.string().nullable().optional(),
});
export type SetScheduleDayInput = z.infer<typeof setScheduleDaySchema>;

// Toggle the Core bonus add-on badge on a single day. Purely additive — never touches
// workoutTemplateId/label or the rotation cursor.
export const setCoreAddonSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  hasCoreAddon: z.boolean(),
});
export type SetCoreAddonInput = z.infer<typeof setCoreAddonSchema>;

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
