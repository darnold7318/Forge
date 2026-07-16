import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dumbbell, Plus, Pencil, Trash2, Search } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { equipmentTypes, type Equipment, type MuscleGroup, type ExerciseWithParsedMuscles } from "@shared/schema";

type Exercise = ExerciseWithParsedMuscles;
type MuscleGroupWithDisplay = MuscleGroup & { displayName: string };

interface ExerciseFormState {
  name: string;
  primaryMuscleGroupId: string;
  secondaryMuscles: number[];
  equipment: Equipment;
  isCompound: boolean;
  isUnilateral: boolean;
}

const emptyForm: ExerciseFormState = {
  name: "",
  primaryMuscleGroupId: "",
  secondaryMuscles: [],
  equipment: "Barbell",
  isCompound: false,
  isUnilateral: false,
};

function toFormState(ex: Exercise): ExerciseFormState {
  return {
    name: ex.name,
    primaryMuscleGroupId: String(ex.primaryMuscleGroupId),
    secondaryMuscles: ex.secondaryMuscles,
    equipment: ex.equipment as Equipment,
    isCompound: ex.isCompound,
    isUnilateral: ex.isUnilateral,
  };
}

function ExerciseFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  muscleGroups,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: Exercise | null;
  muscleGroups: MuscleGroupWithDisplay[];
  onSaved: (ex: Exercise) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ExerciseFormState>(initial ? toFormState(initial) : emptyForm);

  // Reset form whenever the dialog is opened for a (possibly different) exercise.
  const [lastInitialId, setLastInitialId] = useState<number | null | undefined>(undefined);
  if (open && initial?.id !== lastInitialId) {
    setLastInitialId(initial?.id ?? null);
    setForm(initial ? toFormState(initial) : emptyForm);
  }

  const toggleSecondary = (id: number) => {
    setForm((prev) => ({
      ...prev,
      secondaryMuscles: prev.secondaryMuscles.includes(id)
        ? prev.secondaryMuscles.filter((x) => x !== id)
        : [...prev.secondaryMuscles, id],
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        primaryMuscleGroupId: Number(form.primaryMuscleGroupId),
        secondaryMuscles: form.secondaryMuscles,
        equipment: form.equipment,
        movementPattern: initial?.movementPattern ?? null,
        isCompound: form.isCompound,
        isUnilateral: form.isUnilateral,
      };
      const res =
        mode === "create"
          ? await apiRequest("POST", "/api/exercises", payload)
          : await apiRequest("PATCH", `/api/exercises/${initial!.id}`, payload);
      return res.json();
    },
    onSuccess: (ex: Exercise) => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
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

  const canSave = form.name.trim().length > 0 && form.primaryMuscleGroupId !== "" && !saveMutation.isPending;

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
          <div className="space-y-1.5">
            <Label>Primary muscle group</Label>
            <Select
              value={form.primaryMuscleGroupId}
              onValueChange={(v) => setForm((p) => ({ ...p, primaryMuscleGroupId: v }))}
            >
              <SelectTrigger data-testid="select-exercise-primary-muscle">
                <SelectValue placeholder="Select primary muscle" />
              </SelectTrigger>
              <SelectContent>
                {muscleGroups.map((mg) => (
                  <SelectItem key={mg.id} value={String(mg.id)}>
                    {mg.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Secondary muscles (optional)</Label>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 border rounded-md">
              {muscleGroups
                .filter((mg) => String(mg.id) !== form.primaryMuscleGroupId)
                .map((mg) => (
                  <Badge
                    key={mg.id}
                    variant={form.secondaryMuscles.includes(mg.id) ? "default" : "outline"}
                    className="cursor-pointer select-none"
                    onClick={() => toggleSecondary(mg.id)}
                    data-testid={`badge-exercise-secondary-muscle-${mg.id}`}
                  >
                    {mg.displayName}
                  </Badge>
                ))}
            </div>
          </div>
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
            <div className="flex items-center gap-2">
              <Checkbox
                id="ex-is-unilateral"
                checked={form.isUnilateral}
                onCheckedChange={(v) => setForm((p) => ({ ...p, isUnilateral: Boolean(v) }))}
                data-testid="checkbox-exercise-is-unilateral"
              />
              <Label htmlFor="ex-is-unilateral" className="cursor-pointer">Unilateral</Label>
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

  const muscleGroupLookup = useMemo(() => {
    const m = new Map<number, string>();
    for (const mg of muscleGroups ?? []) m.set(mg.id, mg.displayName);
    return m;
  }, [muscleGroups]);

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
                  <Badge variant="secondary" className="text-xs">
                    {muscleGroupLookup.get(ex.primaryMuscleGroupId) ?? "Unknown"}
                  </Badge>
                  {ex.secondaryMuscles.map((id) => (
                    <Badge key={id} variant="outline" className="text-xs">
                      {muscleGroupLookup.get(id) ?? "Unknown"}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-xs">{ex.equipment}</Badge>
                  {ex.isCompound && <Badge variant="outline" className="text-xs">Compound</Badge>}
                  {ex.isUnilateral && <Badge variant="outline" className="text-xs">Unilateral</Badge>}
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
        onSaved={() => {}}
      />

      <DeleteExerciseDialog exercise={deletingExercise} onOpenChange={(open) => { if (!open) setDeletingExercise(null); }} />
    </div>
  );
}
