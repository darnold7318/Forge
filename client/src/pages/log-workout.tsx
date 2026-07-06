import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Trash2, X } from "lucide-react";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Exercise,
  MuscleGroup,
  Equipment,
} from "@shared/schema";
import { equipmentTypes } from "@shared/schema";

interface DraftSet {
  key: string;
  weight: string;
  reps: string;
  rpe: string;
  isWarmup: boolean;
}

interface DraftExercise {
  key: string;
  exercise: Exercise;
  sets: DraftSet[];
}

function newSet(): DraftSet {
  return {
    key: Math.random().toString(36).slice(2),
    weight: "",
    reps: "",
    rpe: "",
    isWarmup: false,
  };
}

interface HistorySet {
  id: number;
  workoutId: number;
  weight: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  workoutDate: string;
}

function ExerciseHistory({ exerciseId }: { exerciseId: number }) {
  const { data, isLoading } = useQuery<HistorySet[]>({
    queryKey: ["/api/exercises", String(exerciseId), "sets"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/exercises/${exerciseId}/sets`);
      return res.json();
    },
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
                <span key={s.id} className="tabular-nums font-mono bg-muted rounded px-1.5 py-0.5">
                  {s.weight}×{s.reps}
                  {s.rpe ? `@${s.rpe}` : ""}
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
              {exercises.map((ex) => (
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
  muscleGroups: MuscleGroup[];
  onCreated: (ex: Exercise) => void;
  initialName: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);
  const [primaryId, setPrimaryId] = useState<string>("");
  const [secondaryId, setSecondaryId] = useState<string>("");
  const [equipment, setEquipment] = useState<Equipment>("barbell");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/exercises", {
        name,
        primaryMuscleGroupId: Number(primaryId),
        secondaryMuscleGroupId: secondaryId ? Number(secondaryId) : null,
        equipment,
      });
      return res.json();
    },
    onSuccess: (ex: Exercise) => {
      qc.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({ title: "Exercise created", description: `${ex.name} added to your library.` });
      onCreated(ex);
      setName("");
      setPrimaryId("");
      setSecondaryId("");
      setEquipment("barbell");
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to create exercise", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-exercise">
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
          <div className="space-y-1.5">
            <Label>Primary muscle group</Label>
            <Select value={primaryId} onValueChange={setPrimaryId}>
              <SelectTrigger data-testid="select-primary-muscle">
                <SelectValue placeholder="Select primary muscle" />
              </SelectTrigger>
              <SelectContent>
                {muscleGroups.map((mg) => (
                  <SelectItem key={mg.id} value={String(mg.id)}>
                    {mg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Secondary muscle group (optional)</Label>
            <Select value={secondaryId} onValueChange={setSecondaryId}>
              <SelectTrigger data-testid="select-secondary-muscle">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {muscleGroups.map((mg) => (
                  <SelectItem key={mg.id} value={String(mg.id)}>
                    {mg.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    {eq[0].toUpperCase() + eq.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!name || !primaryId || createMutation.isPending}
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

export default function LogWorkout() {
  const { toast } = useToast();
  const [workoutName, setWorkoutName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState("");
  const [saved, setSaved] = useState(false);

  const { data: exercises, isLoading: exercisesLoading } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });
  const { data: muscleGroups } = useQuery<MuscleGroup[]>({
    queryKey: ["/api/muscle-groups"],
  });

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const workoutRes = await apiRequest("POST", "/api/workouts", {
        date,
        name: workoutName || null,
        notes: null,
      });
      const workout = await workoutRes.json();

      for (const d of draftExercises) {
        let setNumber = 1;
        for (const s of d.sets) {
          if (s.weight === "" || s.reps === "") continue;
          await apiRequest("POST", "/api/sets", {
            workoutId: workout.id,
            exerciseId: d.exercise.id,
            setNumber: setNumber++,
            weight: Number(s.weight),
            reps: Number(s.reps),
            rpe: s.rpe === "" ? null : Number(s.rpe),
            isWarmup: s.isWarmup,
          });
        }
      }
      return workout;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/workouts"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/volume"] });
      qc.invalidateQueries({ queryKey: ["/api/volume-tracker"] });
      qc.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
      qc.invalidateQueries({ queryKey: ["/api/coach/deload"] });
      toast({ title: "Workout saved", description: `Logged ${totalValidSets} ${totalValidSets === 1 ? "set" : "sets"}.` });
      setDraftExercises([]);
      setWorkoutName("");
      setDate(todayIso());
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
        </CardContent>
      </Card>

      {draftExercises.map((d) => (
        <Card key={d.key} data-testid={`card-draft-exercise-${d.exercise.id}`}>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">{d.exercise.name}</CardTitle>
              <Badge variant="outline" className="mt-1 text-xs capitalize">
                {d.exercise.equipment}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeExercise(d.key)}
              data-testid={`button-remove-exercise-${d.exercise.id}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <ExerciseHistory exerciseId={d.exercise.id} />

            <div className="space-y-2">
              <div className="grid grid-cols-[1.5rem_1fr_1fr_1fr_2.5rem_2rem] gap-2 text-xs text-muted-foreground px-1">
                <span>#</span>
                <span>Weight</span>
                <span>Reps</span>
                <span>RPE</span>
                <span className="text-center">Warm</span>
                <span />
              </div>
              {d.sets.map((s, idx) => (
                <div
                  key={s.key}
                  className="grid grid-cols-[1.5rem_1fr_1fr_1fr_2.5rem_2rem] gap-2 items-center"
                  data-testid={`row-set-${d.exercise.id}-${idx}`}
                >
                  <span className="text-sm text-muted-foreground">{idx + 1}</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="lb"
                    value={s.weight}
                    onChange={(e) => updateSet(d.key, s.key, { weight: e.target.value })}
                    data-testid={`input-weight-${d.exercise.id}-${idx}`}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="reps"
                    value={s.reps}
                    onChange={(e) => updateSet(d.key, s.key, { reps: e.target.value })}
                    data-testid={`input-reps-${d.exercise.id}-${idx}`}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="RPE"
                    min={1}
                    max={10}
                    value={s.rpe}
                    onChange={(e) => updateSet(d.key, s.key, { rpe: e.target.value })}
                    data-testid={`input-rpe-${d.exercise.id}-${idx}`}
                  />
                  <div className="flex justify-center">
                    <Checkbox
                      checked={s.isWarmup}
                      onCheckedChange={(v) => updateSet(d.key, s.key, { isWarmup: Boolean(v) })}
                      data-testid={`checkbox-warmup-${d.exercise.id}-${idx}`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeSet(d.key, s.key)}
                    disabled={d.sets.length === 1}
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
