import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Exercise {
  id: number;
  name: string;
  equipment: string;
  trackingMode: "reps" | "duration";
}

interface SetRow {
  id: number;
  exerciseId: number;
  setNumber: number;
  weight: number;
  reps: number;
  durationSeconds: number | null;
  rir: number | null;
  isWarmup: boolean;
  exercise: Exercise;
}

interface WorkoutDetail {
  id: number;
  date: string;
  name: string | null;
  sets: SetRow[];
}

// Keyed debounce: each key (e.g. `${setId}-${field}`) gets its own independent
// timer, so editing weight then reps on the same set doesn't cancel the
// pending weight save — each field commits on its own schedule.
function useKeyedDebouncedCallback<T extends (...args: any[]) => void>(fn: T, delay = 500) {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  return (key: string, ...args: Parameters<T>) => {
    const existing = timersRef.current.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      timersRef.current.delete(key);
      fn(...args);
    }, delay);
    timersRef.current.set(key, t);
  };
}

export default function WorkoutEdit() {
  const params = useParams<{ id: string }>();
  const workoutId = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [localName, setLocalName] = useState<string | null>(null);
  const [localDate, setLocalDate] = useState<string | null>(null);
  const [deleteWorkoutOpen, setDeleteWorkoutOpen] = useState(false);
  const [deleteSetId, setDeleteSetId] = useState<number | null>(null);

  const { data: workout, isLoading } = useQuery<WorkoutDetail>({
    queryKey: ["/api/workouts", String(workoutId)],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workouts/${workoutId}`);
      return res.json();
    },
    enabled: !Number.isNaN(workoutId),
  });

  // Local draft copy of set field values, keyed by set id, so typing doesn't
  // fight with refetches. Reset whenever the workout id changes / initial load lands.
  const [drafts, setDrafts] = useState<Record<number, { weight: string; reps: string; durationSeconds: string; rir: string }>>({});
  useEffect(() => {
    if (!workout) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of workout.sets) {
        if (!next[s.id]) {
          next[s.id] = {
            weight: String(s.weight),
            reps: String(s.reps),
            durationSeconds: s.durationSeconds == null ? "" : String(s.durationSeconds),
            rir: s.rir == null ? "" : String(s.rir),
          };
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout?.id, workout?.sets.length]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/workouts", String(workoutId)] });
    queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/volume"] });
  };

  const patchWorkoutMutation = useMutation({
    mutationFn: async (patch: { name?: string; date?: string }) => {
      const res = await apiRequest("PATCH", `/api/workouts/${workoutId}`, patch);
      return res.json();
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't save changes", variant: "destructive" }),
  });
  const debouncedPatchWorkoutKeyed = useKeyedDebouncedCallback((patch: { name?: string; date?: string }) =>
    patchWorkoutMutation.mutate(patch),
  );
  const debouncedPatchWorkout = (patch: { name?: string; date?: string }) =>
    debouncedPatchWorkoutKeyed(Object.keys(patch)[0], patch);

  const patchSetMutation = useMutation({
    mutationFn: async ({
      setId,
      patch,
    }: {
      setId: number;
      patch: Partial<{ weight: number; reps: number; durationSeconds: number; rir: number | null; isWarmup: boolean }>;
    }) => {
      const res = await apiRequest("PATCH", `/api/sets/${setId}`, patch);
      return res.json();
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't save set", variant: "destructive" }),
  });
  const debouncedPatchSet = useKeyedDebouncedCallback(
    (setId: number, patch: Partial<{ weight: number; reps: number; durationSeconds: number; rir: number | null }>) =>
      patchSetMutation.mutate({ setId, patch }),
  );

  const deleteSetMutation = useMutation({
    mutationFn: async (setId: number) => {
      await apiRequest("DELETE", `/api/sets/${setId}`);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Set deleted" });
    },
    onError: () => toast({ title: "Couldn't delete set", variant: "destructive" }),
  });

  const deleteWorkoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/workouts/${workoutId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/volume"] });
      toast({ title: "Workout deleted" });
      navigate("/history");
    },
    onError: () => toast({ title: "Couldn't delete workout", variant: "destructive" }),
  });

  if (isLoading || !workout) {
    return (
      <div className="mx-auto max-w-2xl p-4 md:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Group sets by exercise, preserving first-seen exercise order and set number order.
  const exerciseOrder: number[] = [];
  const setsByExercise = new Map<number, SetRow[]>();
  for (const s of [...workout.sets].sort((a, b) => a.setNumber - b.setNumber)) {
    if (!setsByExercise.has(s.exerciseId)) {
      setsByExercise.set(s.exerciseId, []);
      exerciseOrder.push(s.exerciseId);
    }
    setsByExercise.get(s.exerciseId)!.push(s);
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6 space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 -ml-2"
        onClick={() => navigate("/history")}
        data-testid="button-back-to-history"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Workout History
      </Button>

      <Card data-testid="card-workout-header">
        <CardHeader>
          <CardTitle className="text-base">Workout Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={localName ?? workout.name ?? ""}
                placeholder="e.g. Push Day"
                onChange={(e) => {
                  setLocalName(e.target.value);
                  debouncedPatchWorkout({ name: e.target.value });
                }}
                data-testid="input-workout-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={(localDate ?? workout.date ?? "").slice(0, 10)}
                onChange={(e) => {
                  setLocalDate(e.target.value);
                  debouncedPatchWorkout({ date: e.target.value });
                }}
                data-testid="input-workout-date"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {exerciseOrder.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground" data-testid="text-no-sets">
              No sets were logged for this workout.
            </p>
          </CardContent>
        </Card>
      ) : (
        exerciseOrder.map((exId) => {
          const exSets = setsByExercise.get(exId)!;
          const exercise = exSets[0].exercise;
          const exName = exercise.name;
          const isDuration = exercise.trackingMode === "duration";
          return (
            <Card key={exId} data-testid={`card-edit-exercise-${exId}`}>
              <CardHeader>
                <CardTitle className="text-base" data-testid={`text-edit-exercise-name-${exId}`}>
                  {exName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-[1.5rem_1fr_1fr_1fr_2.5rem_2rem] gap-2 text-xs text-muted-foreground px-1">
                  <span>#</span>
                  <span>{exercise.equipment === "Bodyweight" ? "Additional weight" : "Weight"}</span>
                  <span>{isDuration ? "Time (sec)" : "Reps"}</span>
                  <span>RIR</span>
                  <span className="text-center">Warm</span>
                  <span />
                </div>
                {exSets.map((s, idx) => {
                  const draft = drafts[s.id] ?? {
                    weight: String(s.weight),
                    reps: String(s.reps),
                    durationSeconds: s.durationSeconds == null ? "" : String(s.durationSeconds),
                    rir: s.rir == null ? "" : String(s.rir),
                  };
                  return (
                    <div
                      key={s.id}
                      className="grid grid-cols-[1.5rem_1fr_1fr_1fr_2.5rem_2rem] gap-2 items-center"
                      data-testid={`row-edit-set-${s.id}`}
                    >
                      <span className="text-sm text-muted-foreground">{idx + 1}</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder={exercise.equipment === "Bodyweight" ? "+ lb" : "lb"}
                        value={draft.weight}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], weight: v } }));
                          const num = Number(v);
                          if (v !== "" && !Number.isNaN(num)) debouncedPatchSet(`${s.id}-weight`, s.id, { weight: num });
                        }}
                        data-testid={`input-edit-weight-${s.id}`}
                      />
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        placeholder={isDuration ? "sec" : "reps"}
                        value={isDuration ? draft.durationSeconds : draft.reps}
                        onChange={(e) => {
                          const v = e.target.value;
                          const field = isDuration ? "durationSeconds" : "reps";
                          setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], [field]: v } }));
                          const num = Number(v);
                          if (v !== "" && !Number.isNaN(num)) {
                            debouncedPatchSet(`${s.id}-${field}`, s.id, { [field]: num });
                          }
                        }}
                        data-testid={isDuration ? `input-edit-duration-${s.id}` : `input-edit-reps-${s.id}`}
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder="RIR"
                        min={0}
                        max={5}
                        value={draft.rir}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], rir: v } }));
                          const num = v === "" ? null : Number(v);
                          if (num === null || !Number.isNaN(num)) debouncedPatchSet(`${s.id}-rir`, s.id, { rir: num });
                        }}
                        data-testid={`input-edit-rir-${s.id}`}
                      />
                      <div className="flex justify-center">
                        <Checkbox
                          checked={s.isWarmup}
                          onCheckedChange={(v) =>
                            patchSetMutation.mutate({ setId: s.id, patch: { isWarmup: Boolean(v) } })
                          }
                          data-testid={`checkbox-edit-warmup-${s.id}`}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setDeleteSetId(s.id)}
                        aria-label="Delete set"
                        data-testid={`button-delete-set-${s.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })
      )}

      <Card data-testid="card-delete-workout" className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Delete Workout</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently deletes this workout and all its logged sets. This can't be undone.
          </p>
          <Button
            variant="destructive"
            className="gap-2"
            onClick={() => setDeleteWorkoutOpen(true)}
            data-testid="button-delete-workout-page"
          >
            <Trash2 className="h-4 w-4" />
            Delete Workout
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={deleteSetId != null} onOpenChange={(open) => !open && setDeleteSetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this set?</AlertDialogTitle>
            <AlertDialogDescription>This removes the set from the workout. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-set">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteSetId != null) deleteSetMutation.mutate(deleteSetId);
                setDeleteSetId(null);
              }}
              data-testid="button-confirm-delete-set"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteWorkoutOpen} onOpenChange={setDeleteWorkoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {localName ?? workout.name ?? "this workout"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workout and all {workout.sets.length} logged{" "}
              {workout.sets.length === 1 ? "set" : "sets"}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-workout-page">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setDeleteWorkoutOpen(false);
                deleteWorkoutMutation.mutate();
              }}
              disabled={deleteWorkoutMutation.isPending}
              data-testid="button-confirm-delete-workout-page"
            >
              {deleteWorkoutMutation.isPending ? "Deleting..." : "Delete Workout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
