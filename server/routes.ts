import type { Express, Request, Response } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage, parseExercise, db } from "./storage";
import type { SetWithExercise } from "./storage";
import {
  users as usersTable,
  muscleGroups as muscleGroupsTable,
  exercises as exercisesTable,
  workoutTemplates as workoutTemplatesTable,
  workoutTemplateExercises as workoutTemplateExercisesTable,
  workouts as workoutsTable,
  sets as setsTable,
  workoutSchedules as workoutSchedulesTable,
  scheduleDays as scheduleDaysTable,
  bodyweightLogs as bodyweightLogsTable,
} from "@shared/schema";
import { inArray, eq } from "drizzle-orm";
import {
  insertExerciseSchema,
  insertWorkoutSchema,
  insertSetSchema,
  insertBodyweightLogSchema,
  insertWorkoutTemplateSchema,
  insertWorkoutTemplateExerciseSchema,
  insertUserSchema,
  updateUserPreferencesSchema,
  generateScheduleSchema,
  setWeeklyRestDaysSchema,
  setCustomWeeklyTemplateSchema,
  moveScheduleDaySchema,
  setScheduleDaySchema,
  setCoreAddonSchema,
  muscleGroupNames,
  muscleGroupDisplayNames,
  type MuscleGroupName,
  type Exercise,
  type Workout,
  type User,
} from "@shared/schema";
import {
  categorizeVolume,
  computeWeeklyVolumeByMuscleGroup,
  evaluateProgression,
  evaluateRecovery,
  evaluateFatigueTrend,
  getPersonalRecords,
  buildWorkoutSuggestion,
  getDashboardSnapshot,
  analyzeWorkoutComposition,
  getPreviousExercisePerformance,
  getPrimaryRecovery,
  personalRecordSummary,
  type HistorySessionInput,
  type HistoryExerciseInput,
  type HistorySetInput,
  type MuscleGroupLookup,
  type DashboardTemplateInput,
  monthBounds,
} from "@shared/coaching";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Active-user resolution — reads the `X-User-Id` header set by the frontend's
// apiRequest helper. No session/cookie infra; this is profile separation for
// shared-device convenience only, not a security boundary.
// ---------------------------------------------------------------------------
function getUserId(req: Request, res: Response): number | null {
  const header = req.header("x-user-id");
  const id = header ? Number(header) : NaN;
  if (!header || Number.isNaN(id)) {
    res.status(400).json({ message: "Missing or invalid X-User-Id header" });
    return null;
  }
  return id;
}

function startOfWeekWindow(referenceDate: Date, weeksAgo: number): { start: Date; end: Date } {
  const end = new Date(referenceDate.getTime() - weeksAgo * 7 * DAY_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Build coaching-engine input shapes from raw DB rows
// ---------------------------------------------------------------------------
async function buildMuscleGroupLookup(): Promise<{
  lookup: MuscleGroupLookup;
  idByName: Map<MuscleGroupName, number>;
  nameById: Map<number, MuscleGroupName>;
}> {
  const groups = await storage.getMuscleGroups();
  const idToName = new Map<number, MuscleGroupName>();
  const idByName = new Map<MuscleGroupName, number>();
  for (const g of groups) {
    idToName.set(g.id, g.name as MuscleGroupName);
    idByName.set(g.name as MuscleGroupName, g.id);
  }
  return { lookup: { idToName }, idByName, nameById: idToName };
}

function toHistorySet(s: SetWithExercise): HistorySetInput {
  return {
    setNumber: s.setNumber,
    setType: s.isWarmup ? "Warmup" : "Working",
    weight: s.weight,
    reps: s.reps,
    rir: s.rir ?? null,
    completed: true, // all logged sets are considered completed (no partial-set concept in this app)
  };
}

/** Build full workout history (most-recent-first) as HistorySessionInput[] for a specific user. */
async function buildHistory(userId: number): Promise<HistorySessionInput[]> {
  const workoutsList = await storage.getWorkouts(userId); // already ordered desc by date, id
  const allSets = await storage.getAllSets(userId);

  const setsByWorkout = new Map<number, SetWithExercise[]>();
  for (const s of allSets) {
    if (!setsByWorkout.has(s.workoutId)) setsByWorkout.set(s.workoutId, []);
    setsByWorkout.get(s.workoutId)!.push(s);
  }

  return workoutsList.map((w) => {
    const workoutSets = setsByWorkout.get(w.id) ?? [];
    const byExercise = new Map<number, SetWithExercise[]>();
    for (const s of workoutSets) {
      if (!byExercise.has(s.exerciseId)) byExercise.set(s.exerciseId, []);
      byExercise.get(s.exerciseId)!.push(s);
    }

    const exercisesForSession: HistoryExerciseInput[] = Array.from(byExercise.entries()).map(
      ([exerciseId, exSets], idx) => {
        const exercise = exSets[0].exercise;
        return {
          exerciseId,
          exerciseOrder: idx,
          exerciseName: exercise.name,
          primaryMuscleGroupId: exercise.primaryMuscleGroupId,
          intensityTechnique: "Normal",
          failureTarget: "Never",
          sets: exSets.sort((a, b) => a.setNumber - b.setNumber).map(toHistorySet),
        };
      },
    );

    return {
      id: w.id,
      workoutTemplateId: w.workoutTemplateId ?? null,
      workoutName: w.name ?? "Workout",
      startedAt: new Date(w.date),
      exercises: exercisesForSession,
    };
  });
}


export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // ---------------- Users (profiles) ----------------
  app.get("/api/users", async (_req, res) => {
    const list = await storage.getUsers();
    res.json(list);
  });

  app.post("/api/users", async (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createUser(parsed.data);
    res.status(201).json(created);
  });

  app.patch("/api/users/:id", async (req, res) => {
    const id = Number(req.params.id);
    const nameSchema = insertUserSchema.pick({ name: true });
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const updated = await storage.renameUser(id, parsed.data.name);
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(updated);
  });

  app.patch("/api/users/:id/preferences", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = updateUserPreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const updated = await storage.updateUserPreferences(id, parsed.data);
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(updated);
  });

  // ---------------- Muscle Groups (shared/global) ----------------
  app.get("/api/muscle-groups", async (_req, res) => {
    const groups = await storage.getMuscleGroups();
    const enriched = groups.map((g) => ({
      ...g,
      displayName: muscleGroupDisplayNames[g.name as MuscleGroupName] ?? g.name,
    }));
    res.json(enriched);
  });

  // ---------------- Exercises (shared/global) ----------------
  app.get("/api/exercises", async (_req, res) => {
    const list = await storage.getExercises();
    res.json(list.map(parseExercise));
  });

  app.post("/api/exercises", async (req, res) => {
    const parsed = insertExerciseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createExercise(parsed.data);
    res.status(201).json(parseExercise(created));
  });

  app.get("/api/exercises/:id/sets", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const id = Number(req.params.id);
    const list = await storage.getSetsForExercise(id, userId);
    const workoutsList = await storage.getWorkouts(userId);
    const workoutDateMap = new Map(workoutsList.map((w) => [w.id, w.date]));
    const enriched = list
      .map((s) => ({ ...s, workoutDate: workoutDateMap.get(s.workoutId) ?? "" }))
      .sort((a, b) => a.workoutDate.localeCompare(b.workoutDate) || a.id - b.id);
    res.json(enriched);
  });

  // Personal records for a specific exercise
  app.get("/api/exercises/:id/records", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const id = Number(req.params.id);
    const history = await buildHistory(userId);
    const filtered = history
      .map((h) => ({ ...h, exercises: h.exercises.filter((e) => e.exerciseId === id) }))
      .filter((h) => h.exercises.length > 0);
    const records = getPersonalRecords(filtered, 50);
    res.json(records.map((r) => ({ ...r, summary: personalRecordSummary(r) })));
  });

  // ---------------- Workout Templates (scoped per user) ----------------
  app.get("/api/workout-templates", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const templates = await storage.getAllWorkoutTemplatesWithExercises(userId);
    res.json(templates);
  });

  // Browse another user's templates, read-only (for cross-user template copying UI)
  app.get("/api/workout-templates/shared/:userId", async (req, res) => {
    const targetUserId = Number(req.params.userId);
    const templates = await storage.getAllWorkoutTemplatesWithExercises(targetUserId);
    res.json(templates);
  });

  app.get("/api/workout-templates/:id", async (req, res) => {
    const id = Number(req.params.id);
    const template = await storage.getWorkoutTemplateWithExercises(id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });

  app.post("/api/workout-templates", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = insertWorkoutTemplateSchema.safeParse({ ...req.body, userId });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createWorkoutTemplate(parsed.data);
    res.status(201).json(created);
  });

  app.post("/api/workout-templates/:id/exercises", async (req, res) => {
    const workoutTemplateId = Number(req.params.id);
    const parsed = insertWorkoutTemplateExerciseSchema.safeParse({ ...req.body, workoutTemplateId });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createWorkoutTemplateExercise(parsed.data);
    res.status(201).json(created);
  });

  // Deep-copy another user's template into the requesting (or specified target) user's library.
  app.post("/api/workout-templates/:id/copy", async (req, res) => {
    const id = Number(req.params.id);
    const bodyTargetUserId = req.body?.targetUserId != null ? Number(req.body.targetUserId) : undefined;
    const headerUserId = getUserId(req, res);
    const targetUserId = bodyTargetUserId ?? headerUserId;
    if (targetUserId == null) return; // getUserId already responded with 400 if header missing/invalid
    const copy = await storage.copyWorkoutTemplate(id, targetUserId);
    if (!copy) return res.status(404).json({ message: "Template not found" });
    res.status(201).json(copy);
  });

  app.delete("/api/workout-templates/:id", async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteWorkoutTemplate(id);
    res.status(204).end();
  });

  // Workout composition analysis for a template (or ad-hoc exercise list)
  app.get("/api/workout-templates/:id/analysis", async (req, res) => {
    const id = Number(req.params.id);
    const template = await storage.getWorkoutTemplateWithExercises(id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    const exercisesList = await storage.getExercises();
    const exerciseMap = new Map(exercisesList.map((e) => [e.id, e]));
    const { nameById } = await buildMuscleGroupLookup();

    const rows = template.exercises.map((te) => {
      const exercise = exerciseMap.get(te.exerciseId);
      const primaryMuscleName = exercise
        ? muscleGroupDisplayNames[nameById.get(exercise.primaryMuscleGroupId) as MuscleGroupName] ?? ""
        : "";
      return {
        targetSets: te.targetSets,
        restSeconds: te.restSeconds,
        isCompound: exercise?.isCompound ?? false,
        exerciseRole: te.exerciseRole,
        failureTarget: te.failureTarget,
        primaryMuscleName,
      };
    });

    res.json(analyzeWorkoutComposition(rows));
  });

  // ---------------- Template editor (owner-only mutations) ----------------
  // Templates are scoped per user; editing routes verify the requesting
  // X-User-Id matches the template's userId and reject with 403 otherwise.
  app.patch("/api/workout-templates/:id", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const id = Number(req.params.id);
    const template = await storage.getWorkoutTemplate(id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    if (template.userId !== userId) return res.status(403).json({ message: "You do not own this template" });

    const patchSchema = insertWorkoutTemplateSchema.pick({ name: true, notes: true }).partial();
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const updated = await storage.updateWorkoutTemplate(id, parsed.data);
    res.json(updated);
  });

  app.patch("/api/workout-templates/:id/exercises/:teId", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const id = Number(req.params.id);
    const teId = Number(req.params.teId);
    const template = await storage.getWorkoutTemplate(id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    if (template.userId !== userId) return res.status(403).json({ message: "You do not own this template" });

    const patchSchema = insertWorkoutTemplateExerciseSchema.partial();
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const updated = await storage.updateWorkoutTemplateExercise(teId, parsed.data);
    if (!updated) return res.status(404).json({ message: "Template exercise not found" });
    res.json(updated);
  });

  app.delete("/api/workout-templates/:id/exercises/:teId", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const id = Number(req.params.id);
    const teId = Number(req.params.teId);
    const template = await storage.getWorkoutTemplate(id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    if (template.userId !== userId) return res.status(403).json({ message: "You do not own this template" });

    await storage.deleteWorkoutTemplateExercise(teId);
    res.status(204).end();
  });

  app.post("/api/workout-templates/:id/exercises/reorder", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const id = Number(req.params.id);
    const template = await storage.getWorkoutTemplate(id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    if (template.userId !== userId) return res.status(403).json({ message: "You do not own this template" });

    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((v) => typeof v !== "number")) {
      return res.status(400).json({ message: "orderedIds must be an array of numbers" });
    }

    await storage.reorderWorkoutTemplateExercises(id, orderedIds);
    const updated = await storage.getWorkoutTemplateWithExercises(id);
    res.json(updated);
  });

  // ---------------- Workouts (scoped per user) ----------------
  app.get("/api/workouts", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const list = await storage.getWorkouts(userId);
    res.json(list);
  });

  app.get("/api/workouts/:id", async (req, res) => {
    const id = Number(req.params.id);
    const workout = await storage.getWorkoutWithSets(id);
    if (!workout) return res.status(404).json({ message: "Workout not found" });
    res.json(workout);
  });

  app.post("/api/workouts", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = insertWorkoutSchema.safeParse({ ...req.body, userId });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createWorkout(parsed.data);
    if (created.workoutTemplateId != null) {
      await storage.advanceRotation(userId, created.workoutTemplateId, created.date);
    }
    res.status(201).json(created);
  });

  app.patch("/api/workouts/:id", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = insertWorkoutSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const updated = await storage.updateWorkout(id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Workout not found" });
    res.json(updated);
  });

  app.delete("/api/workouts/:id", async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteWorkout(id);
    res.status(204).end();
  });

  // ---------------- Sets (scope inherited via workoutId -> workouts.userId) ----------------
  app.post("/api/sets", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = insertSetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    // Verify the parent workout belongs to the requesting user before allowing insert.
    const parentWorkout = await storage.getWorkout(parsed.data.workoutId);
    if (!parentWorkout) return res.status(404).json({ message: "Workout not found" });
    if (parentWorkout.userId !== userId) {
      return res.status(403).json({ message: "Workout does not belong to the active user" });
    }
    const created = await storage.createSet(parsed.data);
    res.status(201).json(created);
  });

  app.patch("/api/sets/:id", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = insertSetSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const updated = await storage.updateSet(id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Set not found" });
    res.json(updated);
  });

  app.delete("/api/sets/:id", async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteSet(id);
    res.status(204).end();
  });

  // ---------------- Bodyweight logs (scoped per user) ----------------
  app.get("/api/bodyweight-logs", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const list = await storage.getBodyweightLogs(userId);
    res.json(list);
  });

  app.post("/api/bodyweight-logs", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = insertBodyweightLogSchema.safeParse({ ...req.body, userId });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createBodyweightLog(parsed.data);
    res.status(201).json(created);
  });

  // ---------------- Dashboard: weekly volume per muscle group (19 groups) ----------------
  app.get("/api/dashboard/volume", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const muscleGroupsList = await storage.getMuscleGroups();
    const workoutsList = await storage.getWorkouts(userId);
    const workoutMap = new Map(workoutsList.map((w) => [w.id, w]));
    const allSets = await storage.getAllSets(userId);

    const now = new Date();
    const weeksBack = req.query.weeksBack ? Number(req.query.weeksBack) : 0;
    const { start, end } = startOfWeekWindow(now, weeksBack);

    const inWindow = allSets.filter((s) => {
      const w = workoutMap.get(s.workoutId);
      if (!w) return false;
      const d = new Date(w.date);
      return d >= start && d < end;
    });

    const tagged = inWindow.map((s) => ({
      primaryMuscleGroupId: s.exercise.primaryMuscleGroupId,
      secondaryMuscleGroupIds: JSON.parse(s.exercise.secondaryMuscles ?? "[]") as number[],
      isWarmup: s.isWarmup,
    }));

    const volumeMap = computeWeeklyVolumeByMuscleGroup(tagged);

    const result = muscleGroupsList.map((mg) => {
      const setCount = volumeMap.get(mg.id) ?? 0;
      return {
        muscleGroupId: mg.id,
        muscleGroupName: mg.name,
        displayName: muscleGroupDisplayNames[mg.name as MuscleGroupName] ?? mg.name,
        sets: setCount,
        mev: mg.mev,
        mav: mg.mav,
        mrv: mg.mrv,
        status: categorizeVolume(setCount, mg),
      };
    });

    res.json(result);
  });

  // ---------------- Volume tracker: current vs last week + trend (19 groups) ----------------
  app.get("/api/volume-tracker", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const muscleGroupsList = await storage.getMuscleGroups();
    const workoutsList = await storage.getWorkouts(userId);
    const workoutMap = new Map(workoutsList.map((w) => [w.id, w]));
    const allSets = await storage.getAllSets(userId);

    const now = new Date();

    function volumeForWeeksBack(weeksBack: number) {
      const { start, end } = startOfWeekWindow(now, weeksBack);
      const inWindow = allSets.filter((s) => {
        const w = workoutMap.get(s.workoutId);
        if (!w) return false;
        const d = new Date(w.date);
        return d >= start && d < end;
      });
      const tagged = inWindow.map((s) => ({
        primaryMuscleGroupId: s.exercise.primaryMuscleGroupId,
        secondaryMuscleGroupIds: JSON.parse(s.exercise.secondaryMuscles ?? "[]") as number[],
        isWarmup: s.isWarmup,
      }));
      return computeWeeklyVolumeByMuscleGroup(tagged);
    }

    const thisWeek = volumeForWeeksBack(0);
    const lastWeek = volumeForWeeksBack(1);
    const trendWeeks: Map<number, number>[] = [];
    for (let i = 5; i >= 0; i--) {
      trendWeeks.push(volumeForWeeksBack(i));
    }

    const result = muscleGroupsList.map((mg) => {
      const current = thisWeek.get(mg.id) ?? 0;
      const previous = lastWeek.get(mg.id) ?? 0;
      const trend = trendWeeks.map((w) => w.get(mg.id) ?? 0);
      return {
        muscleGroupId: mg.id,
        muscleGroupName: mg.name,
        displayName: muscleGroupDisplayNames[mg.name as MuscleGroupName] ?? mg.name,
        currentWeekSets: current,
        lastWeekSets: previous,
        delta: current - previous,
        trend,
        mev: mg.mev,
        mav: mg.mav,
        mrv: mg.mrv,
        status: categorizeVolume(current, mg),
      };
    });

    res.json(result);
  });

  // ---------------- Muscle Recovery Map ----------------
  app.get("/api/recovery", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const history = await buildHistory(userId);
    const { lookup } = await buildMuscleGroupLookup();
    const states = evaluateRecovery(history, lookup);
    res.json(states);
  });

  // ---------------- Fatigue trend ----------------
  app.get("/api/coach/fatigue-trend", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const history = await buildHistory(userId);
    const signal = evaluateFatigueTrend(history);
    res.json(signal);
  });

  // ---------------- Personal records (recent, for active user) ----------------
  app.get("/api/coach/personal-records", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const take = req.query.take ? Number(req.query.take) : 5;
    const history = await buildHistory(userId);
    const records = getPersonalRecords(history, take);
    res.json(records.map((r) => ({ ...r, summary: personalRecordSummary(r) })));
  });

  // ---------------- Coach: full suggestion detail per exercise ----------------
  app.get("/api/coach/suggestions", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const exercisesList = await storage.getExercises();
    const exerciseMap = new Map(exercisesList.map((e) => [e.id, e]));
    const history = await buildHistory(userId);
    const { lookup, nameById } = await buildMuscleGroupLookup();
    const recoveryStates = evaluateRecovery(history, lookup);

    // Optional filter by template
    const templateId = req.query.templateId ? Number(req.query.templateId) : undefined;
    let targetExercises = exercisesList;
    let prescriptionByExercise = new Map<number, { targetRepsMin: number; targetRepsMax: number; targetRir: number }>();

    if (templateId) {
      const template = await storage.getWorkoutTemplateWithExercises(templateId);
      if (template) {
        targetExercises = template.exercises
          .map((te) => exerciseMap.get(te.exerciseId))
          .filter((e): e is Exercise => !!e);
        for (const te of template.exercises) {
          prescriptionByExercise.set(te.exerciseId, {
            targetRepsMin: te.targetRepsMin,
            targetRepsMax: te.targetRepsMax,
            targetRir: te.targetRir,
          });
        }
      }
    }

    const suggestions = [];
    for (const exercise of targetExercises) {
      const prescription = prescriptionByExercise.get(exercise.id) ?? {
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRir: 2,
      };
      const previous = getPreviousExercisePerformance(history, exercise.id, exercise.name);
      if (previous.lastSets.length === 0 && !templateId) continue; // skip untrained exercises in the "all" view

      const evaluation = evaluateProgression(prescription, previous);
      const primaryMuscle = nameById.get(exercise.primaryMuscleGroupId);
      const recovery = primaryMuscle ? getPrimaryRecovery(recoveryStates, primaryMuscle) : recoveryStates[0];
      const suggestion = buildWorkoutSuggestion(prescription, previous, evaluation, recovery);

      suggestions.push({
        exerciseId: exercise.id,
        ...suggestion,
      });
    }

    res.json(suggestions);
  });

  // ---------------- Workout schedule (calendar-based) ----------------
  // ?month=YYYY-MM (defaults to current month). Auto-continues generation for that month
  // if a split is active, so navigating forward always has content.
  app.get("/api/schedule", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
    await storage.continueGeneration(userId, month);
    const [startDate, endDate] = monthBounds(month);
    const result = await storage.getWorkoutSchedule(userId, startDate, endDate);
    res.json(result);
  });

  app.post("/api/schedule/generate", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = generateScheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const month = typeof req.body.month === "string" ? req.body.month : new Date().toISOString().slice(0, 7);
    const result = await storage.generateScheduleMonth(userId, parsed.data, month);
    res.json(result);
  });

  app.patch("/api/schedule/weekly-rest-days", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = setWeeklyRestDaysSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const result = await storage.setWeeklyRestDays(userId, parsed.data.days);
    // Re-apply the new rest-day rule to the current and next month right away.
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 7);
    await storage.continueGeneration(userId, thisMonth);
    await storage.continueGeneration(userId, nextMonth);
    res.json(result);
  });

  app.put("/api/schedule/custom-template", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = setCustomWeeklyTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const result = await storage.setCustomWeeklyTemplate(userId, parsed.data);
    res.json(result);
  });

  app.post("/api/schedule/day", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = setScheduleDaySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const result = await storage.setScheduleDay(userId, parsed.data);
    res.json(result);
  });

  app.post("/api/schedule/move", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = moveScheduleDaySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const result = await storage.moveScheduleDay(userId, parsed.data);
    res.json(result);
  });

  app.post("/api/schedule/core-addon", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const parsed = setCoreAddonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const result = await storage.setCoreAddon(userId, parsed.data);
    res.json(result);
  });

  // ---------------- Dashboard snapshot ----------------
  app.get("/api/dashboard", async (req, res) => {
    const userId = getUserId(req, res);
    if (userId == null) return;
    const templates = await storage.getAllWorkoutTemplatesWithExercises(userId);
    const exercisesList = await storage.getExercises();
    const exerciseNameLookup = new Map(exercisesList.map((e) => [e.id, e.name]));
    const { lookup, nameById } = await buildMuscleGroupLookup();
    const exercisePrimaryMuscleLookup = new Map<number, MuscleGroupName>();
    for (const e of exercisesList) {
      const name = nameById.get(e.primaryMuscleGroupId);
      if (name) exercisePrimaryMuscleLookup.set(e.id, name);
    }

    const history = (await buildHistory(userId)).slice(0, 50);

    const todayIso = new Date().toISOString().slice(0, 10);
    const [monthStart, monthEnd] = monthBounds(todayIso.slice(0, 7));
    await storage.continueGeneration(userId, todayIso.slice(0, 7));
    const scheduleRow = await storage.getWorkoutSchedule(userId, monthStart, monthEnd);
    const todayDay = scheduleRow.days.find((d) => d.date === todayIso);
    const scheduleForDashboard = todayDay ? { workoutTemplateId: todayDay.workoutTemplateId, label: todayDay.label } : null;

    const dashboardTemplates: DashboardTemplateInput[] = templates.map((t) => ({
      id: t.id,
      name: t.name,
      exercises: t.exercises.map((te) => ({
        exerciseId: te.exerciseId,
        exerciseOrder: te.exerciseOrder,
        targetSets: te.targetSets,
        targetRepsMin: te.targetRepsMin,
        targetRepsMax: te.targetRepsMax,
        targetRir: te.targetRir,
        warmupSets: te.warmupSets,
        topSets: te.topSets,
        backoffSets: te.backoffSets,
        restSeconds: te.restSeconds,
      })),
    }));

    const snapshot = getDashboardSnapshot({
      templates: dashboardTemplates,
      history,
      exerciseNameLookup,
      exercisePrimaryMuscleLookup,
      muscleGroupLookup: lookup,
      schedule: scheduleForDashboard,
    });

    res.json(snapshot);
  });

  // -------------------------------------------------------------------------
  // Data export / backup — downloadable JSON snapshots for a single profile
  // or the entire database. Used by the Settings page's Backup & Export card.
  // -------------------------------------------------------------------------
  function buildUserExport(user: User) {
    const userId = user.id;
    const templates = db.select().from(workoutTemplatesTable).where(eq(workoutTemplatesTable.userId, userId)).all();
    const templateIds = templates.map((t) => t.id);
    const templateExercises = templateIds.length
      ? db.select().from(workoutTemplateExercisesTable).where(inArray(workoutTemplateExercisesTable.workoutTemplateId, templateIds)).all()
      : [];
    const workoutsRows = db.select().from(workoutsTable).where(eq(workoutsTable.userId, userId)).all();
    const workoutIds = workoutsRows.map((w) => w.id);
    const setsRows = workoutIds.length
      ? db.select().from(setsTable).where(inArray(setsTable.workoutId, workoutIds)).all()
      : [];
    const schedule = db.select().from(workoutSchedulesTable).where(eq(workoutSchedulesTable.userId, userId)).get();
    const days = schedule
      ? db.select().from(scheduleDaysTable).where(eq(scheduleDaysTable.scheduleId, schedule.id)).all()
      : [];
    const bodyweightRows = db.select().from(bodyweightLogsTable).where(eq(bodyweightLogsTable.userId, userId)).all();

    return {
      user,
      workoutTemplates: templates,
      workoutTemplateExercises: templateExercises,
      workouts: workoutsRows,
      sets: setsRows,
      workoutSchedule: schedule ?? null,
      scheduleDays: days,
      bodyweightLogs: bodyweightRows,
    };
  }

  app.get("/api/export/user/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const user = db.select().from(usersTable).where(eq(usersTable.id, userId)).get();
    if (!user) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const payload = {
      exportType: "forge-profile-backup" as const,
      exportedAt: new Date().toISOString(),
      version: 1,
      data: buildUserExport(user),
    };

    const filename = `forge-backup-${user.name.replace(/[^a-z0-9-_]+/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  app.get("/api/export/all", async (_req, res) => {
    const allUsers = db.select().from(usersTable).orderBy(usersTable.id).all();
    const allMuscleGroups = db.select().from(muscleGroupsTable).all();
    const allExercises = db.select().from(exercisesTable).all();

    const profiles = allUsers.map((user) => buildUserExport(user));

    const payload = {
      exportType: "forge-full-backup" as const,
      exportedAt: new Date().toISOString(),
      version: 1,
      data: {
        muscleGroups: allMuscleGroups,
        exercises: allExercises,
        profiles,
      },
    };

    const filename = `forge-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  return httpServer;
}
