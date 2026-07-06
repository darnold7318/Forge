import {
  users,
  muscleGroups,
  exercises,
  workouts,
  sets,
  bodyweightLogs,
  workoutTemplates,
  workoutTemplateExercises,
} from "@shared/schema";
import type {
  User,
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
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and } from "drizzle-orm";
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
      color_accent TEXT
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
  `);
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

// ---------------------------------------------------------------------------
// Storage interface
// ---------------------------------------------------------------------------
export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  renameUser(id: number, name: string): Promise<User | undefined>;

  // Muscle groups (shared/global)
  getMuscleGroups(): Promise<MuscleGroup[]>;
  getMuscleGroup(id: number): Promise<MuscleGroup | undefined>;

  // Exercises (shared/global)
  getExercises(): Promise<Exercise[]>;
  getExercise(id: number): Promise<Exercise | undefined>;
  createExercise(exercise: InsertExercise): Promise<Exercise>;

  // Workout templates (scoped per user)
  getWorkoutTemplates(userId: number): Promise<WorkoutTemplate[]>;
  getWorkoutTemplate(id: number): Promise<WorkoutTemplate | undefined>;
  getWorkoutTemplateWithExercises(id: number): Promise<WorkoutTemplateWithExercises | undefined>;
  getAllWorkoutTemplatesWithExercises(userId: number): Promise<WorkoutTemplateWithExercises[]>;
  createWorkoutTemplate(template: InsertWorkoutTemplate): Promise<WorkoutTemplate>;
  createWorkoutTemplateExercise(te: InsertWorkoutTemplateExercise): Promise<WorkoutTemplateExercise>;
  deleteWorkoutTemplate(id: number): Promise<void>;
  copyWorkoutTemplate(id: number, targetUserId: number): Promise<WorkoutTemplateWithExercises | undefined>;

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
}

export class DatabaseStorage implements IStorage {
  // ---------------- Users ----------------
  async getUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.id).all();
  }

  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async createUser(user: InsertUser): Promise<User> {
    return db.insert(users).values(user).returning().get();
  }

  async renameUser(id: number, name: string): Promise<User | undefined> {
    return db.update(users).set({ name }).where(eq(users.id, id)).returning().get();
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
}

export const storage = new DatabaseStorage();
