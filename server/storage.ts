import {
  muscleGroups,
  exercises,
  workouts,
  sets,
  bodyweightLogs,
} from "@shared/schema";
import type {
  MuscleGroup,
  InsertMuscleGroup,
  Exercise,
  InsertExercise,
  Workout,
  InsertWorkout,
  Set,
  InsertSet,
  BodyweightLog,
  InsertBodyweightLog,
  SetWithExercise,
  WorkoutWithSets,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";
import { MUSCLE_GROUPS, EXERCISES } from "./seed-data";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// ---------------------------------------------------------------------------
// Schema bootstrap (no auth/users table needed; template's users table
// is unused. We create our own tables directly via drizzle push semantics
// at runtime using raw SQL for simplicity, since this project has no
// migration pipeline wired up separately.)
// ---------------------------------------------------------------------------
function ensureTables() {
  sqlite.exec(`
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
      secondary_muscle_group_id INTEGER REFERENCES muscle_groups(id),
      equipment TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      name TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id),
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      set_number INTEGER NOT NULL,
      weight REAL NOT NULL,
      reps INTEGER NOT NULL,
      rpe REAL,
      is_warmup INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bodyweight_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      weight REAL NOT NULL
    );
  `);
}

ensureTables();

function seedIfEmpty() {
  const existing = db.select().from(muscleGroups).all();
  if (existing.length > 0) return;

  const nameToId = new Map<string, number>();
  for (const mg of MUSCLE_GROUPS) {
    const row = db.insert(muscleGroups).values(mg).returning().get();
    nameToId.set(row.name, row.id);
  }

  for (const ex of EXERCISES) {
    const primaryId = nameToId.get(ex.primaryMuscleGroup);
    const secondaryId = ex.secondaryMuscleGroup
      ? nameToId.get(ex.secondaryMuscleGroup)
      : null;
    if (!primaryId) continue;
    db.insert(exercises)
      .values({
        name: ex.name,
        primaryMuscleGroupId: primaryId,
        secondaryMuscleGroupId: secondaryId ?? null,
        equipment: ex.equipment,
      })
      .run();
  }
}

seedIfEmpty();

// ---------------------------------------------------------------------------
// Storage interface
// ---------------------------------------------------------------------------
export interface IStorage {
  // Muscle groups
  getMuscleGroups(): Promise<MuscleGroup[]>;
  getMuscleGroup(id: number): Promise<MuscleGroup | undefined>;

  // Exercises
  getExercises(): Promise<Exercise[]>;
  getExercise(id: number): Promise<Exercise | undefined>;
  createExercise(exercise: InsertExercise): Promise<Exercise>;

  // Workouts
  getWorkouts(): Promise<Workout[]>;
  getWorkout(id: number): Promise<Workout | undefined>;
  getWorkoutWithSets(id: number): Promise<WorkoutWithSets | undefined>;
  createWorkout(workout: InsertWorkout): Promise<Workout>;
  updateWorkout(id: number, workout: Partial<InsertWorkout>): Promise<Workout | undefined>;
  deleteWorkout(id: number): Promise<void>;

  // Sets
  getSetsForWorkout(workoutId: number): Promise<SetWithExercise[]>;
  getSetsForExercise(exerciseId: number): Promise<SetWithExercise[]>;
  getAllSets(): Promise<SetWithExercise[]>;
  createSet(set: InsertSet): Promise<Set>;
  updateSet(id: number, set: Partial<InsertSet>): Promise<Set | undefined>;
  deleteSet(id: number): Promise<void>;

  // Bodyweight logs
  getBodyweightLogs(): Promise<BodyweightLog[]>;
  createBodyweightLog(log: InsertBodyweightLog): Promise<BodyweightLog>;
}

export class DatabaseStorage implements IStorage {
  async getMuscleGroups(): Promise<MuscleGroup[]> {
    return db.select().from(muscleGroups).all();
  }

  async getMuscleGroup(id: number): Promise<MuscleGroup | undefined> {
    return db.select().from(muscleGroups).where(eq(muscleGroups.id, id)).get();
  }

  async getExercises(): Promise<Exercise[]> {
    return db.select().from(exercises).all();
  }

  async getExercise(id: number): Promise<Exercise | undefined> {
    return db.select().from(exercises).where(eq(exercises.id, id)).get();
  }

  async createExercise(exercise: InsertExercise): Promise<Exercise> {
    return db.insert(exercises).values(exercise).returning().get();
  }

  async getWorkouts(): Promise<Workout[]> {
    return db.select().from(workouts).orderBy(desc(workouts.date), desc(workouts.id)).all();
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

  async getSetsForWorkout(workoutId: number): Promise<SetWithExercise[]> {
    const rows = db
      .select()
      .from(sets)
      .innerJoin(exercises, eq(sets.exerciseId, exercises.id))
      .where(eq(sets.workoutId, workoutId))
      .all();
    return rows.map((r) => ({ ...r.sets, exercise: r.exercises }));
  }

  async getSetsForExercise(exerciseId: number): Promise<SetWithExercise[]> {
    const rows = db
      .select()
      .from(sets)
      .innerJoin(exercises, eq(sets.exerciseId, exercises.id))
      .where(eq(sets.exerciseId, exerciseId))
      .all();
    return rows.map((r) => ({ ...r.sets, exercise: r.exercises }));
  }

  async getAllSets(): Promise<SetWithExercise[]> {
    const rows = db
      .select()
      .from(sets)
      .innerJoin(exercises, eq(sets.exerciseId, exercises.id))
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

  async getBodyweightLogs(): Promise<BodyweightLog[]> {
    return db.select().from(bodyweightLogs).orderBy(desc(bodyweightLogs.date)).all();
  }

  async createBodyweightLog(log: InsertBodyweightLog): Promise<BodyweightLog> {
    return db.insert(bodyweightLogs).values(log).returning().get();
  }
}

export const storage = new DatabaseStorage();
