import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Trash2, X, ClipboardList, Trophy, Flame, TimerIcon } from "lucide-react";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useRestTimer } from "@/lib/rest-timer-context";
import { WarmupCalculator } from "@/components/warmup-calculator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDate, todayIso } from "@/lib/format";
import type {
  ExerciseView,
  MuscleGroup,
  Equipment,
} from "@shared/schema";
import { equipmentTypes } from "@shared/schema";

type Exercise = ExerciseView;
type MuscleGroupView = MuscleGroup & { displayName: string };

interface WorkoutTemplateExerciseLite {
  id: number;
  exerciseId: number;
  exerciseOrder: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRir: number;
  warmupSets: number;
  topSets: number;
  backoffSets: number;
  restSeconds: number;
  failureTarget: string;
}

interface WorkoutTemplateLite {
  id: number;
  name: string;
  notes: string | null;
  exercises: WorkoutTemplateExerciseLite[];
}

interface DraftSet {
  key: string;
  weight: string;
  reps: string;
  rir: string;
  isWarmup: boolean;
  /** Set once this set has been individually logged via the "Log set" button. */
  loggedSetId?: number;
}

interface DraftExercise {
  key: string;
  exercise: Exercise;
  sets: DraftSet[];
  prescription?: WorkoutTemplateExerciseLite;
}

function newSet(): DraftSet {
  return {
    key: Math.random().toString(36).slice(2),
    weight: "",
    reps: "",
    rir: "",
    isWarmup: false,
  };
}

interface HistorySet {
  id: number;
  workoutId: number;
  weight: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  workoutDate: string;
  isPr?: boolean;
}

function ExerciseHistory({ exerciseId }: { exerciseId: number }) {
  const { activeUserId } = useActiveUser();
  const { data, isLoading } = useQuery<HistorySet[]>({
    queryKey: ["/api/exercises", String(exerciseId), "sets", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/exercises/${exerciseId}/sets`);
      return res.json();
    },
    enabled: activeUserId != null,
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data || data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="text-no-history">
        No previous sessions for this exercise yet.
      </p>
    );
  }

  // Group by workoutId, take last 3 sessions (most recent first)
  const byWorkout = new Map<number, HistorySet[]>();
  for (const s of data) {
    if (!byWorkout.has(s.workoutId)) byWorkout.set(s.workoutId, []);
    byWorkout.get(s.workoutId)!.push(s);
  }
  const sessions = Array.from(byWorkout.entries())
    .sort((a, b) => (b[1][0]?.workoutDate ?? "").localeCompare(a[1][0]?.workoutDate ?? ""))
    .slice(0, 3);

  return (
    <div className="space-y-2" data-testid="section-exercise-history">
      <p className="text-xs font-medium text-muted-foreground">Last 3 sessions</p>
      {sessions.map(([workoutId, sets]) => (
        <div key={workoutId} className="flex items-start justify-between gap-2 text-xs">
          <span className="text-muted-foreground shrink-0">{formatDate(sets[0].workoutDate)}</span>
          <div className="flex flex-wrap justify-end gap-1">
            {sets
              .filter((s) => !s.isWarmup)
              .map((s) => (
                <span
                  key={s.id}
                  className={cn(
                    "tabular-nums font-mono rounded px-1.5 py-0.5 inline-flex items-center gap-1",
                    s.isPr ? "bg-primary/15 text-primary font-semibold" : "bg-muted",
                  )}
                  data-testid={`text-history-set-${s.id}`}
                >
                  {s.isPr && <Trophy className="h-3 w-3" data-testid={`icon-pr-badge-${s.id}`} />}
                  {s.weight}×{s.reps}
                  {s.rir != null ? ` @${s.rir}RIR` : ""}
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExercisePicker({
  exercises,
  onSelect,
  onCreateNew,
}: {
  exercises: Exercise[];
  onSelect: (ex: Exercise) => void;
  onCreateNew: (initialName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sortedExercises = useMemo(
    () =>
      [...exercises].sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id - b.id,
      ),
    [exercises],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between"
          data-testid="button-exercise-picker"
        >
          Add exercise…
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search exercises…"
            value={search}
            onValueChange={setSearch}
            data-testid="input-exercise-search"
          />
          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 py-2">
                <p className="text-sm text-muted-foreground">No exercise found.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="button-create-exercise"
                  onClick={() => {
                    setOpen(false);
                    onCreateNew(search);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create "{search}"
                </Button>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {sortedExercises.map((ex) => (
                <CommandItem
                  key={ex.id}
                  value={ex.name}
                  data-testid={`option-exercise-${ex.id}`}
                  onSelect={() => {
                    onSelect(ex);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  {ex.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CreateExerciseDialog({
  open,
  onOpenChange,
  muscleGroups,
  onCreated,
  initialName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  muscleGroups: MuscleGroupView[];
  onCreated: (ex: Exercise) => void;
  initialName: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [stimulus, setStimulus] = useState<{ muscleGroupId: string; stimulusRatio: string }[]>([]);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setStimulus([]);
    }
  }, [open, initialName]);
  const [equipment, setEquipment] = useState<Equipment>("Barbell");
  const [isCompound, setIsCompound] = useState(false);
  const [isUnilateral, setIsUnilateral] = useState(false);

  const addStimulus = () => {
    const used = new Set(stimulus.map((row) => row.muscleGroupId));
    const next = muscleGroups.find((group) => !used.has(String(group.id)));
    if (!next) return;
    setStimulus((rows) => [
      ...rows,
      { muscleGroupId: String(next.id), stimulusRatio: rows.length === 0 ? "1.00" : "0.50" },
    ]);
  };

  const normalizedStimulus = stimulus.map((row) => ({
    muscleGroupId: Number(row.muscleGroupId),
    stimulusRatio: Number(row.stimulusRatio),
  }));

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/exercises", {
        name,
        stimulus: normalizedStimulus,
        equipment,
        movementPattern: null,
        isCompound,
        isUnilateral,
      });
      return res.json();
    },
    onSuccess: (ex: Exercise) => {
      qc.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({ title: "Exercise created", description: `${ex.name} added to your library.` });
      onCreated(ex);
      setName("");
      setStimulus([]);
      setEquipment("Barbell");
      setIsCompound(false);
      setIsUnilateral(false);
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to create exercise", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-exercise" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create new exercise</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ex-name">Name</Label>
            <Input
              id="ex-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cable Chest Press"
              data-testid="input-new-exercise-name"
            />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <div>
              <Label>Muscle Stimulus</Label>
              <p className="text-xs text-muted-foreground">1.00 = one full effective set; 0.50 = half an effective set.</p>
            </div>
            {stimulus.map((row, index) => (
              <div key={`${row.muscleGroupId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_6rem_2rem] gap-2 items-center">
                <Select
                  value={row.muscleGroupId}
                  onValueChange={(value) =>
                    setStimulus((rows) => rows.map((item, i) => (i === index ? { ...item, muscleGroupId: value } : item)))
                  }
                >
                  <SelectTrigger data-testid={`select-stimulus-muscle-${index}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {muscleGroups
                      .filter(
                        (group) =>
                          String(group.id) === row.muscleGroupId ||
                          !stimulus.some((item) => item.muscleGroupId === String(group.id)),
                      )
                      .map((group) => (
                        <SelectItem key={group.id} value={String(group.id)}>{group.displayName}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={row.stimulusRatio}
                  onChange={(event) =>
                    setStimulus((rows) => rows.map((item, i) => (i === index ? { ...item, stimulusRatio: event.target.value } : item)))
                  }
                  aria-label="Effective-set ratio"
                />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setStimulus((rows) => rows.filter((_, i) => i !== index))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addStimulus} disabled={stimulus.length >= muscleGroups.length}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add muscle
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>Equipment</Label>
            <Select value={equipment} onValueChange={(v) => setEquipment(v as Equipment)}>
              <SelectTrigger data-testid="select-equipment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {equipmentTypes.map((eq) => (
                  <SelectItem key={eq} value={eq}>
                    {eq}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-compound"
                checked={isCompound}
                onCheckedChange={(v) => setIsCompound(Boolean(v))}
                data-testid="checkbox-is-compound"
              />
              <Label htmlFor="is-compound" className="cursor-pointer">Compound</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-unilateral"
                checked={isUnilateral}
                onCheckedChange={(v) => setIsUnilateral(Boolean(v))}
                data-testid="checkbox-is-unilateral"
              />
              <Label htmlFor="is-unilateral" className="cursor-pointer">Unilateral</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={
              !name.trim() ||
              !normalizedStimulus.some((row) => row.stimulusRatio > 0) ||
              normalizedStimulus.some((row) => !Number.isFinite(row.stimulusRatio) || row.stimulusRatio < 0 || row.stimulusRatio > 1) ||
              createMutation.isPending
            }
            onClick={() => createMutation.mutate()}
            data-testid="button-submit-new-exercise"
          >
            Create exercise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateStartPicker({
  templates,
  onStart,
}: {
  templates: WorkoutTemplateLite[];
  onStart: (t: WorkoutTemplateLite) => void;
}) {
  const [open, setOpen] = useState(false);
  if (templates.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="dialog-start-template" className="max-h-[85vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 overflow-y-auto pr-1 -mr-1">
          {templates.map((t) => (
            <button
              key={t.id}
              className="w-full text-left p-3 rounded-md border hover-elevate active-elevate-2"
              onClick={() => {
                onStart(t);
                setOpen(false);
              }}
              data-testid={`button-select-template-${t.id}`}
            >
              <p className="font-medium text-sm">{t.name}</p>
              <p className="text-xs text-muted-foreground">{t.exercises.length} exercises</p>
            </button>
          ))}
        </div>
      </DialogContent>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => setOpen(true)}
        data-testid="button-open-template-picker"
      >
        <ClipboardList className="h-4 w-4" />
        Start from template
      </Button>
    </Dialog>
  );
}

export default function LogWorkout() {
  const { toast } = useToast();
  const restTimer = useRestTimer();
  const [location] = useLocation();
  const [workoutName, setWorkoutName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState("");
  const [saved, setSaved] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<number | null>(null);
  // Lazily-created workout id, set the first time any individual set is
  // logged mid-session (via "Log set"). Reused for subsequent per-set logs
  // and for the final batch save, so we never create duplicate workouts.
  const [liveWorkoutId, setLiveWorkoutId] = useState<number | null>(null);
  const [warmupDialogFor, setWarmupDialogFor] = useState<{ exerciseName: string; weight?: number } | null>(
    null,
  );

  const { data: exercises, isLoading: exercisesLoading } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });
  const { data: muscleGroups } = useQuery<MuscleGroupView[]>({
    queryKey: ["/api/muscle-groups"],
  });
  const { activeUserId } = useActiveUser();
  const { data: templates } = useQuery<WorkoutTemplateLite[]>({
    queryKey: ["/api/workout-templates", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-templates");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const exerciseMap = useMemo(() => {
    const m = new Map<number, Exercise>();
    for (const e of exercises ?? []) m.set(e.id, e);
    return m;
  }, [exercises]);

  // Auto-start from template if navigated with ?template=<id>. Under useHashLocation, wouter's
  // navigate() sets the query on the real URL's search string (not embedded in the hash), so
  // check window.location.search first — falling back to a query string embedded directly in
  // the hash (e.g. from a manually-set `#/log?template=1` hash) for robustness.
  useEffect(() => {
    if (!templates || exercisesLoading) return;
    const hash = window.location.hash;
    const qIndex = hash.indexOf("?");
    const rawQuery = window.location.search || (qIndex !== -1 ? hash.slice(qIndex) : "");
    if (!rawQuery) return;
    const params = new URLSearchParams(rawQuery);
    const templateId = params.get("template");
    if (templateId && activeTemplateId === null) {
      const t = templates.find((tpl) => tpl.id === Number(templateId));
      if (t) startFromTemplate(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, exercisesLoading, location]);

  const startFromTemplate = (template: WorkoutTemplateLite) => {
    const sorted = [...template.exercises].sort((a, b) => a.exerciseOrder - b.exerciseOrder);
    const newDrafts: DraftExercise[] = [];
    for (const te of sorted) {
      const ex = exerciseMap.get(te.exerciseId);
      if (!ex) continue;
      // Working sets come from the explicit top+backoff breakdown when the
      // template specifies one; otherwise fall back to targetSets. Warm-up
      // sets are always additive on top of the working sets.
      const workingSets = te.topSets + te.backoffSets > 0 ? te.topSets + te.backoffSets : te.targetSets;
      const totalSets = Math.max(1, te.warmupSets + workingSets);
      const sets: DraftSet[] = [];
      for (let i = 0; i < totalSets; i++) {
        const isWarmup = i < te.warmupSets;
        sets.push({ ...newSet(), isWarmup });
      }
      newDrafts.push({ key: Math.random().toString(36).slice(2), exercise: ex, sets, prescription: te });
    }
    setDraftExercises(newDrafts);
    setWorkoutName(template.name);
    setActiveTemplateId(template.id);
    setLiveWorkoutId(null);
    toast({ title: `Started ${template.name}`, description: `${newDrafts.length} exercises loaded.` });
  };

  const addExercise = (ex: Exercise) => {
    setDraftExercises((prev) => [
      ...prev,
      { key: Math.random().toString(36).slice(2), exercise: ex, sets: [newSet()] },
    ]);
  };

  const removeExercise = (key: string) => {
    setDraftExercises((prev) => prev.filter((d) => d.key !== key));
  };

  const addSet = (exKey: string) => {
    setDraftExercises((prev) =>
      prev.map((d) => (d.key === exKey ? { ...d, sets: [...d.sets, newSet()] } : d)),
    );
  };

  const removeSet = (exKey: string, setKey: string) => {
    setDraftExercises((prev) =>
      prev.map((d) =>
        d.key === exKey ? { ...d, sets: d.sets.filter((s) => s.key !== setKey) } : d,
      ),
    );
  };

  const updateSet = (exKey: string, setKey: string, patch: Partial<DraftSet>) => {
    setDraftExercises((prev) =>
      prev.map((d) =>
        d.key === exKey
          ? {
              ...d,
              sets: d.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)),
            }
          : d,
      ),
    );
  };

  const totalValidSets = useMemo(
    () =>
      draftExercises.reduce(
        (sum, d) => sum + d.sets.filter((s) => s.weight !== "" && s.reps !== "").length,
        0,
      ),
    [draftExercises],
  );

  const invalidateWorkoutQueries = () => {
    qc.invalidateQueries({ queryKey: ["/api/workouts"] });
    qc.invalidateQueries({ queryKey: ["/api/dashboard/volume"] });
    qc.invalidateQueries({ queryKey: ["/api/volume-tracker"] });
    qc.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
    qc.invalidateQueries({ queryKey: ["/api/recovery"] });
    qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
  };

  /** Create the workout row on first individual set-log, and reuse afterward. */
  const ensureWorkoutId = async (): Promise<number> => {
    if (liveWorkoutId != null) return liveWorkoutId;
    const res = await apiRequest("POST", "/api/workouts", {
      date,
      name: workoutName || null,
      notes: null,
      workoutTemplateId: activeTemplateId,
    });
    const workout = await res.json();
    setLiveWorkoutId(workout.id);
    return workout.id;
  };

  // Logs a single set immediately (used by the per-row "Log set" action).
  // Starts the rest timer from the exercise's prescribed restSeconds and
  // surfaces an instant "New PR!" toast when the backend flags one.
  const logSetMutation = useMutation({
    mutationFn: async ({ exKey, setKey }: { exKey: string; setKey: string }) => {
      const draftExercise = draftExercises.find((d) => d.key === exKey);
      const draftSet = draftExercise?.sets.find((s) => s.key === setKey);
      if (!draftExercise || !draftSet) throw new Error("Set not found");
      const setNumber = draftExercise.sets.filter((s) => !!s.loggedSetId).length + 1;
      const workoutId = await ensureWorkoutId();
      const res = await apiRequest("POST", "/api/sets", {
        workoutId,
        exerciseId: draftExercise.exercise.id,
        setNumber,
        weight: Number(draftSet.weight),
        reps: Number(draftSet.reps),
        rir: draftSet.rir === "" ? null : Number(draftSet.rir),
        isWarmup: draftSet.isWarmup,
      });
      const created = await res.json();
      return { exKey, setKey, draftExercise, draftSet, created };
    },
    onSuccess: ({ exKey, setKey, draftExercise, draftSet, created }) => {
      updateSet(exKey, setKey, { loggedSetId: created.id });
      qc.invalidateQueries({ queryKey: ["/api/exercises", String(draftExercise.exercise.id), "sets"] });

      if (!draftSet.isWarmup) {
        const restSeconds = draftExercise.prescription?.restSeconds ?? 90;
        restTimer.start(restSeconds, draftExercise.exercise.name);
      }

      if (created.pr?.isPr) {
        toast({
          title: `New PR! ${draftExercise.exercise.name}`,
          description: `${created.pr.recordType}: ${created.pr.displayValue}${
            created.pr.previousBest ? ` (prev. ${created.pr.previousBest})` : ""
          }`,
        });
      }
    },
    onError: () => {
      toast({ title: "Failed to log set", variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const workoutId = await ensureWorkoutId();

      for (const d of draftExercises) {
        let setNumber = d.sets.filter((s) => !!s.loggedSetId).length + 1;
        for (const s of d.sets) {
          if (s.loggedSetId) continue; // already saved via "Log set"
          if (s.weight === "" || s.reps === "") continue;
          await apiRequest("POST", "/api/sets", {
            workoutId,
            exerciseId: d.exercise.id,
            setNumber: setNumber++,
            weight: Number(s.weight),
            reps: Number(s.reps),
            rir: s.rir === "" ? null : Number(s.rir),
            isWarmup: s.isWarmup,
          });
        }
      }
      return { id: workoutId };
    },
    onSuccess: () => {
      invalidateWorkoutQueries();
      toast({ title: "Workout saved", description: `Logged ${totalValidSets} ${totalValidSets === 1 ? "set" : "sets"}.` });
      setDraftExercises([]);
      setWorkoutName("");
      setDate(todayIso());
      setActiveTemplateId(null);
      setLiveWorkoutId(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: () => {
      toast({ title: "Failed to save workout", variant: "destructive" });
    },
  });

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6 pb-24">
      <div>
        <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
          Log Workout
        </h1>
        <p className="text-sm text-muted-foreground">Record today's session</p>
      </div>

      {draftExercises.length === 0 && (
        <TemplateStartPicker templates={templates ?? []} onStart={startFromTemplate} />
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="workout-name">Workout name (optional)</Label>
              <Input
                id="workout-name"
                placeholder="e.g. Push Day"
                value={workoutName}
                onChange={(e) => setWorkoutName(e.target.value)}
                data-testid="input-workout-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workout-date">Date</Label>
              <Input
                id="workout-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="input-workout-date"
              />
            </div>
          </div>
          {activeTemplateId != null && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-active-template">
              From template
            </Badge>
          )}
        </CardContent>
      </Card>

      {draftExercises.map((d) => (
        <Card key={d.key} data-testid={`card-draft-exercise-${d.exercise.id}`}>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">{d.exercise.name}</CardTitle>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <Badge variant="outline" className="text-xs">
                  {d.exercise.equipment}
                </Badge>
                {d.prescription && (
                  <>
                    <Badge variant="secondary" className="text-xs" data-testid={`badge-prescription-reps-${d.exercise.id}`}>
                      {d.prescription.targetRepsMin}-{d.prescription.targetRepsMax} reps
                    </Badge>
                    <Badge variant="secondary" className="text-xs" data-testid={`badge-prescription-rir-${d.exercise.id}`}>
                      {d.prescription.targetRir} RIR target
                    </Badge>
                    {d.prescription.failureTarget !== "Never" && (
                      <Badge variant="destructive" className="text-xs">
                        {d.prescription.failureTarget}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setWarmupDialogFor({
                    exerciseName: d.exercise.name,
                    weight: (() => {
                      const lastWorking = [...d.sets].reverse().find((s) => !s.isWarmup && s.weight !== "");
                      return lastWorking ? Number(lastWorking.weight) : undefined;
                    })(),
                  })
                }
                data-testid={`button-warmup-calc-${d.exercise.id}`}
                aria-label="Warm-up calculator"
              >
                <Flame className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeExercise(d.key)}
                data-testid={`button-remove-exercise-${d.exercise.id}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ExerciseHistory exerciseId={d.exercise.id} />

            <div className="space-y-2">
              <div className="grid grid-cols-[1.5rem_1fr_1fr_1fr_2.5rem_2.25rem_2rem] gap-2 text-xs text-muted-foreground px-1">
                <span>#</span>
                <span>Weight</span>
                <span>Reps</span>
                <span>RIR</span>
                <span className="text-center">Warm-Up</span>
                <span />
                <span />
              </div>
              {d.sets.map((s, idx) => (
                <div
                  key={s.key}
                  className="grid grid-cols-[1.5rem_1fr_1fr_1fr_2.5rem_2.25rem_2rem] gap-2 items-center"
                  data-testid={`row-set-${d.exercise.id}-${idx}`}
                >
                  <span className="text-sm text-muted-foreground">{idx + 1}</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="lb"
                    value={s.weight}
                    disabled={!!s.loggedSetId}
                    onChange={(e) => updateSet(d.key, s.key, { weight: e.target.value })}
                    data-testid={`input-weight-${d.exercise.id}-${idx}`}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="reps"
                    value={s.reps}
                    disabled={!!s.loggedSetId}
                    onChange={(e) => updateSet(d.key, s.key, { reps: e.target.value })}
                    data-testid={`input-reps-${d.exercise.id}-${idx}`}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="RIR"
                    min={0}
                    max={5}
                    value={s.rir}
                    disabled={!!s.loggedSetId}
                    onChange={(e) => updateSet(d.key, s.key, { rir: e.target.value })}
                    data-testid={`input-rir-${d.exercise.id}-${idx}`}
                  />
                  <div className="flex justify-center">
                    <Checkbox
                      checked={s.isWarmup}
                      disabled={!!s.loggedSetId}
                      onCheckedChange={(v) => updateSet(d.key, s.key, { isWarmup: Boolean(v) })}
                      data-testid={`checkbox-warmup-${d.exercise.id}-${idx}`}
                    />
                  </div>
                  <Button
                    variant={s.loggedSetId ? "ghost" : "outline"}
                    size="icon"
                    className="h-8 w-8"
                    disabled={!!s.loggedSetId || s.weight === "" || s.reps === "" || logSetMutation.isPending}
                    onClick={() => logSetMutation.mutate({ exKey: d.key, setKey: s.key })}
                    data-testid={`button-log-set-${d.exercise.id}-${idx}`}
                    aria-label={s.loggedSetId ? "Set logged" : "Log this set"}
                  >
                    {s.loggedSetId ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <TimerIcon className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeSet(d.key, s.key)}
                    disabled={d.sets.length === 1 || !!s.loggedSetId}
                    data-testid={`button-remove-set-${d.exercise.id}-${idx}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => addSet(d.key)}
              data-testid={`button-add-set-${d.exercise.id}`}
            >
              <Plus className="h-3.5 w-3.5" />
              Add set
            </Button>
          </CardContent>
        </Card>
      ))}

      <WarmupCalculator
        open={warmupDialogFor != null}
        onOpenChange={(open) => {
          if (!open) setWarmupDialogFor(null);
        }}
        exerciseName={warmupDialogFor?.exerciseName}
        defaultWorkingWeight={warmupDialogFor?.weight}
      />

      {!exercisesLoading && (
        <ExercisePicker
          exercises={exercises ?? []}
          onSelect={addExercise}
          onCreateNew={(name) => {
            setNewExerciseName(name);
            setCreateDialogOpen(true);
          }}
        />
      )}

      <CreateExerciseDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        muscleGroups={muscleGroups ?? []}
        onCreated={addExercise}
        initialName={newExerciseName}
      />

      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:left-[16rem] border-t bg-background/95 backdrop-blur p-3">
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground" data-testid="text-total-sets">
            {totalValidSets} set{totalValidSets === 1 ? "" : "s"} ready
          </span>
          <Button
            disabled={draftExercises.length === 0 || totalValidSets === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            data-testid="button-save-workout"
          >
            {saved ? <Check className="h-4 w-4" /> : null}
            Save Workout
          </Button>
        </div>
      </div>
    </div>
  );
}
