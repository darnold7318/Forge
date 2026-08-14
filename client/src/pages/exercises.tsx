import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dumbbell, Plus, Pencil, Trash2, Search, RotateCcw, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import { equipmentTypes, type Equipment, type MuscleGroup, type ExerciseView, type TrackingMode } from "@shared/schema";

type Exercise = ExerciseView;
type MuscleGroupWithDisplay = MuscleGroup & { displayName: string };

interface StimulusFormRow {
  muscleGroupId: string;
  stimulusRatio: string;
}

interface ExerciseFormState {
  name: string;
  stimulus: StimulusFormRow[];
  equipment: Equipment;
  isCompound: boolean;
  isUnilateral: boolean;
  trackingMode: TrackingMode;
}

const emptyForm: ExerciseFormState = {
  name: "",
  stimulus: [],
  equipment: "Barbell",
  isCompound: false,
  isUnilateral: false,
  trackingMode: "reps",
};

function toFormState(ex: Exercise): ExerciseFormState {
  return {
    name: ex.name,
    stimulus: ex.stimulus.map((row) => ({
      muscleGroupId: String(row.muscleGroupId),
      stimulusRatio: row.stimulusRatio.toFixed(2),
    })),
    equipment: ex.equipment as Equipment,
    isCompound: ex.isCompound,
    isUnilateral: ex.isUnilateral,
    trackingMode: ex.trackingMode as TrackingMode,
  };
}

function ExerciseFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  muscleGroups,
  onSaved,
  showUnilateral,
  showAdvanced,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: Exercise | null;
  muscleGroups: MuscleGroupWithDisplay[];
  onSaved: (ex: Exercise) => void;
  showUnilateral: boolean;
  showAdvanced: boolean;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ExerciseFormState>(initial ? toFormState(initial) : emptyForm);
  const { data: coachConfig } = useQuery<{ exerciseOverrides: { exerciseId: number; fatigueCost: number }[] }>({
    queryKey: ["/api/coach/settings"],
    queryFn: async () => (await apiRequest("GET", "/api/coach/settings")).json(),
    enabled: open && showAdvanced,
  });
  const currentFatigueOverride = coachConfig?.exerciseOverrides.find((item) => item.exerciseId === initial?.id);
  const [fatigueCost, setFatigueCost] = useState("1.00");
  useEffect(() => {
    if (open) setFatigueCost(currentFatigueOverride?.fatigueCost.toFixed(2) ?? "1.00");
  }, [open, initial?.id, currentFatigueOverride?.fatigueCost]);

  // Reset form whenever the dialog is opened for a (possibly different) exercise.
  const [lastInitialId, setLastInitialId] = useState<number | null | undefined>(undefined);
  if (open && initial?.id !== lastInitialId) {
    setLastInitialId(initial?.id ?? null);
    setForm(initial ? toFormState(initial) : emptyForm);
  }

  const addStimulusRow = () => {
    const used = new Set(form.stimulus.map((row) => row.muscleGroupId));
    const next = muscleGroups.find((group) => !used.has(String(group.id)));
    if (!next) return;
    setForm((prev) => ({
      ...prev,
      stimulus: [
        ...prev.stimulus,
        { muscleGroupId: String(next.id), stimulusRatio: prev.stimulus.length === 0 ? "1.00" : "0.50" },
      ],
    }));
  };

  const normalizedStimulus = form.stimulus
    .map((row) => ({ muscleGroupId: Number(row.muscleGroupId), stimulusRatio: Number(row.stimulusRatio) }))
    .filter((row) => Number.isInteger(row.muscleGroupId) && Number.isFinite(row.stimulusRatio));
  const mappingKey = (rows: { muscleGroupId: number; stimulusRatio: number }[]) =>
    [...rows]
      .filter((row) => row.stimulusRatio > 0)
      .sort((a, b) => a.muscleGroupId - b.muscleGroupId)
      .map((row) => `${row.muscleGroupId}:${row.stimulusRatio.toFixed(4)}`)
      .join("|");
  const stimulusChanged = initial ? mappingKey(normalizedStimulus) !== mappingKey(initial.stimulus) : true;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        equipment: form.equipment,
        movementPattern: initial?.movementPattern ?? null,
        isCompound: form.isCompound,
        isUnilateral: form.isUnilateral,
        trackingMode: form.trackingMode,
      };
      if (mode === "create") {
        const res = await apiRequest("POST", "/api/exercises", { ...payload, stimulus: normalizedStimulus });
        const exercise = await res.json();
        if (showAdvanced && Number(fatigueCost) !== 1) {
          await apiRequest("PUT", `/api/coach/settings/exercises/${exercise.id}`, { fatigueCost: Number(fatigueCost) });
        }
        return exercise;
      }
      const metadataResponse = await apiRequest("PATCH", `/api/exercises/${initial!.id}`, payload);
      let exercise = await metadataResponse.json();
      if (stimulusChanged) {
        const stimulusResponse = await apiRequest("PUT", `/api/exercises/${initial!.id}/stimulus`, {
          stimulus: normalizedStimulus,
        });
        exercise = await stimulusResponse.json();
      }
      if (showAdvanced) {
        if (Number(fatigueCost) === 1) {
          await apiRequest("DELETE", `/api/coach/settings/exercises/${initial!.id}`);
        } else {
          await apiRequest("PUT", `/api/coach/settings/exercises/${initial!.id}`, { fatigueCost: Number(fatigueCost) });
        }
      }
      return exercise;
    },
    onSuccess: (ex: Exercise) => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/settings"] });
      toast({
        title: mode === "create" ? "Exercise created" : "Exercise updated",
        description: `${ex.name} ${mode === "create" ? "added to" : "updated in"} your library.`,
      });
      onSaved(ex);
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: `Couldn't ${mode === "create" ? "create" : "update"} exercise`, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/exercises/${initial!.id}/stimulus-override`);
      return res.json();
    },
    onSuccess: (exercise: Exercise) => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      setForm(toFormState(exercise));
      onSaved(exercise);
      toast({ title: "Forge defaults restored" });
    },
    onError: () => toast({ title: "Couldn't reset stimulus", variant: "destructive" }),
  });

  const canSave =
    form.name.trim().length > 0 &&
    normalizedStimulus.length === form.stimulus.length &&
    normalizedStimulus.some((row) => row.stimulusRatio > 0) &&
    normalizedStimulus.every((row) => row.stimulusRatio >= 0 && row.stimulusRatio <= 1) &&
    new Set(normalizedStimulus.map((row) => row.muscleGroupId)).size === normalizedStimulus.length &&
    (!showAdvanced || (Number.isFinite(Number(fatigueCost)) && Number(fatigueCost) >= 0.5 && Number(fatigueCost) <= 2)) &&
    !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-exercise-form" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Exercise" : `Edit ${initial?.name ?? "Exercise"}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ex-name">Name</Label>
            <Input
              id="ex-name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Cable Chest Press"
              data-testid="input-exercise-name"
            />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label>Muscle Stimulus</Label>
                <p className="text-xs text-muted-foreground">Effective-set ratio: 1.00 = one full effective set; 0.50 = half a set.</p>
                <p className="text-xs text-muted-foreground">Custom ratios also recalculate your historical volume and recovery.</p>
              </div>
              {mode === "edit" && (
                <Badge variant={initial?.hasStimulusOverride ? "default" : "outline"}>
                  {initial?.hasStimulusOverride ? "Customized" : "Using Forge defaults"}
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              {form.stimulus
                .map((row, index) => ({ row, index }))
                .sort((a, b) => {
                  const ratio = Number(b.row.stimulusRatio) - Number(a.row.stimulusRatio);
                  if (ratio !== 0) return ratio;
                  const aName = muscleGroups.find((group) => String(group.id) === a.row.muscleGroupId)?.displayName ?? "";
                  const bName = muscleGroups.find((group) => String(group.id) === b.row.muscleGroupId)?.displayName ?? "";
                  return aName.localeCompare(bName);
                })
                .map(({ row, index }) => (
                  <div key={`${row.muscleGroupId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_6rem_2rem] gap-2 items-center">
                    <Select
                      value={row.muscleGroupId}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          stimulus: prev.stimulus.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, muscleGroupId: value } : item,
                          ),
                        }))
                      }
                    >
                      <SelectTrigger data-testid={`select-stimulus-muscle-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {muscleGroups
                          .filter(
                            (group) =>
                              String(group.id) === row.muscleGroupId ||
                              !form.stimulus.some((item) => item.muscleGroupId === String(group.id)),
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
                        setForm((prev) => ({
                          ...prev,
                          stimulus: prev.stimulus.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, stimulusRatio: event.target.value } : item,
                          ),
                        }))
                      }
                      aria-label="Effective-set ratio"
                      data-testid={`input-stimulus-ratio-${index}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => setForm((prev) => ({ ...prev, stimulus: prev.stimulus.filter((_, i) => i !== index) }))}
                      aria-label="Remove muscle stimulus"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={addStimulusRow} disabled={form.stimulus.length >= muscleGroups.length}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add muscle
              </Button>
              {mode === "edit" && initial?.hasStimulusOverride && (
                <Button type="button" size="sm" variant="ghost" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset to defaults
                </Button>
              )}
            </div>
          </div>
          {showAdvanced && (
            <div className="space-y-1.5 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div><Label htmlFor="exercise-fatigue-cost">Exercise fatigue cost</Label><p className="text-xs text-muted-foreground">0.50-2.00 model coefficient. 1.00 uses the normal Forge cost.</p></div>
                <Badge variant={Number(fatigueCost) === 1 ? "outline" : "default"}>{Number(fatigueCost) === 1 ? "Using Forge default" : "Customized"}</Badge>
              </div>
              <div className="flex gap-2">
                <Input id="exercise-fatigue-cost" type="number" min="0.5" max="2" step="0.05" value={fatigueCost} onChange={(event) => setFatigueCost(event.target.value)} />
                <Button type="button" variant="outline" onClick={() => setFatigueCost("1.00")}>Reset</Button>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Equipment</Label>
            <Select value={form.equipment} onValueChange={(v) => setForm((p) => ({ ...p, equipment: v as Equipment }))}>
              <SelectTrigger data-testid="select-exercise-equipment">
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
                id="ex-is-compound"
                checked={form.isCompound}
                onCheckedChange={(v) => setForm((p) => ({ ...p, isCompound: Boolean(v) }))}
                data-testid="checkbox-exercise-is-compound"
              />
              <Label htmlFor="ex-is-compound" className="cursor-pointer">Compound</Label>
            </div>
            {showUnilateral && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ex-is-unilateral"
                  checked={form.isUnilateral}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, isUnilateral: Boolean(v) }))}
                  data-testid="checkbox-exercise-is-unilateral"
                />
                <Label htmlFor="ex-is-unilateral" className="cursor-pointer">Unilateral</Label>
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="ex-static-hold"
              checked={form.trackingMode === "duration"}
              onCheckedChange={(v) => setForm((p) => ({ ...p, trackingMode: v ? "duration" : "reps" }))}
              data-testid="checkbox-exercise-static-hold"
            />
            <div className="space-y-0.5">
              <Label htmlFor="ex-static-hold" className="cursor-pointer">Static hold</Label>
              <p className="text-xs text-muted-foreground">Track time in seconds instead of repetitions.</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-exercise-form">
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => saveMutation.mutate()} data-testid="button-submit-exercise-form">
            {saveMutation.isPending ? "Saving..." : mode === "create" ? "Create exercise" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteExerciseDialog({
  exercise,
  onOpenChange,
}: {
  exercise: Exercise | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: usage } = useQuery<{ templateCount: number; loggedSetCount: number }>({
    queryKey: ["/api/exercises", exercise?.id, "usage"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/exercises/${exercise!.id}/usage`);
      return res.json();
    },
    enabled: exercise != null,
    // Usage can change from other pages (e.g. removing this exercise from a template),
    // so never trust a cached result here — always check fresh when the dialog opens.
    staleTime: 0,
    gcTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/exercises/${exercise!.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({ title: "Exercise deleted" });
      onOpenChange(false);
    },
    onError: async (err: unknown) => {
      let message = "Couldn't delete this exercise";
      if (err instanceof Error && err.message) {
        const match = err.message.match(/\{.*\}$/);
        if (match) {
          try {
            message = JSON.parse(match[0]).message ?? message;
          } catch {
            // fall through to default message
          }
        }
      }
      toast({ title: message, variant: "destructive" });
    },
  });

  const blocked = usage != null && (usage.templateCount > 0 || usage.loggedSetCount > 0);

  return (
    <AlertDialog open={exercise != null} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-delete-exercise">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {exercise?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {blocked ? (
              <>
                This exercise is currently in use, so it can't be deleted yet.
                {usage.loggedSetCount > 0 && (
                  <> It has {usage.loggedSetCount} logged set{usage.loggedSetCount === 1 ? "" : "s"} in your workout history.</>
                )}
                {usage.templateCount > 0 && (
                  <> It's used in {usage.templateCount} template exercise slot{usage.templateCount === 1 ? "" : "s"} — remove it from those templates first.</>
                )}
              </>
            ) : (
              "This permanently removes it from the shared exercise library. This can't be undone."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-exercise">Cancel</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={usage == null || deleteMutation.isPending}
              data-testid="button-confirm-delete-exercise"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Exercise"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function Exercises() {
  const { activeUser } = useActiveUser();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [deletingExercise, setDeletingExercise] = useState<Exercise | null>(null);

  const { data: exercises, isLoading } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });
  const { data: muscleGroups } = useQuery<MuscleGroupWithDisplay[]>({
    queryKey: ["/api/muscle-groups"],
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = exercises ?? [];
    if (!q) return list;
    return list.filter((ex) => ex.name.toLowerCase().includes(q));
  }, [exercises, search]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => a.name.localeCompare(b.name)), [filtered]);

  const openCreate = () => {
    setFormMode("create");
    setEditingExercise(null);
    setFormOpen(true);
  };

  const openEdit = (ex: Exercise) => {
    setFormMode("edit");
    setEditingExercise(ex);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
            Exercises
          </h1>
          <p className="text-sm text-muted-foreground">
            The shared exercise library used across templates and logged workouts
          </p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={openCreate} data-testid="button-new-exercise">
          <Plus className="h-3.5 w-3.5" />
          New Exercise
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search exercises..."
          className="pl-9"
          data-testid="input-search-exercises"
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!isLoading && sorted.length === 0 && (
        <div className="flex flex-col items-center text-center gap-3 py-16 text-muted-foreground">
          <Dumbbell className="h-8 w-8 text-muted-foreground/60" />
          <p>{search ? "No exercises match your search." : "No exercises yet."}</p>
        </div>
      )}

      <div className="space-y-3" data-testid="list-exercises">
        {sorted.map((ex) => (
          <Card key={ex.id} data-testid={`card-exercise-${ex.id}`}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
              <div className="min-w-0">
                <CardTitle className="text-base" data-testid={`text-exercise-name-${ex.id}`}>
                  {ex.name}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {ex.hasStimulusOverride && <Badge className="text-xs">Customized</Badge>}
                  {ex.stimulus.map((row, index) => (
                    <Badge key={row.muscleGroupId} variant={index === 0 ? "secondary" : "outline"} className="text-xs">
                      {row.displayName} {row.stimulusRatio.toFixed(2)}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-xs">{ex.equipment}</Badge>
                  {ex.isCompound && <Badge variant="outline" className="text-xs">Compound</Badge>}
                  {ex.isUnilateral && <Badge variant="outline" className="text-xs">Unilateral</Badge>}
                  {ex.trackingMode === "duration" && <Badge variant="outline" className="text-xs">Static hold</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEdit(ex)}
                  data-testid={`button-edit-exercise-${ex.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeletingExercise(ex)}
                  data-testid={`button-delete-exercise-${ex.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <ExerciseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        initial={formMode === "edit" ? editingExercise : null}
        muscleGroups={muscleGroups ?? []}
        onSaved={setEditingExercise}
        showUnilateral={activeUser?.trainingLevel === "advanced"}
        showAdvanced={activeUser?.trainingLevel === "advanced"}
      />

      <DeleteExerciseDialog exercise={deletingExercise} onOpenChange={(open) => { if (!open) setDeletingExercise(null); }} />
    </div>
  );
}
