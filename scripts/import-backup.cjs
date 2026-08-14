// One-time import script: rebuilds data.db from a forge-full-backup JSON export.
// Usage: node scripts/import-backup.cjs <path-to-backup.json> <path-to-output-data.db>
//
// This creates the schema fresh (matching shared/schema.ts) and inserts all rows with
// their ORIGINAL ids preserved, so foreign keys (workoutId, exerciseId, etc.) stay valid.
// After DA's data is inserted, DA is promoted to admin as requested.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const backupPath = process.argv[2];
const outputPath = process.argv[3];

if (!backupPath || !outputPath) {
  console.error("Usage: node import-backup.cjs <backup.json> <output data.db>");
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
if (backup.exportType !== "forge-full-backup") {
  console.error("Unexpected exportType:", backup.exportType);
  process.exit(1);
}

if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
const walPath = outputPath + "-wal";
const shmPath = outputPath + "-shm";
if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

const db = new Database(outputPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  color_accent TEXT,
  theme_color TEXT NOT NULL DEFAULT 'green',
  theme_mode TEXT NOT NULL DEFAULT 'dark',
  workout_split TEXT NOT NULL DEFAULT 'ppl',
  training_level TEXT NOT NULL DEFAULT 'intermediate',
  training_goal TEXT NOT NULL DEFAULT 'hypertrophy',
  timezone_mode TEXT NOT NULL DEFAULT 'home',
  home_timezone TEXT
);

CREATE TABLE user_recovery_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  fatigue_sensitivity REAL NOT NULL DEFAULT 1,
  overall_recovery_speed REAL NOT NULL DEFAULT 1,
  muscle_recovery_speeds TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE user_coach_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  progression_style TEXT NOT NULL DEFAULT 'automatic',
  min_comparable_exposures INTEGER NOT NULL DEFAULT 3,
  trend_history_limit INTEGER NOT NULL DEFAULT 5,
  preferred_rir_min INTEGER NOT NULL DEFAULT 1,
  preferred_rir_max INTEGER NOT NULL DEFAULT 2,
  failure_fatigue_sensitivity TEXT NOT NULL DEFAULT 'normal',
  fatigue_sensitivity TEXT NOT NULL DEFAULT 'normal',
  volume_progression_sensitivity TEXT NOT NULL DEFAULT 'normal'
);

CREATE TABLE muscle_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  mev REAL NOT NULL,
  mav REAL NOT NULL,
  mrv REAL NOT NULL
);

CREATE TABLE user_muscle_coach_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id) ON DELETE CASCADE,
  recovery_half_life_hours REAL,
  mev REAL,
  mav REAL,
  mrv REAL,
  UNIQUE(user_id, muscle_group_id)
);

CREATE TABLE user_muscle_learned_ranges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id) ON DELETE CASCADE,
  productive_low REAL,
  productive_high REAL,
  confidence INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, muscle_group_id)
);

CREATE TABLE exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  primary_muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id),
  secondary_muscles TEXT NOT NULL DEFAULT '[]',
  equipment TEXT NOT NULL,
  movement_pattern TEXT,
  is_compound INTEGER NOT NULL DEFAULT 0,
  is_unilateral INTEGER NOT NULL DEFAULT 0,
  tracking_mode TEXT NOT NULL DEFAULT 'reps'
);

CREATE TABLE exercise_muscle_stimulus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id),
  stimulus_ratio REAL NOT NULL CHECK(stimulus_ratio >= 0 AND stimulus_ratio <= 1),
  UNIQUE(exercise_id, muscle_group_id)
);

CREATE TABLE user_exercise_muscle_stimulus_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_group_id INTEGER NOT NULL REFERENCES muscle_groups(id),
  stimulus_ratio REAL NOT NULL CHECK(stimulus_ratio >= 0 AND stimulus_ratio <= 1),
  UNIQUE(user_id, exercise_id, muscle_group_id)
);

CREATE TABLE user_exercise_coach_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  fatigue_cost REAL NOT NULL,
  UNIQUE(user_id, exercise_id)
);

CREATE TABLE workout_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE workout_template_exercises (
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
  target_duration_min_seconds INTEGER,
  target_duration_max_seconds INTEGER,
  tempo TEXT,
  target_rir INTEGER NOT NULL DEFAULT 2,
  failure_target TEXT NOT NULL DEFAULT 'Never',
  intensity_technique TEXT,
  rest_seconds INTEGER NOT NULL DEFAULT 90,
  notes TEXT
);

CREATE TABLE workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  started_at TEXT,
  tz TEXT,
  name TEXT,
  notes TEXT,
  workout_template_id INTEGER REFERENCES workout_templates(id)
);

CREATE TABLE workout_exercise_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  exercise_role TEXT NOT NULL DEFAULT 'Isolation',
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps_min INTEGER NOT NULL DEFAULT 8,
  target_reps_max INTEGER NOT NULL DEFAULT 12,
  target_duration_min_seconds INTEGER,
  target_duration_max_seconds INTEGER,
  target_rir INTEGER NOT NULL DEFAULT 2,
  failure_target TEXT NOT NULL DEFAULT 'Never',
  intensity_technique TEXT,
  rest_seconds INTEGER NOT NULL DEFAULT 90,
  tracking_mode TEXT NOT NULL DEFAULT 'reps',
  UNIQUE(workout_id, exercise_id)
);

CREATE TABLE sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id),
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  set_number INTEGER NOT NULL,
  weight REAL NOT NULL,
  reps INTEGER NOT NULL,
  duration_seconds INTEGER,
  rir REAL,
  is_warmup INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE workout_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  active_split TEXT,
  rotation_cycle TEXT NOT NULL DEFAULT '[]',
  rotation_cursor INTEGER NOT NULL DEFAULT 0,
  weekly_rest_days TEXT NOT NULL DEFAULT '[]',
  last_generated_month TEXT,
  custom_weekly_template TEXT NOT NULL DEFAULT '[null,null,null,null,null,null,null]'
);

CREATE TABLE schedule_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES workout_schedules(id),
  date TEXT NOT NULL,
  workout_template_id INTEGER REFERENCES workout_templates(id),
  label TEXT,
  is_manual_override INTEGER NOT NULL DEFAULT 0,
  is_user_placed INTEGER NOT NULL DEFAULT 0,
  is_weekly_blocked INTEGER NOT NULL DEFAULT 0,
  has_core_addon INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE bodyweight_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  weight REAL NOT NULL
);
`);

const d = backup.data;
let counts = {};

function insertMany(tableSql, rows, mapFn) {
  const stmt = db.prepare(tableSql);
  const tx = db.transaction((items) => {
    for (const item of items) stmt.run(...mapFn(item));
  });
  tx(rows);
  return rows.length;
}

counts.muscleGroups = insertMany(
  `INSERT INTO muscle_groups (id, name, mev, mav, mrv) VALUES (?, ?, ?, ?, ?)`,
  d.muscleGroups,
  (mg) => [mg.id, mg.name, mg.mev, mg.mav, mg.mrv]
);

counts.exercises = insertMany(
  `INSERT INTO exercises (id, name, primary_muscle_group_id, secondary_muscles, equipment, movement_pattern, is_compound, is_unilateral, tracking_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  d.exercises,
  (ex) => [
    ex.id,
    ex.name,
    ex.primaryMuscleGroupId,
    ex.secondaryMuscles,
    ex.equipment,
    ex.movementPattern,
    ex.isCompound ? 1 : 0,
    ex.isUnilateral ? 1 : 0,
    ex.trackingMode || "reps",
  ]
);

counts.exerciseMuscleStimulus = insertMany(
  `INSERT INTO exercise_muscle_stimulus (id, exercise_id, muscle_group_id, stimulus_ratio) VALUES (?, ?, ?, ?)`,
  d.exerciseMuscleStimulus || [],
  (row) => [row.id, row.exerciseId, row.muscleGroupId, row.stimulusRatio]
);

let userCount = 0,
  templateCount = 0,
  wteCount = 0,
  workoutCount = 0,
  setCount = 0,
  scheduleCount = 0,
  scheduleDayCount = 0,
  bwCount = 0,
  stimulusOverrideCount = 0,
  recoverySettingsCount = 0,
  coachSettingsCount = 0,
  muscleCoachOverrideCount = 0,
  exerciseCoachOverrideCount = 0,
  workoutSnapshotCount = 0,
  learnedRangeCount = 0;

const insertUser = db.prepare(
  `INSERT INTO users (id, name, password_hash, is_admin, color_accent, theme_color, theme_mode, workout_split, training_level, training_goal, timezone_mode, home_timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertTemplate = db.prepare(
  `INSERT INTO workout_templates (id, user_id, name, notes) VALUES (?, ?, ?, ?)`
);
const insertWte = db.prepare(
  `INSERT INTO workout_template_exercises (id, workout_template_id, exercise_id, exercise_order, exercise_role, warmup_sets, top_sets, backoff_sets, backoff_reduction_percent, target_sets, target_reps_min, target_reps_max, target_duration_min_seconds, target_duration_max_seconds, tempo, target_rir, failure_target, intensity_technique, rest_seconds, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertWorkout = db.prepare(
  `INSERT INTO workouts (id, user_id, date, started_at, tz, name, notes, workout_template_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertSet = db.prepare(
  `INSERT INTO sets (id, workout_id, exercise_id, set_number, weight, reps, duration_seconds, rir, is_warmup) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertSchedule = db.prepare(
  `INSERT INTO workout_schedules (id, user_id, active_split, rotation_cycle, rotation_cursor, weekly_rest_days, last_generated_month, custom_weekly_template) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertScheduleDay = db.prepare(
  `INSERT INTO schedule_days (id, schedule_id, date, workout_template_id, label, is_manual_override, is_user_placed, is_weekly_blocked, has_core_addon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertBw = db.prepare(
  `INSERT INTO bodyweight_logs (id, user_id, date, weight) VALUES (?, ?, ?, ?)`
);
const insertStimulusOverride = db.prepare(
  `INSERT INTO user_exercise_muscle_stimulus_overrides (id, user_id, exercise_id, muscle_group_id, stimulus_ratio) VALUES (?, ?, ?, ?, ?)`
);
const insertRecoverySettings = db.prepare(
  `INSERT INTO user_recovery_settings (user_id, fatigue_sensitivity, overall_recovery_speed, muscle_recovery_speeds) VALUES (?, ?, ?, ?)`
);
const insertCoachSettings = db.prepare(
  `INSERT INTO user_coach_settings (user_id, progression_style, min_comparable_exposures, trend_history_limit, preferred_rir_min, preferred_rir_max, failure_fatigue_sensitivity, fatigue_sensitivity, volume_progression_sensitivity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertMuscleCoachOverride = db.prepare(
  `INSERT INTO user_muscle_coach_overrides (id, user_id, muscle_group_id, recovery_half_life_hours, mev, mav, mrv) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insertExerciseCoachOverride = db.prepare(
  `INSERT INTO user_exercise_coach_overrides (id, user_id, exercise_id, fatigue_cost) VALUES (?, ?, ?, ?)`
);
const insertWorkoutSnapshot = db.prepare(
  `INSERT INTO workout_exercise_snapshots (id, workout_id, exercise_id, exercise_role, target_sets, target_reps_min, target_reps_max, target_duration_min_seconds, target_duration_max_seconds, target_rir, failure_target, intensity_technique, rest_seconds, tracking_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertLearnedRange = db.prepare(
  `INSERT INTO user_muscle_learned_ranges (id, user_id, muscle_group_id, productive_low, productive_high, confidence) VALUES (?, ?, ?, ?, ?, ?)`
);

const importAll = db.transaction(() => {
  for (const profile of d.profiles) {
    const u = profile.user;
    // DA (originally non-admin) is promoted to admin per user request; all other
    // admin flags are preserved as they were in the original export.
    const isAdmin = u.name === "DA" ? true : !!u.isAdmin;
    insertUser.run(
      u.id,
      u.name,
      u.passwordHash,
      isAdmin ? 1 : 0,
      u.colorAccent,
      u.themeColor,
      u.themeMode,
      u.workoutSplit,
      u.trainingLevel || "advanced",
      u.trainingGoal || "hypertrophy",
      u.timezoneMode || "home",
      u.homeTimezone || null
    );
    userCount++;

    if (profile.recoverySettings) {
      const settings = profile.recoverySettings;
      insertRecoverySettings.run(
        u.id,
        settings.fatigueSensitivity ?? 1,
        settings.overallRecoverySpeed ?? 1,
        settings.muscleRecoverySpeeds ?? "{}"
      );
      recoverySettingsCount++;
    }

    if (profile.coachSettings) {
      const settings = profile.coachSettings;
      insertCoachSettings.run(
        u.id,
        settings.progressionStyle,
        settings.minComparableExposures,
        settings.trendHistoryLimit,
        settings.preferredRirMin,
        settings.preferredRirMax,
        settings.failureFatigueSensitivity,
        settings.fatigueSensitivity,
        settings.volumeProgressionSensitivity
      );
      coachSettingsCount++;
    }

    for (const t of profile.workoutTemplates || []) {
      insertTemplate.run(t.id, t.userId, t.name, t.notes);
      templateCount++;
    }
    for (const wte of profile.workoutTemplateExercises || []) {
      insertWte.run(
        wte.id,
        wte.workoutTemplateId,
        wte.exerciseId,
        wte.exerciseOrder,
        wte.exerciseRole,
        wte.warmupSets,
        wte.topSets,
        wte.backoffSets,
        wte.backoffReductionPercent,
        wte.targetSets,
        wte.targetRepsMin,
        wte.targetRepsMax,
        wte.targetDurationMinSeconds ?? null,
        wte.targetDurationMaxSeconds ?? null,
        wte.tempo,
        wte.targetRir,
        wte.failureTarget,
        wte.intensityTechnique,
        wte.restSeconds,
        wte.notes
      );
      wteCount++;
    }
    for (const w of profile.workouts || []) {
      insertWorkout.run(w.id, w.userId, w.date, w.startedAt || null, w.tz || null, w.name, w.notes, w.workoutTemplateId);
      workoutCount++;
    }
    for (const snapshot of profile.workoutExerciseSnapshots || []) {
      insertWorkoutSnapshot.run(
        snapshot.id,
        snapshot.workoutId,
        snapshot.exerciseId,
        snapshot.exerciseRole,
        snapshot.targetSets,
        snapshot.targetRepsMin,
        snapshot.targetRepsMax,
        snapshot.targetDurationMinSeconds ?? null,
        snapshot.targetDurationMaxSeconds ?? null,
        snapshot.targetRir,
        snapshot.failureTarget,
        snapshot.intensityTechnique ?? null,
        snapshot.restSeconds,
        snapshot.trackingMode || "reps"
      );
      workoutSnapshotCount++;
    }
    for (const s of profile.sets || []) {
      insertSet.run(s.id, s.workoutId, s.exerciseId, s.setNumber, s.weight, s.reps, s.durationSeconds ?? null, s.rir, s.isWarmup ? 1 : 0);
      setCount++;
    }
    const sched = profile.workoutSchedule;
    if (sched) {
      insertSchedule.run(
        sched.id,
        sched.userId,
        sched.activeSplit,
        sched.rotationCycle,
        sched.rotationCursor,
        sched.weeklyRestDays,
        sched.lastGeneratedMonth,
        sched.customWeeklyTemplate
      );
      scheduleCount++;
    }
    for (const sd of profile.scheduleDays || []) {
      insertScheduleDay.run(
        sd.id,
        sd.scheduleId,
        sd.date,
        sd.workoutTemplateId,
        sd.label,
        sd.isManualOverride ? 1 : 0,
        sd.isUserPlaced ? 1 : 0,
        sd.isWeeklyBlocked ? 1 : 0,
        sd.hasCoreAddon ? 1 : 0
      );
      scheduleDayCount++;
    }
    for (const bw of profile.bodyweightLogs || []) {
      insertBw.run(bw.id, bw.userId, bw.date, bw.weight);
      bwCount++;
    }
    for (const row of profile.exerciseStimulusOverrides || []) {
      insertStimulusOverride.run(row.id, row.userId, row.exerciseId, row.muscleGroupId, row.stimulusRatio);
      stimulusOverrideCount++;
    }
    for (const row of profile.muscleCoachOverrides || []) {
      insertMuscleCoachOverride.run(row.id, row.userId, row.muscleGroupId, row.recoveryHalfLifeHours ?? null, row.mev ?? null, row.mav ?? null, row.mrv ?? null);
      muscleCoachOverrideCount++;
    }
    for (const row of profile.exerciseCoachOverrides || []) {
      insertExerciseCoachOverride.run(row.id, row.userId, row.exerciseId, row.fatigueCost);
      exerciseCoachOverrideCount++;
    }
    for (const row of profile.learnedVolumeRanges || []) {
      insertLearnedRange.run(row.id, row.userId, row.muscleGroupId, row.productiveLow ?? null, row.productiveHigh ?? null, row.confidence ?? 0);
      learnedRangeCount++;
    }
  }
});
importAll();

// Reset SQLite autoincrement sequence trackers so future inserts continue after
// the highest imported id, instead of colliding with restored historical ids.
const tables = [
  "users",
  "workout_templates",
  "workout_template_exercises",
  "workouts",
  "sets",
  "workout_schedules",
  "schedule_days",
  "bodyweight_logs",
  "muscle_groups",
  "exercises",
  "exercise_muscle_stimulus",
  "user_exercise_muscle_stimulus_overrides",
  "user_muscle_coach_overrides",
  "user_exercise_coach_overrides",
  "workout_exercise_snapshots",
  "user_muscle_learned_ranges",
];
for (const t of tables) {
  const max = db.prepare(`SELECT COALESCE(MAX(id), 0) as m FROM ${t}`).get().m;
  const existing = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = ?`).get(t);
  if (existing) {
    db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`).run(max, t);
  } else {
    db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`).run(t, max);
  }
}

db.pragma("wal_checkpoint(TRUNCATE)");
db.close();

console.log("Import complete:");
console.log({
  muscleGroups: counts.muscleGroups,
  exercises: counts.exercises,
  users: userCount,
  workoutTemplates: templateCount,
  workoutTemplateExercises: wteCount,
  workouts: workoutCount,
  sets: setCount,
  workoutSchedules: scheduleCount,
  scheduleDays: scheduleDayCount,
  bodyweightLogs: bwCount,
  exerciseMuscleStimulus: counts.exerciseMuscleStimulus,
  exerciseStimulusOverrides: stimulusOverrideCount,
  recoverySettings: recoverySettingsCount,
  coachSettings: coachSettingsCount,
  muscleCoachOverrides: muscleCoachOverrideCount,
  exerciseCoachOverrides: exerciseCoachOverrideCount,
  workoutExerciseSnapshots: workoutSnapshotCount,
  learnedVolumeRanges: learnedRangeCount,
});
