import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import { insertExerciseSchema, insertWorkoutSchema, insertSetSchema, insertBodyweightLogSchema } from "@shared/schema";
import type { SetWithExercise } from "@shared/schema";
import {
  estimate1RM,
  suggestNextSession,
  categorizeVolume,
  computeWeeklyVolumeByMuscleGroup,
  detectStalledLifts,
  detectDeload,
  DEFAULT_REP_RANGE,
  type WorkingSetInput,
} from "@shared/coaching";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfWeekWindow(referenceDate: Date, weeksAgo: number): { start: Date; end: Date } {
  // Rolling 7-day windows counting back from referenceDate.
  const end = new Date(referenceDate.getTime() - weeksAgo * 7 * DAY_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  return { start, end };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // ---------------- Muscle Groups ----------------
  app.get("/api/muscle-groups", async (_req, res) => {
    const groups = await storage.getMuscleGroups();
    res.json(groups);
  });

  // ---------------- Exercises ----------------
  app.get("/api/exercises", async (_req, res) => {
    const list = await storage.getExercises();
    res.json(list);
  });

  app.post("/api/exercises", async (req, res) => {
    const parsed = insertExerciseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const created = await storage.createExercise(parsed.data);
    res.status(201).json(created);
  });

  app.get("/api/exercises/:id/sets", async (req, res) => {
    const id = Number(req.params.id);
    const list = await storage.getSetsForExercise(id);
    // chronological order oldest -> newest via workout date lookups
    const workouts = await storage.getWorkouts();
    const workoutDateMap = new Map(workouts.map((w) => [w.id, w.date]));
    const enriched = list
      .map((s) => ({ ...s, workoutDate: workoutDateMap.get(s.workoutId) ?? "" }))
      .sort((a, b) => a.workoutDate.localeCompare(b.workoutDate) || a.id - b.id);
    res.json(enriched);
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

  // ---------------- Dashboard: weekly volume per muscle group ----------------
  app.get("/api/dashboard/volume", async (req, res) => {
    const muscleGroups = await storage.getMuscleGroups();
    const exercisesList = await storage.getExercises();
    const exerciseMap = new Map(exercisesList.map((e) => [e.id, e]));
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
      secondaryMuscleGroupId: s.exercise.secondaryMuscleGroupId,
      isWarmup: s.isWarmup,
    }));

    const volumeMap = computeWeeklyVolumeByMuscleGroup(tagged);

    const result = muscleGroups.map((mg) => {
      const sets = volumeMap.get(mg.id) ?? 0;
      return {
        muscleGroupId: mg.id,
        muscleGroupName: mg.name,
        sets,
        mev: mg.mev,
        mav: mg.mav,
        mrv: mg.mrv,
        status: categorizeVolume(sets, mg),
      };
    });

    res.json(result);
  });

  // ---------------- Volume tracker: current vs last week + trend ----------------
  app.get("/api/volume-tracker", async (_req, res) => {
    const muscleGroups = await storage.getMuscleGroups();
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
        secondaryMuscleGroupId: s.exercise.secondaryMuscleGroupId,
        isWarmup: s.isWarmup,
      }));
      return computeWeeklyVolumeByMuscleGroup(tagged);
    }

    const thisWeek = volumeForWeeksBack(0);
    const lastWeek = volumeForWeeksBack(1);
    // 6-week trend, oldest -> newest
    const trendWeeks: Map<number, number>[] = [];
    for (let i = 5; i >= 0; i--) {
      trendWeeks.push(volumeForWeeksBack(i));
    }

    const result = muscleGroups.map((mg) => {
      const current = thisWeek.get(mg.id) ?? 0;
      const previous = lastWeek.get(mg.id) ?? 0;
      const trend = trendWeeks.map((w) => w.get(mg.id) ?? 0);
      return {
        muscleGroupId: mg.id,
        muscleGroupName: mg.name,
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

  // ---------------- Coach suggestions ----------------
  app.get("/api/coach/suggestions", async (_req, res) => {
    const exercisesList = await storage.getExercises();
    const workoutsList = await storage.getWorkouts();
    const workoutMap = new Map(workoutsList.map((w) => [w.id, w]));
    const allSets = await storage.getAllSets();

    const suggestions = [];

    for (const exercise of exercisesList) {
      const exerciseSets = allSets.filter((s) => s.exerciseId === exercise.id);
      if (exerciseSets.length === 0) continue;

      // group by workoutId, find most recent workout (by date) that has sets for this exercise
      const workoutIds = Array.from(new Set(exerciseSets.map((s) => s.workoutId)));
      const sortedWorkoutIds = workoutIds
        .map((id) => ({ id, date: workoutMap.get(id)?.date ?? "" }))
        .sort((a, b) => b.date.localeCompare(a.date));

      if (sortedWorkoutIds.length === 0) continue;
      const mostRecentWorkoutId = sortedWorkoutIds[0].id;
      const mostRecentSets = exerciseSets.filter((s) => s.workoutId === mostRecentWorkoutId);

      const workingSets: WorkingSetInput[] = mostRecentSets.map((s) => ({
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
        isWarmup: s.isWarmup,
      }));

      const suggestion = suggestNextSession(workingSets, DEFAULT_REP_RANGE);
      if (!suggestion) continue;

      suggestions.push({
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        lastSessionDate: sortedWorkoutIds[0].date,
        ...suggestion,
      });
    }

    // sort by most recently trained
    suggestions.sort((a, b) => b.lastSessionDate.localeCompare(a.lastSessionDate));

    res.json(suggestions);
  });

  // ---------------- Deload detection ----------------
  app.get("/api/coach/deload", async (_req, res) => {
    const exercisesList = await storage.getExercises();
    const muscleGroupsList = await storage.getMuscleGroups();
    const workoutsList = await storage.getWorkouts();
    const workoutMap = new Map(workoutsList.map((w) => [w.id, w]));
    const allSets = await storage.getAllSets();

    // Build per-exercise chronological e1RM session history (top set per session)
    const sessionsByExercise = new Map<number, { name: string; e1RMs: number[] }>();

    for (const exercise of exercisesList) {
      const exerciseSets = allSets.filter((s) => s.exerciseId === exercise.id && !s.isWarmup);
      if (exerciseSets.length === 0) continue;

      const byWorkout = new Map<number, SetWithExercise[]>();
      for (const s of exerciseSets) {
        if (!byWorkout.has(s.workoutId)) byWorkout.set(s.workoutId, []);
        byWorkout.get(s.workoutId)!.push(s);
      }

      const sessionEntries = Array.from(byWorkout.entries())
        .map(([workoutId, setsInWorkout]) => {
          const date = workoutMap.get(workoutId)?.date ?? "";
          const topE1RM = Math.max(...setsInWorkout.map((s) => estimate1RM(s.weight, s.reps)));
          return { date, topE1RM };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      if (sessionEntries.length >= 4) {
        sessionsByExercise.set(exercise.id, {
          name: exercise.name,
          e1RMs: sessionEntries.map((s) => s.topE1RM),
        });
      }
    }

    const stalledLifts = detectStalledLifts(sessionsByExercise);

    // Per muscle group: avg RPE last 2 weeks + weekly volume history (6 weeks)
    const now = new Date();
    const muscleGroupInputs = muscleGroupsList.map((mg) => {
      // RPE: sets on exercises where this mg is primary, within last 14 days, non-warmup, rpe not null
      const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
      const relevantExerciseIds = new Set(
        exercisesList.filter((e) => e.primaryMuscleGroupId === mg.id).map((e) => e.id),
      );
      const rpeSets = allSets.filter((s) => {
        if (s.isWarmup || s.rpe == null) return false;
        if (!relevantExerciseIds.has(s.exerciseId)) return false;
        const w = workoutMap.get(s.workoutId);
        if (!w) return false;
        const d = new Date(w.date);
        return d >= twoWeeksAgo && d <= now;
      });
      const avgRpe =
        rpeSets.length > 0 ? rpeSets.reduce((sum, s) => sum + (s.rpe ?? 0), 0) / rpeSets.length : null;

      // Volume: 6-week trend
      const weeklyVolumes: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const { start, end } = startOfWeekWindow(now, i);
        const inWindow = allSets.filter((s) => {
          const w = workoutMap.get(s.workoutId);
          if (!w) return false;
          const d = new Date(w.date);
          return d >= start && d < end;
        });
        const tagged = inWindow.map((s) => ({
          primaryMuscleGroupId: s.exercise.primaryMuscleGroupId,
          secondaryMuscleGroupId: s.exercise.secondaryMuscleGroupId,
          isWarmup: s.isWarmup,
        }));
        const vol = computeWeeklyVolumeByMuscleGroup(tagged).get(mg.id) ?? 0;
        weeklyVolumes.push(vol);
      }

      return {
        muscleGroupId: mg.id,
        muscleGroupName: mg.name,
        avgRpeLastTwoWeeks: avgRpe,
        weeklyVolumes,
        mrv: mg.mrv,
      };
    });

    const result = detectDeload(stalledLifts, muscleGroupInputs);
    res.json(result);
  });

  return httpServer;
}
