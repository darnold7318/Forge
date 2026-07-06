import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage, parseExercise } from "./storage";
import type { SetWithExercise } from "./storage";
import {
  insertExerciseSchema,
  insertWorkoutSchema,
  insertSetSchema,
  insertBodyweightLogSchema,
  insertWorkoutTemplateSchema,
  insertWorkoutTemplateExerciseSchema,
  muscleGroupNames,
  muscleGroupDisplayNames,
  type MuscleGroupName,
  type Exercise,
  type Workout,
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
} from "@shared/coaching";

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Build full workout history (most-recent-first) as HistorySessionInput[]. */
async function buildHistory(): Promise<HistorySessionInput[]> {
  const workoutsList = await storage.getWorkouts(); // already ordered desc by date, id
  const allSets = await storage.getAllSets();

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
  // ---------------- Muscle Groups ----------------
  app.get("/api/muscle-groups", async (_req, res) => {
    const groups = await storage.getMuscleGroups();
    const enriched = groups.map((g) => ({
      ...g,
      displayName: muscleGroupDisplayNames[g.name as MuscleGroupName] ?? g.name,
    }));
    res.json(enriched);
  });

  // ---------------- Exercises ----------------
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
    const id = Number(req.params.id);
    const list = await storage.getSetsForExercise(id);
    const workoutsList = await storage.getWorkouts();
    const workoutDateMap = new Map(workoutsList.map((w) => [w.id, w.date]));
    const enriched = list
      .map((s) => ({ ...s, workoutDate: workoutDateMap.get(s.workoutId) ?? "" }))
      .sort((a, b) => a.workoutDate.localeCompare(b.workoutDate) || a.id - b.id);
    res.json(enriched);
  });

  // Personal records for a specific exercise
  app.get("/api/exercises/:id/records", async (req, res) => {
    const id = Number(req.params.id);
    const history = await buildHistory();
    const filtered = history
      .map((h) => ({ ...h, exercises: h.exercises.filter((e) => e.exerciseId === id) }))
      .filter((h) => h.exercises.length > 0);
    const records = getPersonalRecords(filtered, 50);
    res.json(records.map((r) => ({ ...r, summary: personalRecordSummary(r) })));
  });

  // ---------------- Workout Templates ----------------
  app.get("/api/workout-templates", async (_req, res) => {
    const templates = await storage.getAllWorkoutTemplatesWithExercises();
    res.json(templates);
  });

  app.get("/api/workout-templates/:id", async (req, res) => {
    const id = Number(req.params.id);
    const template = await storage.getWorkoutTemplateWithExercises(id);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });

  app.post("/api/workout-templates", async (req, res) => {
    const parsed = insertWorkoutTemplateSchema.safeParse(req.body);
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

  // ---------------- Workouts ----------------
  app.get("/api/workouts", async (_req, res) => {
    const list = await storage.getWorkouts();
    res.json(list);
  });

  app.get("/api/workouts/:id", async (req, res) => {
    const id = Number(req.params.id);
    const workout = await storage.getWorkoutWithSets(id);
    if (!workout) return res.status(404).json({ message: "Workout not found" });
    res.json(workout);
  });

  app.post("/api/workouts", async (req, res) => {
    const parsed = insertWorkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createWorkout(parsed.data);
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

  // ---------------- Sets ----------------
  app.post("/api/sets", async (req, res) => {
    const parsed = insertSetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
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

  // ---------------- Bodyweight logs ----------------
  app.get("/api/bodyweight-logs", async (_req, res) => {
    const list = await storage.getBodyweightLogs();
    res.json(list);
  });

  app.post("/api/bodyweight-logs", async (req, res) => {
    const parsed = insertBodyweightLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createBodyweightLog(parsed.data);
    res.status(201).json(created);
  });

  // ---------------- Dashboard: weekly volume per muscle group (19 groups) ----------------
  app.get("/api/dashboard/volume", async (req, res) => {
    const muscleGroupsList = await storage.getMuscleGroups();
    const workoutsList = await storage.getWorkouts();
    const workoutMap = new Map(workoutsList.map((w) => [w.id, w]));
    const allSets = await storage.getAllSets();

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
  app.get("/api/volume-tracker", async (_req, res) => {
    const muscleGroupsList = await storage.getMuscleGroups();
    const workoutsList = await storage.getWorkouts();
    const workoutMap = new Map(workoutsList.map((w) => [w.id, w]));
    const allSets = await storage.getAllSets();

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
  app.get("/api/recovery", async (_req, res) => {
    const history = await buildHistory();
    const { lookup } = await buildMuscleGroupLookup();
    const states = evaluateRecovery(history, lookup);
    res.json(states);
  });

  // ---------------- Fatigue trend ----------------
  app.get("/api/coach/fatigue-trend", async (_req, res) => {
    const history = await buildHistory();
    const signal = evaluateFatigueTrend(history);
    res.json(signal);
  });

  // ---------------- Personal records (global recent) ----------------
  app.get("/api/coach/personal-records", async (req, res) => {
    const take = req.query.take ? Number(req.query.take) : 5;
    const history = await buildHistory();
    const records = getPersonalRecords(history, take);
    res.json(records.map((r) => ({ ...r, summary: personalRecordSummary(r) })));
  });

  // ---------------- Coach: full suggestion detail per exercise ----------------
  app.get("/api/coach/suggestions", async (req, res) => {
    const exercisesList = await storage.getExercises();
    const exerciseMap = new Map(exercisesList.map((e) => [e.id, e]));
    const history = await buildHistory();
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

  // ---------------- Dashboard snapshot ----------------
  app.get("/api/dashboard", async (_req, res) => {
    const templates = await storage.getAllWorkoutTemplatesWithExercises();
    const exercisesList = await storage.getExercises();
    const exerciseNameLookup = new Map(exercisesList.map((e) => [e.id, e.name]));
    const { lookup, nameById } = await buildMuscleGroupLookup();
    const exercisePrimaryMuscleLookup = new Map<number, MuscleGroupName>();
    for (const e of exercisesList) {
      const name = nameById.get(e.primaryMuscleGroupId);
      if (name) exercisePrimaryMuscleLookup.set(e.id, name);
    }

    const history = (await buildHistory()).slice(0, 50);

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
    });

    res.json(snapshot);
  });

  return httpServer;
}
