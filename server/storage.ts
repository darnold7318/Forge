import {
  users,
  muscleGroups,
  exercises,
  workouts,
  sets,
  bodyweightLogs,
  workoutTemplates,
  workoutTemplateExercises,
  workoutSchedules,
  scheduleDays,
  splitRotationCycles,
} from "@shared/schema";
import type {
  User,
  UserRecord,
  InsertUser,
  MuscleGroup,
  InsertMuscleGroup,
  Exercise,
  InsertExercise,
  ExerciseWithParsedMuscles,
  Workout,
  InsertWorkout,
  Set,
  InsertSet,
  BodyweightLog,
  InsertBodyweightLog,
  WorkoutTemplate,
  InsertWorkoutTemplate,
  WorkoutTemplateExercise,
  InsertWorkoutTemplateExercise,
  WorkoutSchedule,
  ScheduleDay,
  GenerateScheduleInput,
  SetWeeklyRestDaysInput,
  MoveScheduleDayInput,
  SetScheduleDayInput,
  SetCoreAddonInput,
  SetCustomWeeklyTemplateInput,
  CustomWeeklySlot,
} from "@shared/schema";
import {
  buildStarterTemplate,
  monthBounds,
  enumerateDates,
  type ScheduleCatalogExercise,
  type MuscleGroupLookup,
} from "@shared/coaching";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, gte } from "drizzle-orm";
import { MUSCLE_GROUPS, EXERCISES, WORKOUT_TEMPLATES } from "./seed-data";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// ---------------------------------------------------------------------------
// Schema bootstrap — raw SQL DDL (no migration pipeline wired up).
// ---------------------------------------------------------------------------
function ensureTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color_accent TEXT,
      theme_color TEXT NOT NULL DEFAULT 'green',
      theme_mode TEXT NOT NULL DEFAULT 'dark',
      workout_split TEXT NOT NULL DEFAULT 'ppl'
    );

    CREATE TABLE IF NOT EXISTS muscle_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      mev REAL NOT NULL,
      mav REAL NOT NULL,
      mrv REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      primary_muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id),
      secondary_muscles TEXT NOT NULL DEFAULT '[]',
      equipment TEXT NOT NULL,
      movement_pattern TEXT,
      is_compound INTEGER NOT NULL DEFAULT 0,
      is_unilateral INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS workout_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS workout_template_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_template_id INTEGER NOT NULL REFERENCES workout_templates(id),
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      exercise_order INTEGER NOT NULL,
      exercise_role TEXT NOT NULL DEFAULT 'Isolation',
      warmup_sets INTEGER NOT NULL DEFAULT 0,
      top_sets INTEGER NOT NULL DEFAULT 0,
      backoff_sets INTEGER NOT NULL DEFAULT 0,
      backoff_reduction_percent REAL NOT NULL DEFAULT 0,
      target_sets INTEGER NOT NULL DEFAULT 3,
      target_reps_min INTEGER NOT NULL DEFAULT 8,
      target_reps_max INTEGER NOT NULL DEFAULT 12,
      tempo TEXT,
      target_rir INTEGER NOT NULL DEFAULT 2,
      failure_target TEXT NOT NULL DEFAULT 'Never',
      intensity_technique TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 90,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      name TEXT,
      notes TEXT,
      workout_template_id INTEGER REFERENCES workout_templates(id)
    );

    CREATE TABLE IF NOT EXISTS sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id),
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      set_number INTEGER NOT NULL,
      weight REAL NOT NULL,
      reps INTEGER NOT NULL,
      rir REAL,
      is_warmup INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bodyweight_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      weight REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workout_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      active_split TEXT,
      rotation_cycle TEXT NOT NULL DEFAULT '[]',
      rotation_cursor INTEGER NOT NULL DEFAULT 0,
      weekly_rest_days TEXT NOT NULL DEFAULT '[]',
      last_generated_month TEXT,
      custom_weekly_template TEXT NOT NULL DEFAULT '[null,null,null,null,null,null,null]'
    );

    CREATE TABLE IF NOT EXISTS schedule_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES workout_schedules(id),
      date TEXT NOT NULL,
      workout_template_id INTEGER REFERENCES workout_templates(id),
      label TEXT,
      is_manual_override INTEGER NOT NULL DEFAULT 0,
      is_weekly_blocked INTEGER NOT NULL DEFAULT 0,
      has_core_addon INTEGER NOT NULL DEFAULT 0,
      is_user_placed INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_days_schedule_date ON schedule_days(schedule_id, date);
  `);

  // Drop the legacy weekday/rotation-position schedule table from earlier builds —
  // superseded by the calendar-date based schedule_days model above.
  const legacyScheduleCols = new Set(
    (sqlite.prepare("PRAGMA table_info(workout_schedules)").all() as { name: string }[]).map((c) => c.name),
  );
  if (legacyScheduleCols.has("mode") && !legacyScheduleCols.has("active_split")) {
    sqlite.exec(`
      DROP TABLE IF EXISTS workout_schedule_slots;
      DROP TABLE IF EXISTS workout_schedules;
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workout_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        active_split TEXT,
        rotation_cycle TEXT NOT NULL DEFAULT '[]',
        rotation_cursor INTEGER NOT NULL DEFAULT 0,
        weekly_rest_days TEXT NOT NULL DEFAULT '[]',
        last_generated_month TEXT
      );
    `);
  }

  // Migration: the `users` table may already exist from before the
  // theme_color/theme_mode/workout_split columns were introduced. SQLite
  // has no `ADD COLUMN IF NOT EXISTS`, so check PRAGMA table_info first and
  // only add columns that are actually missing. This preserves all existing
  // seeded users/templates/workouts — data.db is never dropped or recreated.
  const existingColumns = new Set(
    (sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name),
  );
  const migrations: { column: string; ddl: string }[] = [
    { column: "theme_color", ddl: "ALTER TABLE users ADD COLUMN theme_color TEXT NOT NULL DEFAULT 'green'" },
    { column: "theme_mode", ddl: "ALTER TABLE users ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'dark'" },
    { column: "workout_split", ddl: "ALTER TABLE users ADD COLUMN workout_split TEXT NOT NULL DEFAULT 'ppl'" },
  ];
  for (const { column, ddl } of migrations) {
    if (!existingColumns.has(column)) {
      try {
        sqlite.exec(ddl);
      } catch (err) {
        // Guard against a race/rerun where the column was added between the
        // PRAGMA check and this statement — don't crash server startup.
      }
    }
  }

  // Migration: schedule_days may pre-date the has_core_addon / is_user_placed columns.
  const scheduleDayColumns = new Set(
    (sqlite.prepare("PRAGMA table_info(schedule_days)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!scheduleDayColumns.has("has_core_addon")) {
    try {
      sqlite.exec("ALTER TABLE schedule_days ADD COLUMN has_core_addon INTEGER NOT NULL DEFAULT 0");
    } catch (err) {
      // Guard against a race/rerun — don't crash server startup.
    }
  }
  if (!scheduleDayColumns.has("is_user_placed")) {
    try {
      sqlite.exec("ALTER TABLE schedule_days ADD COLUMN is_user_placed INTEGER NOT NULL DEFAULT 0");
      // Leave pre-existing rows at is_user_placed = 0 (the column default). There's no way to
      // tell, retroactively, which historical is_manual_override rows were real drags versus
      // auto-generated/lead-in days — and defaulting to "protected" would perpetuate the exact
      // bug this column exists to fix (switching splits never repainting old auto-filled days).
      // Defaulting to "not protected" means the very next split change will correctly repaint
      // everything; going forward, only genuine drags/swaps set is_user_placed = 1.
    } catch (err) {
      // Guard against a race/rerun — don't crash server startup.
    }
  }

  // Migration: workout_schedules may pre-date the custom_weekly_template column.
  const scheduleColumns = new Set(
    (sqlite.prepare("PRAGMA table_info(workout_schedules)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!scheduleColumns.has("custom_weekly_template")) {
    try {
      sqlite.exec(
        "ALTER TABLE workout_schedules ADD COLUMN custom_weekly_template TEXT NOT NULL DEFAULT '[null,null,null,null,null,null,null]'",
      );
    } catch (err) {
      // Guard against a race/rerun — don't crash server startup.
    }
  }
}

ensureTables();

function seedIfEmpty() {
  // ---- Users: seed 2 default profiles if none exist ----
  let existingUsers = db.select().from(users).all();
  if (existingUsers.length === 0) {
    db.insert(users).values({ name: "Profile 1", colorAccent: "chart-1" }).run();
    db.insert(users).values({ name: "Profile 2", colorAccent: "chart-4" }).run();
    existingUsers = db.select().from(users).all();
  }
  const firstUser = existingUsers.slice().sort((a, b) => a.id - b.id)[0];

  // ---- Shared catalog data (muscle groups + exercises) ----
  const existingGroups = db.select().from(muscleGroups).all();
  if (existingGroups.length > 0) return; // catalog + templates already seeded

  const nameToId = new Map<string, number>();
  for (const mg of MUSCLE_GROUPS) {
    const row = db.insert(muscleGroups).values(mg).returning().get();
    nameToId.set(row.name, row.id);
  }

  const exerciseNameToId = new Map<string, number>();
  for (const ex of EXERCISES) {
    const primaryId = nameToId.get(ex.primaryMuscleGroup);
    if (!primaryId) continue;
    const secondaryIds = ex.secondaryMuscleGroups
      .map((name) => nameToId.get(name))
      .filter((id): id is number => id != null);
    const row = db
      .insert(exercises)
      .values({
        name: ex.name,
        primaryMuscleGroupId: primaryId,
        secondaryMuscles: JSON.stringify(secondaryIds),
        equipment: ex.equipment,
        movementPattern: ex.movementPattern,
        isCompound: ex.isCompound,
        isUnilateral: ex.isUnilateral,
      })
      .returning()
      .get();
    exerciseNameToId.set(ex.name, row.id);
  }

  // Example templates are attached to the first default user only.
  for (const template of WORKOUT_TEMPLATES) {
    const templateRow = db
      .insert(workoutTemplates)
      .values({ userId: firstUser.id, name: template.name, notes: template.notes })
      .returning()
      .get();

    for (const te of template.exercises) {
      const exerciseId = exerciseNameToId.get(te.exerciseName);
      if (!exerciseId) continue;
      db.insert(workoutTemplateExercises)
        .values({
          workoutTemplateId: templateRow.id,
          exerciseId,
          exerciseOrder: te.exerciseOrder,
          exerciseRole: te.exerciseRole,
          warmupSets: te.warmupSets,
          topSets: te.topSets,
          backoffSets: te.backoffSets,
          backoffReductionPercent: te.backoffReductionPercent,
          targetSets: te.targetSets,
          targetRepsMin: te.targetRepsMin,
          targetRepsMax: te.targetRepsMax,
          tempo: te.tempo ?? null,
          targetRir: te.targetRir,
          failureTarget: te.failureTarget,
          intensityTechnique: te.intensityTechnique ?? null,
          restSeconds: te.restSeconds,
          notes: te.notes ?? null,
        })
        .run();
    }
  }
}

seedIfEmpty();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function parseExercise(ex: Exercise): ExerciseWithParsedMuscles {
  let secondary: number[] = [];
  try {
    secondary = JSON.parse(ex.secondaryMuscles ?? "[]");
  } catch {
    secondary = [];
  }
  return { ...ex, secondaryMuscles: secondary };
}

export interface SetWithExercise extends Set {
  exercise: Exercise;
}

export interface WorkoutWithSets extends Workout {
  sets: SetWithExercise[];
}

export interface WorkoutTemplateWithExercises extends WorkoutTemplate {
  exercises: WorkoutTemplateExercise[];
}

export interface WorkoutScheduleWithDays extends WorkoutSchedule {
  days: ScheduleDay[];
}

// ---------------------------------------------------------------------------
// Storage interface
// ---------------------------------------------------------------------------
export interface IStorage {
  // Users
  getUsers(): Promise<UserRecord[]>;
  getUser(id: number): Promise<UserRecord | undefined>;
  createUser(user: InsertUser & { passwordHash: string; isAdmin?: boolean }): Promise<UserRecord>;
  renameUser(id: number, name: string): Promise<UserRecord | undefined>;
  updateUserPreferences(
    id: number,
    prefs: Partial<Pick<UserRecord, "themeColor" | "themeMode" | "workoutSplit">>,
  ): Promise<UserRecord | undefined>;

  // Muscle groups (shared/global)
  getMuscleGroups(): Promise<MuscleGroup[]>;
  getMuscleGroup(id: number): Promise<MuscleGroup | undefined>;

  // Exercises (shared/global)
  getExercises(): Promise<Exercise[]>;
  getExercise(id: number): Promise<Exercise | undefined>;
  createExercise(exercise: InsertExercise): Promise<Exercise>;
  updateExercise(id: number, exercise: InsertExercise): Promise<Exercise | undefined>;
  getExerciseUsage(id: number): Promise<{ templateCount: number; loggedSetCount: number }>;
  deleteExercise(id: number): Promise<{ deleted: boolean; reason?: string }>;

  // Workout templates (scoped per user)
  getWorkoutTemplates(userId: number): Promise<WorkoutTemplate[]>;
  getWorkoutTemplate(id: number): Promise<WorkoutTemplate | undefined>;
  getWorkoutTemplateWithExercises(id: number): Promise<WorkoutTemplateWithExercises | undefined>;
  getAllWorkoutTemplatesWithExercises(userId: number): Promise<WorkoutTemplateWithExercises[]>;
  createWorkoutTemplate(template: InsertWorkoutTemplate): Promise<WorkoutTemplate>;
  createWorkoutTemplateExercise(te: InsertWorkoutTemplateExercise): Promise<WorkoutTemplateExercise>;
  deleteWorkoutTemplate(id: number): Promise<void>;
  copyWorkoutTemplate(id: number, targetUserId: number): Promise<WorkoutTemplateWithExercises | undefined>;
  updateWorkoutTemplate(
    id: number,
    patch: Partial<Pick<WorkoutTemplate, "name" | "notes">>,
  ): Promise<WorkoutTemplate | undefined>;
  updateWorkoutTemplateExercise(
    id: number,
    patch: Partial<InsertWorkoutTemplateExercise>,
  ): Promise<WorkoutTemplateExercise | undefined>;
  deleteWorkoutTemplateExercise(id: number): Promise<void>;
  reorderWorkoutTemplateExercises(templateId: number, orderedExerciseIds: number[]): Promise<void>;

  // Workouts (scoped per user)
  getWorkouts(userId: number): Promise<Workout[]>;
  getWorkout(id: number): Promise<Workout | undefined>;
  getWorkoutWithSets(id: number): Promise<WorkoutWithSets | undefined>;
  createWorkout(workout: InsertWorkout): Promise<Workout>;
  updateWorkout(id: number, workout: Partial<InsertWorkout>): Promise<Workout | undefined>;
  deleteWorkout(id: number): Promise<void>;

  // Sets (scope inherited via workoutId -> workouts.userId)
  getSetsForWorkout(workoutId: number): Promise<SetWithExercise[]>;
  getSetsForExercise(exerciseId: number, userId: number): Promise<SetWithExercise[]>;
  getAllSets(userId: number): Promise<SetWithExercise[]>;
  createSet(set: InsertSet): Promise<Set>;
  updateSet(id: number, set: Partial<InsertSet>): Promise<Set | undefined>;
  deleteSet(id: number): Promise<void>;

  // Bodyweight logs (scoped per user)
  getBodyweightLogs(userId: number): Promise<BodyweightLog[]>;
  createBodyweightLog(log: InsertBodyweightLog): Promise<BodyweightLog>;

  // Workout schedule (scoped per user, calendar-date based)
  getWorkoutSchedule(userId: number, startDate: string, endDate: string): Promise<WorkoutScheduleWithDays>;
  setWeeklyRestDays(userId: number, days: number[]): Promise<WorkoutSchedule>;
  setCustomWeeklyTemplate(userId: number, input: SetCustomWeeklyTemplateInput): Promise<WorkoutSchedule>;
  generateScheduleMonth(userId: number, input: GenerateScheduleInput, yearMonth: string): Promise<WorkoutScheduleWithDays>;
  continueGeneration(userId: number, yearMonth: string): Promise<void>;
  setScheduleDay(userId: number, input: SetScheduleDayInput): Promise<ScheduleDay>;
  setCoreAddon(userId: number, input: SetCoreAddonInput): Promise<ScheduleDay>;
  moveScheduleDay(userId: number, input: MoveScheduleDayInput): Promise<ScheduleDay[]>;
  advanceRotation(userId: number, completedTemplateId: number | null, date: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // ---------------- Users ----------------
  // NOTE: these return the full UserRecord (including passwordHash) since
  // storage is not the trust boundary — routes.ts strips the hash via
  // toPublicUser() before anything reaches the client.
  async getUsers(): Promise<UserRecord[]> {
    return db.select().from(users).orderBy(users.id).all();
  }

  async getUser(id: number): Promise<UserRecord | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async createUser(user: InsertUser & { passwordHash: string; isAdmin?: boolean }): Promise<UserRecord> {
    return db.insert(users).values(user).returning().get();
  }

  async renameUser(id: number, name: string): Promise<UserRecord | undefined> {
    return db.update(users).set({ name }).where(eq(users.id, id)).returning().get();
  }

  async updateUserPreferences(
    id: number,
    prefs: Partial<Pick<UserRecord, "themeColor" | "themeMode" | "workoutSplit">>,
  ): Promise<UserRecord | undefined> {
    return db.update(users).set(prefs).where(eq(users.id, id)).returning().get();
  }

  // ---------------- Muscle groups (shared) ----------------
  async getMuscleGroups(): Promise<MuscleGroup[]> {
    return db.select().from(muscleGroups).all();
  }

  async getMuscleGroup(id: number): Promise<MuscleGroup | undefined> {
    return db.select().from(muscleGroups).where(eq(muscleGroups.id, id)).get();
  }

  // ---------------- Exercises (shared) ----------------
  async getExercises(): Promise<Exercise[]> {
    return db.select().from(exercises).all();
  }

  async getExercise(id: number): Promise<Exercise | undefined> {
    return db.select().from(exercises).where(eq(exercises.id, id)).get();
  }

  async createExercise(exercise: InsertExercise): Promise<Exercise> {
    return db.insert(exercises).values(exercise).returning().get();
  }

  async updateExercise(id: number, exercise: InsertExercise): Promise<Exercise | undefined> {
    return db.update(exercises).set(exercise).where(eq(exercises.id, id)).returning().get();
  }

  async getExerciseUsage(id: number): Promise<{ templateCount: number; loggedSetCount: number }> {
    const templateRows = db
      .select()
      .from(workoutTemplateExercises)
      .where(eq(workoutTemplateExercises.exerciseId, id))
      .all();
    const setRows = db.select().from(sets).where(eq(sets.exerciseId, id)).all();
    return { templateCount: templateRows.length, loggedSetCount: setRows.length };
  }

  async deleteExercise(id: number): Promise<{ deleted: boolean; reason?: string }> {
    const usage = await this.getExerciseUsage(id);
    if (usage.loggedSetCount > 0) {
      return {
        deleted: false,
        reason: `This exercise has ${usage.loggedSetCount} logged set${usage.loggedSetCount === 1 ? "" : "s"} in your workout history, so it can't be deleted.`,
      };
    }
    if (usage.templateCount > 0) {
      return {
        deleted: false,
        reason: `This exercise is used in ${usage.templateCount} template exercise slot${usage.templateCount === 1 ? "" : "s"}. Remove it from those templates first.`,
      };
    }
    db.delete(exercises).where(eq(exercises.id, id)).run();
    return { deleted: true };
  }

  // ---------------- Workout templates ----------------
  async getWorkoutTemplates(userId: number): Promise<WorkoutTemplate[]> {
    return db.select().from(workoutTemplates).where(eq(workoutTemplates.userId, userId)).all();
  }

  async getWorkoutTemplate(id: number): Promise<WorkoutTemplate | undefined> {
    return db.select().from(workoutTemplates).where(eq(workoutTemplates.id, id)).get();
  }

  async getWorkoutTemplateWithExercises(id: number): Promise<WorkoutTemplateWithExercises | undefined> {
    const template = await this.getWorkoutTemplate(id);
    if (!template) return undefined;
    const exerciseRows = db
      .select()
      .from(workoutTemplateExercises)
      .where(eq(workoutTemplateExercises.workoutTemplateId, id))
      .all();
    exerciseRows.sort((a, b) => a.exerciseOrder - b.exerciseOrder);
    return { ...template, exercises: exerciseRows };
  }

  async getAllWorkoutTemplatesWithExercises(userId: number): Promise<WorkoutTemplateWithExercises[]> {
    const templates = await this.getWorkoutTemplates(userId);
    const result: WorkoutTemplateWithExercises[] = [];
    for (const t of templates) {
      const withExercises = await this.getWorkoutTemplateWithExercises(t.id);
      if (withExercises) result.push(withExercises);
    }
    return result;
  }

  async createWorkoutTemplate(template: InsertWorkoutTemplate): Promise<WorkoutTemplate> {
    return db.insert(workoutTemplates).values(template).returning().get();
  }

  async createWorkoutTemplateExercise(te: InsertWorkoutTemplateExercise): Promise<WorkoutTemplateExercise> {
    return db.insert(workoutTemplateExercises).values(te).returning().get();
  }

  async deleteWorkoutTemplate(id: number): Promise<void> {
    // Detach this template from any schedule references first, so the delete never fails
    // with a foreign-key error just because the template is currently assigned to a day.
    // scheduleDays rows keep their `label` even after the template link is cleared (by design
    // — see the schema comment), so past/future calendar days still show a name, just
    // pointing at nothing now.
    db.update(scheduleDays)
      .set({ workoutTemplateId: null })
      .where(eq(scheduleDays.workoutTemplateId, id))
      .run();

    // customWeeklyTemplate is a JSON blob (7 slots keyed by day-of-week) stored per-user, so it
    // can't be targeted with a SQL WHERE — scan every user's schedule row and null out any slot
    // that references this template, keeping the slot's label intact.
    const schedules = db.select().from(workoutSchedules).all();
    for (const schedule of schedules) {
      const slots: (CustomWeeklySlot | null)[] = JSON.parse(schedule.customWeeklyTemplate);
      let changed = false;
      const nextSlots = slots.map((slot) => {
        if (slot && slot.workoutTemplateId === id) {
          changed = true;
          return { ...slot, workoutTemplateId: null };
        }
        return slot;
      });
      if (changed) {
        db.update(workoutSchedules)
          .set({ customWeeklyTemplate: JSON.stringify(nextSlots) })
          .where(eq(workoutSchedules.id, schedule.id))
          .run();
      }
    }

    db.delete(workoutTemplateExercises).where(eq(workoutTemplateExercises.workoutTemplateId, id)).run();
    db.delete(workoutTemplates).where(eq(workoutTemplates.id, id)).run();
  }

  async copyWorkoutTemplate(id: number, targetUserId: number): Promise<WorkoutTemplateWithExercises | undefined> {
    const source = await this.getWorkoutTemplateWithExercises(id);
    if (!source) return undefined;

    const newTemplate = db
      .insert(workoutTemplates)
      .values({ userId: targetUserId, name: source.name, notes: source.notes })
      .returning()
      .get();

    for (const te of source.exercises) {
      db.insert(workoutTemplateExercises)
        .values({
          workoutTemplateId: newTemplate.id,
          exerciseId: te.exerciseId,
          exerciseOrder: te.exerciseOrder,
          exerciseRole: te.exerciseRole,
          warmupSets: te.warmupSets,
          topSets: te.topSets,
          backoffSets: te.backoffSets,
          backoffReductionPercent: te.backoffReductionPercent,
          targetSets: te.targetSets,
          targetRepsMin: te.targetRepsMin,
          targetRepsMax: te.targetRepsMax,
          tempo: te.tempo,
          targetRir: te.targetRir,
          failureTarget: te.failureTarget,
          intensityTechnique: te.intensityTechnique,
          restSeconds: te.restSeconds,
          notes: te.notes,
        })
        .run();
    }

    return this.getWorkoutTemplateWithExercises(newTemplate.id);
  }

  async updateWorkoutTemplate(
    id: number,
    patch: Partial<Pick<WorkoutTemplate, "name" | "notes">>,
  ): Promise<WorkoutTemplate | undefined> {
    return db.update(workoutTemplates).set(patch).where(eq(workoutTemplates.id, id)).returning().get();
  }

  async updateWorkoutTemplateExercise(
    id: number,
    patch: Partial<InsertWorkoutTemplateExercise>,
  ): Promise<WorkoutTemplateExercise | undefined> {
    return db
      .update(workoutTemplateExercises)
      .set(patch)
      .where(eq(workoutTemplateExercises.id, id))
      .returning()
      .get();
  }

  async deleteWorkoutTemplateExercise(id: number): Promise<void> {
    db.delete(workoutTemplateExercises).where(eq(workoutTemplateExercises.id, id)).run();
  }

  async reorderWorkoutTemplateExercises(templateId: number, orderedExerciseIds: number[]): Promise<void> {
    orderedExerciseIds.forEach((teId, idx) => {
      db.update(workoutTemplateExercises)
        .set({ exerciseOrder: idx + 1 })
        .where(
          and(eq(workoutTemplateExercises.id, teId), eq(workoutTemplateExercises.workoutTemplateId, templateId)),
        )
        .run();
    });
  }

  // ---------------- Workouts ----------------
  async getWorkouts(userId: number): Promise<Workout[]> {
    return db
      .select()
      .from(workouts)
      .where(eq(workouts.userId, userId))
      .orderBy(desc(workouts.date), desc(workouts.id))
      .all();
  }

  async getWorkout(id: number): Promise<Workout | undefined> {
    return db.select().from(workouts).where(eq(workouts.id, id)).get();
  }

  async getWorkoutWithSets(id: number): Promise<WorkoutWithSets | undefined> {
    const workout = await this.getWorkout(id);
    if (!workout) return undefined;
    const setRows = await this.getSetsForWorkout(id);
    return { ...workout, sets: setRows };
  }

  async createWorkout(workout: InsertWorkout): Promise<Workout> {
    return db.insert(workouts).values(workout).returning().get();
  }

  async updateWorkout(id: number, workout: Partial<InsertWorkout>): Promise<Workout | undefined> {
    return db.update(workouts).set(workout).where(eq(workouts.id, id)).returning().get();
  }

  async deleteWorkout(id: number): Promise<void> {
    db.delete(sets).where(eq(sets.workoutId, id)).run();
    db.delete(workouts).where(eq(workouts.id, id)).run();
  }

  // ---------------- Sets ----------------
  async getSetsForWorkout(workoutId: number): Promise<SetWithExercise[]> {
    const rows = db
      .select()
      .from(sets)
      .innerJoin(exercises, eq(sets.exerciseId, exercises.id))
      .where(eq(sets.workoutId, workoutId))
      .all();
    return rows.map((r) => ({ ...r.sets, exercise: r.exercises }));
  }

  async getSetsForExercise(exerciseId: number, userId: number): Promise<SetWithExercise[]> {
    const rows = db
      .select()
      .from(sets)
      .innerJoin(exercises, eq(sets.exerciseId, exercises.id))
      .innerJoin(workouts, eq(sets.workoutId, workouts.id))
      .where(and(eq(sets.exerciseId, exerciseId), eq(workouts.userId, userId)))
      .all();
    return rows.map((r) => ({ ...r.sets, exercise: r.exercises }));
  }

  async getAllSets(userId: number): Promise<SetWithExercise[]> {
    const rows = db
      .select()
      .from(sets)
      .innerJoin(exercises, eq(sets.exerciseId, exercises.id))
      .innerJoin(workouts, eq(sets.workoutId, workouts.id))
      .where(eq(workouts.userId, userId))
      .all();
    return rows.map((r) => ({ ...r.sets, exercise: r.exercises }));
  }

  async createSet(set: InsertSet): Promise<Set> {
    return db.insert(sets).values(set).returning().get();
  }

  async updateSet(id: number, set: Partial<InsertSet>): Promise<Set | undefined> {
    return db.update(sets).set(set).where(eq(sets.id, id)).returning().get();
  }

  async deleteSet(id: number): Promise<void> {
    db.delete(sets).where(eq(sets.id, id)).run();
  }

  // ---------------- Bodyweight logs ----------------
  async getBodyweightLogs(userId: number): Promise<BodyweightLog[]> {
    return db
      .select()
      .from(bodyweightLogs)
      .where(eq(bodyweightLogs.userId, userId))
      .orderBy(desc(bodyweightLogs.date))
      .all();
  }

  async createBodyweightLog(log: InsertBodyweightLog): Promise<BodyweightLog> {
    return db.insert(bodyweightLogs).values(log).returning().get();
  }

  // ---------------- Workout schedule (calendar-based) ----------------
  private getOrCreateScheduleRow(userId: number): WorkoutSchedule {
    let schedule = db.select().from(workoutSchedules).where(eq(workoutSchedules.userId, userId)).get();
    if (!schedule) {
      schedule = db.insert(workoutSchedules).values({ userId }).returning().get();
    }
    return schedule;
  }

  private async getDaysInRange(scheduleId: number, startDate: string, endDate: string): Promise<ScheduleDay[]> {
    const rows = db.select().from(scheduleDays).where(eq(scheduleDays.scheduleId, scheduleId)).all();
    return rows.filter((d) => d.date >= startDate && d.date <= endDate).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Ensure a template exists for a given rotation label (e.g. "Push"), creating a starter if needed. */
  private async ensureTemplateForLabel(userId: number, label: string): Promise<number> {
    const templates = await this.getWorkoutTemplates(userId);
    const existing = templates.find((t) => t.name.toLowerCase().startsWith(label.toLowerCase()));
    if (existing) return existing.id;

    const { catalog, muscleGroupLookup } = await this.buildSchedulePlanInputs(userId);
    const starter = buildStarterTemplate({ archetype: label, catalog, muscleGroupLookup });
    const created = await this.createWorkoutTemplate({ userId, name: starter.name, notes: null });
    for (const ex of starter.exercises) {
      await this.createWorkoutTemplateExercise({
        workoutTemplateId: created.id,
        exerciseId: ex.exerciseId,
        exerciseOrder: ex.exerciseOrder,
        exerciseRole: ex.exerciseRole,
        warmupSets: ex.warmupSets,
        topSets: ex.topSets,
        backoffSets: ex.backoffSets,
        backoffReductionPercent: 0,
        targetSets: ex.targetSets,
        targetRepsMin: ex.targetRepsMin,
        targetRepsMax: ex.targetRepsMax,
        tempo: null,
        targetRir: ex.targetRir,
        failureTarget: ex.failureTarget,
        intensityTechnique: null,
        restSeconds: ex.restSeconds,
        notes: null,
      });
    }
    return created.id;
  }

  /** Build the pure-planning inputs (exercise catalog, muscle lookup) from the DB. */
  private async buildSchedulePlanInputs(userId: number): Promise<{
    catalog: ScheduleCatalogExercise[];
    muscleGroupLookup: MuscleGroupLookup;
  }> {
    const exerciseRows = await this.getExercises();
    const catalog: ScheduleCatalogExercise[] = exerciseRows.map((e) => ({
      id: e.id,
      name: e.name,
      primaryMuscleGroupId: e.primaryMuscleGroupId,
      isCompound: e.isCompound,
    }));

    const groups = await this.getMuscleGroups();
    const idToName = new Map<number, any>();
    for (const g of groups) idToName.set(g.id, g.name);
    const muscleGroupLookup: MuscleGroupLookup = { idToName };

    return { catalog, muscleGroupLookup };
  }

  async getWorkoutSchedule(userId: number, startDate: string, endDate: string): Promise<WorkoutScheduleWithDays> {
    const schedule = this.getOrCreateScheduleRow(userId);
    const days = await this.getDaysInRange(schedule.id, startDate, endDate);
    return { ...schedule, days };
  }

  async setWeeklyRestDays(userId: number, days: number[]): Promise<WorkoutSchedule> {
    const schedule = this.getOrCreateScheduleRow(userId);
    return db
      .update(workoutSchedules)
      .set({ weeklyRestDays: JSON.stringify(days) })
      .where(eq(workoutSchedules.id, schedule.id))
      .returning()
      .get();
  }

  /** Save the fixed Mon-Sun weekly template used by the "custom" split. Free-text labels get
   *  a starter template created/reused the same way the other splits do; slots that already
   *  reference a saved template are left as-is. Does NOT touch the calendar — apply via
   *  generateScheduleMonth({ split: "custom" }) from the Schedule page. */
  async setCustomWeeklyTemplate(userId: number, input: SetCustomWeeklyTemplateInput): Promise<WorkoutSchedule> {
    const schedule = this.getOrCreateScheduleRow(userId);
    const resolvedSlots: CustomWeeklySlot[] = [];
    for (const slot of input.slots) {
      if (!slot || (slot.label == null && slot.workoutTemplateId == null)) {
        resolvedSlots.push(null);
        continue;
      }
      if (slot.workoutTemplateId != null) {
        resolvedSlots.push({ label: slot.label, workoutTemplateId: slot.workoutTemplateId });
        continue;
      }
      // Free-text label with no explicit template — auto-create/reuse a starter, same as
      // the built-in splits (ensureTemplateForLabel dedupes by name prefix).
      const templateId = await this.ensureTemplateForLabel(userId, slot.label!);
      resolvedSlots.push({ label: slot.label, workoutTemplateId: templateId });
    }
    return db
      .update(workoutSchedules)
      .set({ customWeeklyTemplate: JSON.stringify(resolvedSlots) })
      .where(eq(workoutSchedules.id, schedule.id))
      .returning()
      .get();
  }

  /** Auto-generate (or continue) the active split's rotation for one calendar month (YYYY-MM). */
  async generateScheduleMonth(
    userId: number,
    input: GenerateScheduleInput,
    yearMonth: string,
  ): Promise<WorkoutScheduleWithDays> {
    let schedule = this.getOrCreateScheduleRow(userId);
    const isNewSplit = schedule.activeSplit !== input.split;
    const isCustom = input.split === "custom";
    // Only align to the target weekday (Monday-start) the very first time this user ever
    // generates a schedule (and only for rotating-cycle splits — "custom" is keyed purely by
    // day-of-week, so there's no cursor to align and no lead-in concept at all). Once a
    // schedule has been generated before, a later split change is a mid-stream swap —
    // there's already a calendar with real dates in play, so we must NOT re-seed lead-in
    // Rest days over whatever already exists there.
    const isFirstEverGeneration = schedule.lastGeneratedMonth == null;

    const cycle = isCustom ? [] : splitRotationCycles[input.split as Exclude<GenerateScheduleInput["split"], "custom">];

    // On the very first generation, align cycle[0] (e.g. "Push") to the requested weekday
    // (default Monday) by pre-rolling the cursor and seeding lead-in Rest days before the
    // first occurrence of that weekday in the month.
    let initialCursor = isNewSplit ? 0 : schedule.rotationCursor;
    let leadInDates: string[] = [];
    if (isFirstEverGeneration && !isCustom) {
      const [monthStart] = monthBounds(yearMonth);
      const startDow = new Date(monthStart + "T00:00:00").getDay();
      const targetDow = input.startDayOfWeek;
      const daysUntilTarget = (targetDow - startDow + 7) % 7;
      if (daysUntilTarget > 0) {
        // Leading days before the first target weekday occurrence get marked Rest below.
        const lead = new Date(monthStart + "T00:00:00");
        for (let i = 0; i < daysUntilTarget; i++) {
          leadInDates.push(lead.toISOString().slice(0, 10));
          lead.setDate(lead.getDate() + 1);
        }
      }
      initialCursor = 0;
    }

    // Switching to a genuinely different split invalidates every day that the *previous*
    // split's rotation auto-painted — those are stale labels from a cycle that no longer
    // applies. Clear isManualOverride on rows that were only ever auto-generated (i.e. not
    // a real user drag) for this month and all future months so continueGeneration actually
    // repaints them. Rows the user deliberately dragged/swapped (isUserPlaced) are preserved.
    if (isNewSplit) {
      const [monthStart] = monthBounds(yearMonth);
      db.update(scheduleDays)
        .set({ isManualOverride: false, isWeeklyBlocked: false })
        .where(
          and(
            eq(scheduleDays.scheduleId, schedule.id),
            eq(scheduleDays.isUserPlaced, false),
            gte(scheduleDays.date, monthStart),
          ),
        )
        .run();
    }

    schedule = db
      .update(workoutSchedules)
      .set({
        activeSplit: input.split,
        rotationCycle: JSON.stringify(cycle),
        rotationCursor: initialCursor,
      })
      .where(eq(workoutSchedules.id, schedule.id))
      .returning()
      .get();

    await this.updateUserPreferences(userId, { workoutSplit: input.split });

    // Pre-seed lead-in days (before the first Monday, etc.) as Rest. These are marked
    // isManualOverride so continueGeneration's cursor walk starts fresh exactly on the
    // target weekday, but NOT isUserPlaced — so a future split change can still clear them.
    for (const date of leadInDates) {
      const existing = db.select().from(scheduleDays).where(and(eq(scheduleDays.scheduleId, schedule.id), eq(scheduleDays.date, date))).get();
      if (existing) {
        db.update(scheduleDays)
          .set({ workoutTemplateId: null, label: "Rest", isManualOverride: true, isWeeklyBlocked: false })
          .where(eq(scheduleDays.id, existing.id))
          .run();
      } else {
        db.insert(scheduleDays)
          .values({ scheduleId: schedule.id, date, workoutTemplateId: null, label: "Rest", isManualOverride: true })
          .run();
      }
    }

    await this.continueGeneration(userId, yearMonth);

    const [startDate, endDate] = monthBounds(yearMonth);
    const days = await this.getDaysInRange(schedule.id, startDate, endDate);
    const refreshed = db.select().from(workoutSchedules).where(eq(workoutSchedules.id, schedule.id)).get()!;
    return { ...refreshed, days };
  }

  /** Fill in every day of yearMonth that isn't manually overridden. For rotating-cycle splits
   *  this continues the rotation cursor; for "custom" it paints purely from the fixed Mon-Sun
   *  weekly template keyed by day-of-week — no cursor, so continuing across month/week
   *  boundaries (e.g. a month starting mid-week) is automatically correct with zero special-
   *  casing: every Wednesday always gets whatever the template says for Wednesday. */
  async continueGeneration(userId: number, yearMonth: string): Promise<void> {
    const schedule = this.getOrCreateScheduleRow(userId);
    if (!schedule.activeSplit) return;

    const [startDate, endDate] = monthBounds(yearMonth);
    const existingDays = await this.getDaysInRange(schedule.id, startDate, endDate);
    const existingByDate = new Map(existingDays.map((d) => [d.date, d]));
    const weeklyRestDays: number[] = JSON.parse(schedule.weeklyRestDays || "[]");
    const dates = enumerateDates(startDate, endDate);

    const upsertDay = (date: string, values: { workoutTemplateId: number | null; label: string | null; isWeeklyBlocked: boolean }) => {
      const existing = existingByDate.get(date);
      if (existing) {
        db.update(scheduleDays).set(values).where(eq(scheduleDays.id, existing.id)).run();
      } else {
        db.insert(scheduleDays).values({ scheduleId: schedule.id, date, ...values }).run();
      }
    };

    if (schedule.activeSplit === "custom") {
      const weeklyTemplate: CustomWeeklySlot[] = JSON.parse(
        schedule.customWeeklyTemplate || "[null,null,null,null,null,null,null]",
      );
      for (const date of dates) {
        const existing = existingByDate.get(date);
        if (existing && existing.isManualOverride) continue; // never touch manual days

        const dow = new Date(date + "T00:00:00").getDay();
        const isRestDay = weeklyRestDays.includes(dow);
        const slot = weeklyTemplate[dow];

        if (isRestDay || !slot) {
          upsertDay(date, { workoutTemplateId: null, label: "Rest", isWeeklyBlocked: isRestDay });
        } else {
          upsertDay(date, { workoutTemplateId: slot.workoutTemplateId, label: slot.label, isWeeklyBlocked: false });
        }
      }
      db.update(workoutSchedules).set({ lastGeneratedMonth: yearMonth }).where(eq(workoutSchedules.id, schedule.id)).run();
      return;
    }

    const cycle: string[] = JSON.parse(schedule.rotationCycle || "[]");
    if (cycle.length === 0) return;

    let cursor = schedule.rotationCursor;
    for (const date of dates) {
      const existing = existingByDate.get(date);
      if (existing && existing.isManualOverride) continue; // never touch manual days

      const dow = new Date(date + "T00:00:00").getDay();
      const isRestDay = weeklyRestDays.includes(dow);

      if (isRestDay) {
        upsertDay(date, { workoutTemplateId: null, label: "Rest", isWeeklyBlocked: true });
        continue; // rest days don't consume a rotation slot
      }

      const label = cycle[cursor % cycle.length];
      const templateId = await this.ensureTemplateForLabel(userId, label);
      upsertDay(date, { workoutTemplateId: templateId, label, isWeeklyBlocked: false });
      cursor += 1;
    }

    db.update(workoutSchedules)
      .set({ rotationCursor: cursor % cycle.length, lastGeneratedMonth: yearMonth })
      .where(eq(workoutSchedules.id, schedule.id))
      .run();
  }

  /** Directly set one calendar day (drag a Rest bubble onto a day, or any manual edit). Marks it as a manual override. */
  async setScheduleDay(userId: number, input: SetScheduleDayInput): Promise<ScheduleDay> {
    const schedule = this.getOrCreateScheduleRow(userId);
    const existing = db
      .select()
      .from(scheduleDays)
      .where(and(eq(scheduleDays.scheduleId, schedule.id), eq(scheduleDays.date, input.date)))
      .get();

    const values = {
      workoutTemplateId: input.workoutTemplateId,
      label: input.label ?? null,
      isManualOverride: true,
      isUserPlaced: true,
      isWeeklyBlocked: false,
    };

    if (existing) {
      return db.update(scheduleDays).set(values).where(eq(scheduleDays.id, existing.id)).returning().get();
    }
    return db
      .insert(scheduleDays)
      .values({ scheduleId: schedule.id, date: input.date, ...values })
      .returning()
      .get();
  }

  /** Toggle the Core bonus add-on badge on a day. Purely additive — never touches the
   *  workout/label/rotation cursor, and does not mark the day as a manual override. */
  async setCoreAddon(userId: number, input: SetCoreAddonInput): Promise<ScheduleDay> {
    const schedule = this.getOrCreateScheduleRow(userId);
    const existing = db
      .select()
      .from(scheduleDays)
      .where(and(eq(scheduleDays.scheduleId, schedule.id), eq(scheduleDays.date, input.date)))
      .get();

    if (existing) {
      return db
        .update(scheduleDays)
        .set({ hasCoreAddon: input.hasCoreAddon })
        .where(eq(scheduleDays.id, existing.id))
        .returning()
        .get();
    }
    return db
      .insert(scheduleDays)
      .values({ scheduleId: schedule.id, date: input.date, hasCoreAddon: input.hasCoreAddon })
      .returning()
      .get();
  }

  /** Drag-and-drop a day's content to another date. "swap" exchanges both days' contents;
   *  "shift" pushes every day from `toDate` onward forward by one day within the same month
   *  before placing Rest at `toDate`; "skip" just overwrites `toDate` with the dragged content
   *  without touching any other day. */
  async moveScheduleDay(userId: number, input: MoveScheduleDayInput): Promise<ScheduleDay[]> {
    const schedule = this.getOrCreateScheduleRow(userId);
    const getDay = (date: string) =>
      db
        .select()
        .from(scheduleDays)
        .where(and(eq(scheduleDays.scheduleId, schedule.id), eq(scheduleDays.date, date)))
        .get();

    const upsert = (date: string, values: { workoutTemplateId: number | null; label: string | null }) => {
      const existing = getDay(date);
      const payload = { ...values, isManualOverride: true, isUserPlaced: true, isWeeklyBlocked: false };
      if (existing) {
        return db.update(scheduleDays).set(payload).where(eq(scheduleDays.id, existing.id)).returning().get();
      }
      return db.insert(scheduleDays).values({ scheduleId: schedule.id, date, ...payload }).returning().get();
    };

    const fromDay = getDay(input.fromDate);
    const toDay = getDay(input.toDate);
    const touched: ScheduleDay[] = [];

    if (input.mode === "swap") {
      touched.push(upsert(input.toDate, { workoutTemplateId: fromDay?.workoutTemplateId ?? null, label: fromDay?.label ?? null }));
      touched.push(
        upsert(input.fromDate, { workoutTemplateId: toDay?.workoutTemplateId ?? null, label: toDay?.label ?? null }),
      );
    } else if (input.mode === "skip") {
      // Overwrite only the target day with the dragged content; source day is cleared to rest.
      touched.push(upsert(input.toDate, { workoutTemplateId: fromDay?.workoutTemplateId ?? null, label: fromDay?.label ?? null }));
      touched.push(upsert(input.fromDate, { workoutTemplateId: null, label: "Rest" }));
    } else {
      // shift: push toDate and everything after it (within the same month) forward by one day,
      // then place the dragged content at toDate. When fromDate === toDate (dropping the Rest
      // palette bubble directly onto an occupied day), the dragged content is explicitly Rest
      // rather than whatever currently occupies that day.
      const draggedContent =
        input.fromDate === input.toDate ? { workoutTemplateId: null, label: "Rest" } : { workoutTemplateId: fromDay?.workoutTemplateId ?? null, label: fromDay?.label ?? null };

      const [, endOfMonth] = monthBounds(input.toDate.slice(0, 7));
      const datesAfter = enumerateDates(input.toDate, endOfMonth);
      // Walk backwards so we don't overwrite a day before reading it.
      for (let i = datesAfter.length - 1; i >= 1; i--) {
        const cur = getDay(datesAfter[i - 1]);
        touched.push(upsert(datesAfter[i], { workoutTemplateId: cur?.workoutTemplateId ?? null, label: cur?.label ?? null }));
      }
      touched.push(upsert(input.toDate, draggedContent));
      if (input.fromDate !== input.toDate) {
        touched.push(upsert(input.fromDate, { workoutTemplateId: null, label: "Rest" }));
      }
    }

    return touched;
  }

  async advanceRotation(userId: number, completedTemplateId: number | null, date: string): Promise<void> {
    if (completedTemplateId == null) return;
    const schedule = this.getOrCreateScheduleRow(userId);
    const day = db
      .select()
      .from(scheduleDays)
      .where(and(eq(scheduleDays.scheduleId, schedule.id), eq(scheduleDays.date, date)))
      .get();
    // Only meaningful as a signal that the day's plan was followed; the calendar model
    // already has each day pre-assigned, so no cursor mutation is needed here beyond
    // keeping the month generation logic (continueGeneration) as the source of truth.
    void day;
  }
}

export const storage = new DatabaseStorage();
