import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronRight,
  Clock,
  Dumbbell,
  Gauge,
  History,
  Minus,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useRestTimer } from "@/lib/rest-timer-context";
import { useToast } from "@/hooks/use-toast";
import { todayIso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DashboardSnapshot, WorkoutExerciseSuggestion } from "@shared/coaching";
import { resolveWorkingSetCount } from "@shared/coaching";
import type { ExerciseView, Set as LoggedSet, Workout } from "@shared/schema";
import {
  buildGuidedSessionPlan,
  estimateGuidedSessionMinutes,
  evaluateGuidedSetAdjustment,
  type GuidedPlanExercise,
  type GuidedSessionPlan,
  type GuidedSetAdjustment,
  type GuidedTimeStrategy,
} from "@shared/guided-workout";

interface TemplateExercise {
  id: number;
  exerciseId: number;
  exerciseOrder: number;
  exerciseRole: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationMinSeconds: number | null;
  targetDurationMaxSeconds: number | null;
  targetRir: number;
  warmupSets: number;
  topSets: number;
  backoffSets: number;
  restSeconds: number;
  failureTarget: string;
}

interface WorkoutTemplate {
  id: number;
  name: string;
  notes: string | null;
  exercises: TemplateExercise[];
}

interface CoachSuggestion extends WorkoutExerciseSuggestion {
  exerciseId: number;
}

interface GuidedLoggedSet extends LoggedSet {
  exercise: ExerciseView;
}

type GuidedWorkoutRecord = Omit<Workout, "sessionPlan"> & {
  sessionPlan: GuidedSessionPlan | null;
  sets: GuidedLoggedSet[];
};

const BUDGETS: Array<{ value: string; label: string }> = [
  { value: "full", label: "Full plan" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "60 min" },
];

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function createRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `guided-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function completedSetsFor(session: GuidedWorkoutRecord, exerciseId: number): GuidedLoggedSet[] {
  return session.sets
    .filter((set) => set.exerciseId === exerciseId)
    .sort((a, b) => a.setNumber - b.setNumber || a.id - b.id);
}

function nextExerciseFor(session: GuidedWorkoutRecord): GuidedPlanExercise | undefined {
  const plan = session.sessionPlan;
  if (!plan) return undefined;
  const pending = plan.exercises.filter((exercise) => {
    if (exercise.skipped) return false;
    return completedSetsFor(session, exercise.exerciseId).length < exercise.warmupSets + exercise.workingSets;
  });
  if (pending.length === 0) return undefined;
  const lastSet = [...session.sets].sort((a, b) => b.id - a.id)[0];
  const lastPlanExercise = lastSet ? plan.exercises.find((exercise) => exercise.exerciseId === lastSet.exerciseId) : undefined;
  if (plan.timeStrategy === "smart_pairs" && lastPlanExercise?.pairGroup != null) {
    const partner = pending.find(
      (exercise) => exercise.pairGroup === lastPlanExercise.pairGroup && exercise.exerciseId !== lastPlanExercise.exerciseId,
    );
    if (partner) return partner;
  }
  return pending[0];
}

function totalPlannedSets(plan: GuidedSessionPlan): number {
  return plan.exercises.reduce(
    (sum, exercise) => sum + (exercise.skipped ? 0 : exercise.warmupSets + exercise.workingSets),
    0,
  );
}

function PlanPreview({ plan }: { plan: GuidedSessionPlan }) {
  const adjustedSets = plan.exercises.reduce(
    (sum, exercise) => sum + Math.max(0, exercise.templateWorkingSets - exercise.workingSets),
    0,
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border p-3 text-center">
          <Clock className="mx-auto h-4 w-4 text-muted-foreground" />
          <p className="mt-1 text-lg font-semibold tabular-nums">{plan.estimatedMinutes}</p>
          <p className="text-[11px] text-muted-foreground">minutes</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <Dumbbell className="mx-auto h-4 w-4 text-muted-foreground" />
          <p className="mt-1 text-lg font-semibold tabular-nums">{totalPlannedSets(plan)}</p>
          <p className="text-[11px] text-muted-foreground">total sets</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <Activity className="mx-auto h-4 w-4 text-muted-foreground" />
          <p className="mt-1 text-lg font-semibold tabular-nums">{plan.exercises.length}</p>
          <p className="text-[11px] text-muted-foreground">exercises</p>
        </div>
      </div>
      {adjustedSets > 0 && (
        <p className="text-xs text-muted-foreground">
          {adjustedSets} lower-priority working {adjustedSets === 1 ? "set was" : "sets were"} trimmed to fit this budget.
        </p>
      )}
      <div className="divide-y rounded-md border">
        {plan.exercises.map((exercise) => (
          <div key={exercise.exerciseId} className="flex items-start gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-medium text-sm">{exercise.exerciseName}</p>
                {exercise.pairGroup != null && <Badge variant="outline" className="text-[10px]">Pair {exercise.pairGroup}</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {exercise.warmupSets > 0 ? `${exercise.warmupSets} warm-up + ` : ""}
                {exercise.workingSets} working · {exercise.trackingMode === "duration"
                  ? `${exercise.targetDurationMinSeconds}-${exercise.targetDurationMaxSeconds} sec`
                  : `${exercise.targetRepsMin}-${exercise.targetRepsMax} reps`} · {exercise.restSeconds}s rest
              </p>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{exercise.recommendationReason}</p>
            </div>
            <Badge
              variant="outline"
              className={exercise.fatiguePercent >= 70 ? "border-destructive/60 text-destructive" : exercise.fatiguePercent >= 55 ? "border-volume-high/60 text-volume-high" : "border-volume-optimal/60 text-volume-optimal"}
            >
              {exercise.recoveryPercent}% ready
            </Badge>
          </div>
        ))}
      </div>
      {plan.warnings.map((warning) => (
        <div key={warning} className="flex items-start gap-2 rounded-md border border-volume-high/40 bg-volume-high/5 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-volume-high" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

export default function GuidedWorkout() {
  const { activeUserId, activeUser } = useActiveUser();
  const { toast } = useToast();
  const restTimer = useRestTimer();
  const [location] = useLocation();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [budget, setBudget] = useState("full");
  const [timeStrategy, setTimeStrategy] = useState<GuidedTimeStrategy>("standard");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [rir, setRir] = useState("");
  const [adjustment, setAdjustment] = useState<GuidedSetAdjustment | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [finishedSession, setFinishedSession] = useState<GuidedWorkoutRecord | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());

  const { data: templates, isLoading: templatesLoading } = useQuery<WorkoutTemplate[]>({
    queryKey: ["/api/workout-templates", activeUserId],
    queryFn: async () => (await apiRequest("GET", "/api/workout-templates")).json(),
    enabled: activeUserId != null,
  });
  const { data: exercises } = useQuery<ExerciseView[]>({ queryKey: ["/api/exercises"] });
  const { data: dashboard } = useQuery<DashboardSnapshot>({
    queryKey: ["/api/dashboard", activeUserId, activeUser?.trainingGoal, activeUser?.trainingLevel],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard")).json(),
    enabled: activeUserId != null,
  });
  const { data: activeSession, isLoading: activeLoading } = useQuery<GuidedWorkoutRecord | null>({
    queryKey: ["/api/workout-sessions/active", activeUserId],
    queryFn: async () => (await apiRequest("GET", "/api/workout-sessions/active")).json(),
    enabled: activeUserId != null,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (selectedTemplateId != null || !templates?.length) return;
    const hashQuery = window.location.hash.includes("?") ? window.location.hash.slice(window.location.hash.indexOf("?")) : "";
    const params = new URLSearchParams(window.location.search || hashQuery);
    const requested = Number(params.get("template"));
    const preferred = templates.find((template) => template.id === requested)?.id
      ?? templates.find((template) => template.id === dashboard?.todayWorkoutTemplateId)?.id
      ?? templates[0].id;
    setSelectedTemplateId(preferred);
  }, [templates, dashboard?.todayWorkoutTemplateId, selectedTemplateId, location]);

  const selectedTemplate = templates?.find((template) => template.id === selectedTemplateId);
  const suggestionUrl = selectedTemplateId == null ? null : `/api/coach/suggestions?templateId=${selectedTemplateId}`;
  const { data: suggestions, isLoading: suggestionsLoading } = useQuery<CoachSuggestion[]>({
    queryKey: ["/api/coach/suggestions", "guided", selectedTemplateId, activeUserId, activeUser?.trainingGoal, activeUser?.trainingLevel],
    queryFn: async () => (await apiRequest("GET", suggestionUrl!)).json(),
    enabled: suggestionUrl != null && activeSession == null,
    staleTime: 60_000,
  });

  const plan = useMemo(() => {
    if (!selectedTemplate || !exercises || !suggestions) return null;
    const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
    const suggestionById = new Map(suggestions.map((suggestion) => [suggestion.exerciseId, suggestion]));
    const rows = selectedTemplate.exercises.flatMap((templateExercise) => {
      const exercise = exerciseById.get(templateExercise.exerciseId);
      if (!exercise) return [];
      const coach = suggestionById.get(exercise.id);
      const templateWorkingSets = resolveWorkingSetCount(templateExercise);
      return [{
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        exerciseOrder: templateExercise.exerciseOrder,
        exerciseRole: templateExercise.exerciseRole,
        trackingMode: exercise.trackingMode === "duration" ? "duration" as const : "reps" as const,
        equipment: exercise.equipment,
        isCompound: exercise.isCompound,
        primaryMuscleGroupId: exercise.primaryMuscleGroupId,
        warmupSets: templateExercise.warmupSets,
        workingSets: Math.max(1, coach?.recommendedWorkingSets ?? templateWorkingSets),
        templateWorkingSets,
        targetWeight: Math.max(0, coach?.suggestedWeight ?? 0),
        targetRepsMin: coach?.targetRepsMin ?? templateExercise.targetRepsMin,
        targetRepsMax: coach?.targetRepsMax ?? templateExercise.targetRepsMax,
        targetDurationMinSeconds: coach?.targetDurationMinSeconds ?? templateExercise.targetDurationMinSeconds ?? 20,
        targetDurationMaxSeconds: coach?.targetDurationMaxSeconds ?? templateExercise.targetDurationMaxSeconds ?? 60,
        targetRirMin: coach?.targetRirMin ?? Math.max(0, templateExercise.targetRir - 1),
        targetRirMax: coach?.targetRirMax ?? templateExercise.targetRir + 1,
        restSeconds: coach?.recommendedRestSeconds ?? templateExercise.restSeconds,
        recommendation: coach?.recommendation ?? "Start Conservative",
        recommendationReason: coach?.plainLanguageReason ?? coach?.reason ?? "Use the template target and adjust from today's performance.",
        recoveryPercent: coach?.recoveryPercent ?? 100,
        fatiguePercent: coach?.fatiguePercent ?? 0,
      }];
    });
    if (rows.length === 0) return null;
    return buildGuidedSessionPlan({
      workoutTemplateId: selectedTemplate.id,
      workoutName: selectedTemplate.name,
      exercises: rows,
      timeBudgetMinutes: budget === "full" ? null : Number(budget),
      timeStrategy,
    });
  }, [selectedTemplate, exercises, suggestions, budget, timeStrategy]);

  const startMutation = useMutation({
    mutationFn: async (value: GuidedSessionPlan) => {
      const response = await apiRequest("POST", "/api/workout-sessions", {
        date: todayIso(),
        workoutTemplateId: value.workoutTemplateId,
        name: value.workoutName,
        timeBudgetMinutes: value.timeBudgetMinutes,
        sessionPlan: value,
      });
      return response.json() as Promise<GuidedWorkoutRecord>;
    },
    onSuccess: (session) => {
      queryClient.setQueryData(["/api/workout-sessions/active", activeUserId], session);
      toast({ title: `${session.name} started`, description: "Every completed set is saved automatically." });
    },
    onError: (error: Error) => toast({ title: "Couldn't start workout", description: error.message, variant: "destructive" }),
  });

  const session = activeSession;
  const activeExercise = session ? nextExerciseFor(session) : undefined;
  const activeCompletedSets = session && activeExercise ? completedSetsFor(session, activeExercise.exerciseId) : [];
  const nextSetIndex = activeCompletedSets.length;
  const nextIsWarmup = activeExercise ? nextSetIndex < activeExercise.warmupSets : false;

  useEffect(() => {
    if (!activeExercise) return;
    const last = activeCompletedSets.at(-1);
    setWeight(String(last?.weight ?? activeExercise.targetWeight ?? 0));
    setReps("");
    setDurationSeconds("");
    setRir("");
  }, [activeExercise?.exerciseId, nextSetIndex]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.id]);

  const logSetMutation = useMutation({
    mutationFn: async () => {
      if (!session || !activeExercise) throw new Error("No active exercise");
      const priorWorking = [...activeCompletedSets].reverse().find((set) => !set.isWarmup);
      const currentPerformance = {
        weight: Number(weight),
        reps: activeExercise.trackingMode === "duration" ? 0 : Number(reps),
        rir: rir === "" ? null : Number(rir),
        isWarmup: nextIsWarmup,
      };
      const exerciseDetails = exercises?.find((exercise) => exercise.id === activeExercise.exerciseId);
      const nextAdjustment = evaluateGuidedSetAdjustment({
        exercise: activeExercise,
        current: currentPerformance,
        previousWorkingSet: priorWorking ? {
          weight: priorWorking.weight,
          reps: priorWorking.reps,
          rir: priorWorking.rir,
          isWarmup: priorWorking.isWarmup,
        } : undefined,
        weightIncrement: exerciseDetails?.equipmentSettings.weightIncrement,
      });
      const response = await apiRequest("POST", "/api/sets", {
        workoutId: session.id,
        exerciseId: activeExercise.exerciseId,
        setNumber: activeCompletedSets.length + 1,
        weight: Number(weight),
        reps: activeExercise.trackingMode === "duration" ? 0 : Number(reps),
        durationSeconds: activeExercise.trackingMode === "duration" ? Number(durationSeconds) : null,
        rir: rir === "" ? null : Number(rir),
        isWarmup: nextIsWarmup,
        clientRequestId: createRequestId(),
      });
      return { created: await response.json(), nextAdjustment };
    },
    onSuccess: async ({ created, nextAdjustment }) => {
      setAdjustment(nextAdjustment);
      const refreshed = await queryClient.fetchQuery<GuidedWorkoutRecord | null>({
        queryKey: ["/api/workout-sessions/active", activeUserId],
        queryFn: async () => (await apiRequest("GET", "/api/workout-sessions/active")).json(),
      });
      const remaining = refreshed?.sessionPlan
        ? totalPlannedSets(refreshed.sessionPlan) - refreshed.sets.length
        : 0;
      if (!nextIsWarmup && remaining > 0 && activeExercise) {
        restTimer.startFocused(nextAdjustment.nextRestSeconds, activeExercise.exerciseName);
      }
      if (created.pr?.isPr) {
        toast({ title: `New PR! ${activeExercise?.exerciseName}`, description: `${created.pr.recordType}: ${created.pr.displayValue}` });
      }
    },
    onError: (error: Error) => toast({ title: "Couldn't log set", description: error.message, variant: "destructive" }),
  });

  const planMutation = useMutation({
    mutationFn: async (nextPlan: GuidedSessionPlan) => {
      if (!session) throw new Error("No active workout");
      const response = await apiRequest("PATCH", `/api/workout-sessions/${session.id}/plan`, { sessionPlan: nextPlan });
      return response.json() as Promise<GuidedWorkoutRecord>;
    },
    onSuccess: (updated) => queryClient.setQueryData(["/api/workout-sessions/active", activeUserId], updated),
    onError: (error: Error) => toast({ title: "Couldn't update plan", description: error.message, variant: "destructive" }),
  });

  const updateActiveExercise = (update: (exercise: GuidedPlanExercise) => GuidedPlanExercise) => {
    if (!session?.sessionPlan || !activeExercise) return;
    const exercises = session.sessionPlan.exercises.map((exercise) =>
      exercise.exerciseId === activeExercise.exerciseId ? update(exercise) : exercise,
    );
    const nextPlan = {
      ...session.sessionPlan,
      exercises,
      estimatedMinutes: estimateGuidedSessionMinutes(exercises, session.sessionPlan.timeStrategy),
    };
    planMutation.mutate(nextPlan);
  };

  const finishMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("No active workout");
      const response = await apiRequest("POST", `/api/workout-sessions/${session.id}/complete`);
      return response.json() as Promise<GuidedWorkoutRecord>;
    },
    onSuccess: (completed) => {
      setFinishedSession(completed);
      setFinishOpen(false);
      queryClient.setQueryData(["/api/workout-sessions/active", activeUserId], null);
      for (const key of ["/api/workouts", "/api/dashboard", "/api/recovery", "/api/volume-tracker", "/api/coach/suggestions", "/api/schedule"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast({ title: "Workout complete", description: `${completed.sets.length} sets saved.` });
    },
    onError: (error: Error) => toast({ title: "Couldn't finish workout", description: error.message, variant: "destructive" }),
  });

  const discardMutation = useMutation({
    mutationFn: async () => {
      if (!session) return;
      await apiRequest("DELETE", `/api/workout-sessions/${session.id}`);
    },
    onSuccess: () => {
      setDiscardOpen(false);
      setAdjustment(null);
      queryClient.setQueryData(["/api/workout-sessions/active", activeUserId], null);
      toast({ title: "Workout discarded" });
    },
  });

  const undoLastSet = async () => {
    if (!session?.sets.length) return;
    const latest = [...session.sets].sort((a, b) => b.id - a.id)[0];
    await apiRequest("DELETE", `/api/sets/${latest.id}`);
    await queryClient.invalidateQueries({ queryKey: ["/api/workout-sessions/active", activeUserId] });
    setAdjustment(null);
    toast({ title: "Last set removed" });
  };

  if (finishedSession) {
    const elapsed = finishedSession.completedAt && finishedSession.startedAt
      ? Math.max(0, Math.round((new Date(finishedSession.completedAt).getTime() - new Date(finishedSession.startedAt).getTime()) / 1000))
      : 0;
    const workingSets = finishedSession.sets.filter((set) => !set.isWarmup).length;
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24 md:p-6">
        <div className="text-center space-y-2 py-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary"><Check className="h-7 w-7" /></div>
          <h1 className="text-2xl font-display font-bold">Workout complete</h1>
          <p className="text-muted-foreground">{finishedSession.name}</p>
        </div>
        <Card>
          <CardContent className="grid grid-cols-3 gap-3 p-4 text-center">
            <div><p className="text-xl font-semibold tabular-nums">{workingSets}</p><p className="text-xs text-muted-foreground">working sets</p></div>
            <div><p className="text-xl font-semibold tabular-nums">{finishedSession.sets.length}</p><p className="text-xs text-muted-foreground">total sets</p></div>
            <div><p className="text-xl font-semibold tabular-nums">{formatElapsed(elapsed)}</p><p className="text-xs text-muted-foreground">elapsed</p></div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setFinishedSession(null)}>Start another</Button>
          <Link href="/history"><Button className="w-full">Workout history</Button></Link>
        </div>
      </div>
    );
  }

  if (activeLoading || templatesLoading) {
    return <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6"><Skeleton className="h-12 w-64" /><Skeleton className="h-48 w-full" /><Skeleton className="h-80 w-full" /></div>;
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-4 pb-24 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><h1 className="text-xl font-display font-bold">Guided Workout</h1></div>
            <p className="text-sm text-muted-foreground">Fit quality training to your recovery and available time</p>
          </div>
          <Link href="/log?logger=classic"><Button variant="outline" size="sm">Use Classic</Button></Link>
        </div>

        {!templates?.length ? (
          <Card><CardContent className="space-y-3 p-6 text-center"><p className="font-medium">Create a workout template to use Guided mode.</p><p className="text-sm text-muted-foreground">Guided mode uses template prescriptions as a safe baseline. Classic remains available for free-form logging.</p><div className="flex justify-center gap-2"><Link href="/templates"><Button>Create template</Button></Link><Link href="/log?logger=classic"><Button variant="outline">Use Classic</Button></Link></div></CardContent></Card>
        ) : (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base">1. Choose today&apos;s session</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Workout template</Label>
                  <Select value={selectedTemplateId == null ? undefined : String(selectedTemplateId)} onValueChange={(value) => setSelectedTemplateId(Number(value))}>
                    <SelectTrigger data-testid="select-guided-template"><SelectValue placeholder="Choose a template" /></SelectTrigger>
                    <SelectContent>{templates.map((template) => <SelectItem key={template.id} value={String(template.id)}>{template.name}</SelectItem>)}</SelectContent>
                  </Select>
                  {selectedTemplate?.notes && <p className="text-xs text-muted-foreground">{selectedTemplate.notes}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Available time</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {BUDGETS.map((item) => <Button key={item.value} type="button" size="sm" variant={budget === item.value ? "default" : "outline"} onClick={() => setBudget(item.value)}>{item.label}</Button>)}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Session pace</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={timeStrategy === "standard" ? "default" : "outline"} onClick={() => setTimeStrategy("standard")}><Clock className="h-4 w-4" />Standard</Button>
                    <Button type="button" variant={timeStrategy === "smart_pairs" ? "default" : "outline"} onClick={() => setTimeStrategy("smart_pairs")}><ArrowLeftRight className="h-4 w-4" />Smart pairs</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Smart pairs only alternate adjacent, non-competing accessory exercises. Compounds keep full recovery.</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">2. Review the adjusted plan</CardTitle></CardHeader>
              <CardContent>
                {suggestionsLoading || !plan ? <Skeleton className="h-72 w-full" /> : <PlanPreview plan={plan} />}
              </CardContent>
            </Card>
            <Button className="w-full" size="lg" disabled={!plan || suggestionsLoading || startMutation.isPending} onClick={() => plan && startMutation.mutate(plan)} data-testid="button-start-guided-workout">
              <Play className="h-4 w-4" />{startMutation.isPending ? "Starting…" : "Start Guided Workout"}
            </Button>
          </>
        )}
      </div>
    );
  }

  if (!session.sessionPlan) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-xl font-bold">This Guided plan could not be restored.</h1>
        <p className="text-sm text-muted-foreground">Your logged sets are still saved. Finish the partial workout or discard it and start again.</p>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={() => setDiscardOpen(true)}>Discard</Button>
          {session.sets.length > 0 && <Button onClick={() => setFinishOpen(true)}>Finish partial</Button>}
        </div>
        <AlertDialog open={finishOpen} onOpenChange={setFinishOpen}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Finish this partial workout?</AlertDialogTitle><AlertDialogDescription>This keeps the {session.sets.length} saved sets and marks the session complete.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={finishMutation.isPending} onClick={() => finishMutation.mutate()}>Finish Workout</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard this workout?</AlertDialogTitle><AlertDialogDescription>This deletes the in-progress workout and all {session.sets.length} saved sets. It cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={discardMutation.isPending} onClick={() => discardMutation.mutate()}>Discard Workout</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  const planSetTotal = totalPlannedSets(session.sessionPlan);
  const completedCount = session.sets.length;
  const progress = planSetTotal > 0 ? Math.min(100, Math.round((completedCount / planSetTotal) * 100)) : 0;
  const startedAtMs = session.startedAt ? new Date(session.startedAt).getTime() : clockNow;
  const elapsedSeconds = Math.max(0, Math.round((clockNow - startedAtMs) / 1000));
  const currentExerciseDetails = exercises?.find((exercise) => exercise.id === activeExercise?.exerciseId);
  const canLog = activeExercise && weight !== "" && (activeExercise.trackingMode === "duration" ? Number(durationSeconds) > 0 : Number(reps) > 0);
  const activeWorkingCompleted = activeCompletedSets.filter((set) => !set.isWarmup).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-32 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-display font-bold">{session.name}</h1><Badge variant="secondary">Autosaved</Badge></div>
          <p className="text-sm text-muted-foreground">{formatElapsed(elapsedSeconds)} elapsed · {session.sessionPlan.estimatedMinutes} min planned</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Discard workout" onClick={() => setDiscardOpen(true)}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="space-y-1.5"><div className="flex justify-between text-xs text-muted-foreground"><span>{completedCount} of {planSetTotal} sets</span><span>{progress}%</span></div><Progress value={progress} /></div>

      {!activeExercise ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-4 p-6 text-center"><Check className="mx-auto h-10 w-10 text-primary" /><div><p className="font-semibold">Planned work complete</p><p className="text-sm text-muted-foreground">Review the session and finish when you&apos;re ready.</p></div><Button size="lg" onClick={() => setFinishOpen(true)}>Finish Workout</Button></CardContent>
        </Card>
      ) : (
        <>
          {activeExercise.pairGroup != null && (
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs"><ArrowLeftRight className="h-4 w-4 text-primary" /><span>Smart pair {activeExercise.pairGroup}: alternate with the paired accessory while each muscle rests.</span></div>
          )}
          <Card className="border-primary/30">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Up next</p><CardTitle className="mt-1 text-xl">{activeExercise.exerciseName}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{activeExercise.exerciseRole} · {currentExerciseDetails?.equipmentSettings.name ?? activeExercise.equipment}</p></div>
                <Badge variant={nextIsWarmup ? "secondary" : "default"}>{nextIsWarmup ? `Warm-up ${nextSetIndex + 1}/${activeExercise.warmupSets}` : `Working ${activeWorkingCompleted + 1}/${activeExercise.workingSets}`}</Badge>
              </div>
              <div className="rounded-md bg-muted/60 p-3">
                <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><p className="text-sm font-medium">{activeExercise.recommendation}</p></div>
                <p className="mt-1 text-xs text-muted-foreground">{activeExercise.recommendationReason}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{activeExercise.trackingMode === "duration" ? `${activeExercise.targetDurationMinSeconds}-${activeExercise.targetDurationMaxSeconds}s` : `${activeExercise.targetRepsMin}-${activeExercise.targetRepsMax} reps`}</Badge>
                  {!nextIsWarmup && <Badge variant="outline">RIR {activeExercise.targetRirMin}-{activeExercise.targetRirMax}</Badge>}
                  <Badge variant="outline">{activeExercise.restSeconds}s rest</Badge>
                  <Badge variant="outline">{activeExercise.recoveryPercent}% ready</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="guided-weight">{activeExercise.equipment === "Bodyweight" ? "Added weight" : "Weight"}</Label><Input id="guided-weight" type="number" inputMode="decimal" min={currentExerciseDetails?.equipmentSettings.minWeight ?? 0} max={currentExerciseDetails?.equipmentSettings.maxWeight} step={currentExerciseDetails?.equipmentSettings.weightIncrement ?? 5} value={weight} onChange={(event) => setWeight(event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="guided-performance">{activeExercise.trackingMode === "duration" ? "Seconds" : "Reps"}</Label><Input id="guided-performance" autoFocus type="number" inputMode="numeric" min={1} placeholder={activeExercise.trackingMode === "duration" ? String(activeExercise.targetDurationMinSeconds ?? "") : `${activeExercise.targetRepsMin}-${activeExercise.targetRepsMax}`} value={activeExercise.trackingMode === "duration" ? durationSeconds : reps} onChange={(event) => activeExercise.trackingMode === "duration" ? setDurationSeconds(event.target.value) : setReps(event.target.value)} /></div>
              </div>
              {!nextIsWarmup && (
                <div className="space-y-2"><div className="flex items-center justify-between"><Label>How many good reps were left?</Label><span className="text-xs text-muted-foreground">RIR</span></div><div className="grid grid-cols-6 gap-2">{[0, 1, 2, 3, 4, 5].map((value) => <Button key={value} type="button" variant={rir === String(value) ? "default" : "outline"} className="px-0" onClick={() => setRir(String(value))}>{value}</Button>)}</div></div>
              )}
              <Button size="lg" className="w-full" disabled={!canLog || logSetMutation.isPending} onClick={() => logSetMutation.mutate()} data-testid="button-log-guided-set"><Check className="h-4 w-4" />{logSetMutation.isPending ? "Saving…" : "Complete Set"}</Button>
            </CardContent>
          </Card>

          {adjustment && (
            <Card className={adjustment.status === "consider_stopping" || adjustment.status === "reduce_load" ? "border-volume-high/60" : "border-primary/30"}>
              <CardContent className="space-y-3 p-4"><div className="flex items-start gap-3"><Gauge className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="font-medium text-sm">Set response</p><p className="text-sm text-muted-foreground">{adjustment.message}</p></div></div>{adjustment.suggestTrimRemainingSet && activeExercise.workingSets > activeWorkingCompleted && <Button size="sm" variant="outline" onClick={() => updateActiveExercise((exercise) => ({ ...exercise, workingSets: Math.max(1, activeWorkingCompleted) }))}><Minus className="h-3.5 w-3.5" />Trim remaining set</Button>}</CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-wrap gap-2 p-3">
              <Button size="sm" variant="ghost" disabled={session.sets.length === 0} onClick={undoLastSet}><RotateCcw className="h-3.5 w-3.5" />Undo last set</Button>
              <Button size="sm" variant="ghost" onClick={() => updateActiveExercise((exercise) => ({ ...exercise, workingSets: exercise.workingSets + 1 }))}><Plus className="h-3.5 w-3.5" />Add set</Button>
              <Button size="sm" variant="ghost" onClick={() => updateActiveExercise((exercise) => ({ ...exercise, skipped: true }))}><ChevronRight className="h-3.5 w-3.5" />Skip exercise</Button>
              <Button size="sm" variant="ghost" className="ml-auto" disabled={session.sets.length === 0} onClick={() => setFinishOpen(true)}><Square className="h-3.5 w-3.5" />Finish early</Button>
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={finishOpen} onOpenChange={setFinishOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Finish {session.name}?</AlertDialogTitle><AlertDialogDescription>This completes the session with {session.sets.length} logged sets and updates recovery, volume, history, and your schedule.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep training</AlertDialogCancel><AlertDialogAction disabled={finishMutation.isPending || session.sets.length === 0} onClick={() => finishMutation.mutate()}>{finishMutation.isPending ? "Finishing…" : "Finish Workout"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard this workout?</AlertDialogTitle><AlertDialogDescription>This deletes the in-progress workout and all {session.sets.length} saved sets. It cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={discardMutation.isPending} onClick={() => discardMutation.mutate()}>Discard Workout</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
