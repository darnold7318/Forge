import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { exerciseRoles, failureTargets, type ExerciseRole, type FailureTarget } from "@shared/schema";

interface WorkoutTemplateExercise {
  id: number;
  exerciseId: number;
  exerciseOrder: number;
  exerciseRole: ExerciseRole;
  warmupSets: number;
  topSets: number;
  backoffSets: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRir: number;
  failureTarget: FailureTarget;
  restSeconds: number;
}

interface WorkoutTemplateFull {
  id: number;
  name: string;
  notes: string | null;
  exercises: WorkoutTemplateExercise[];
}

interface Exercise {
  id: number;
  name: string;
  primaryMuscleGroupId: number;
}

interface MuscleGroup {
  id: number;
  name: string;
}

function useDebouncedCallback<T extends (...args: any[]) => void>(fn: T, delay = 450) {
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => fn(...args), delay);
    setTimer(t);
  };
}

function ExerciseRow({
  te,
  exerciseName,
  onUpdate,
  onRemove,
}: {
  te: WorkoutTemplateExercise;
  exerciseName: string;
  onUpdate: (patch: Partial<WorkoutTemplateExercise>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: te.id,
  });
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border bg-card p-3 space-y-3"
      data-testid={`row-editor-exercise-${te.id}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab text-muted-foreground touch-none"
          aria-label="Drag to reorder"
          data-testid={`button-drag-exercise-${te.id}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium truncate" data-testid={`text-exercise-name-${te.id}`}>
              {exerciseName}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setExpanded((e) => !e)}
                data-testid={`button-toggle-advanced-${te.id}`}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => setConfirmOpen(true)}
                data-testid={`button-remove-exercise-${te.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Role</Label>
              <Select
                value={te.exerciseRole}
                onValueChange={(v) => onUpdate({ exerciseRole: v as ExerciseRole })}
              >
                <SelectTrigger className="h-8 text-xs" data-testid={`select-role-${te.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {exerciseRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Sets</Label>
              <Input
                type="number"
                min={1}
                className="h-8 text-xs"
                defaultValue={te.targetSets}
                onChange={(e) => onUpdate({ targetSets: Number(e.target.value) || 1 })}
                data-testid={`input-target-sets-${te.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Reps min</Label>
              <Input
                type="number"
                min={1}
                className="h-8 text-xs"
                defaultValue={te.targetRepsMin}
                onChange={(e) => onUpdate({ targetRepsMin: Number(e.target.value) || 1 })}
                data-testid={`input-reps-min-${te.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Reps max</Label>
              <Input
                type="number"
                min={1}
                className="h-8 text-xs"
                defaultValue={te.targetRepsMax}
                onChange={(e) => onUpdate({ targetRepsMax: Number(e.target.value) || 1 })}
                data-testid={`input-reps-max-${te.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Target RIR</Label>
              <Input
                type="number"
                min={0}
                max={4}
                className="h-8 text-xs"
                defaultValue={te.targetRir}
                onChange={(e) => onUpdate({ targetRir: Number(e.target.value) || 0 })}
                data-testid={`input-target-rir-${te.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Rest (sec)</Label>
              <Input
                type="number"
                min={0}
                step={15}
                className="h-8 text-xs"
                defaultValue={te.restSeconds}
                onChange={(e) => onUpdate({ restSeconds: Number(e.target.value) || 0 })}
                data-testid={`input-rest-seconds-${te.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Failure target</Label>
              <Select
                value={te.failureTarget}
                onValueChange={(v) => onUpdate({ failureTarget: v as FailureTarget })}
              >
                <SelectTrigger className="h-8 text-xs" data-testid={`select-failure-target-${te.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {failureTargets.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {expanded && (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Warmup sets</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-8 text-xs"
                  defaultValue={te.warmupSets}
                  onChange={(e) => onUpdate({ warmupSets: Number(e.target.value) || 0 })}
                  data-testid={`input-warmup-sets-${te.id}`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Top sets</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-8 text-xs"
                  defaultValue={te.topSets}
                  onChange={(e) => onUpdate({ topSets: Number(e.target.value) || 0 })}
                  data-testid={`input-top-sets-${te.id}`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Backoff sets</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-8 text-xs"
                  defaultValue={te.backoffSets}
                  onChange={(e) => onUpdate({ backoffSets: Number(e.target.value) || 0 })}
                  data-testid={`input-backoff-sets-${te.id}`}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {exerciseName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the exercise from this template. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-remove-${te.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onRemove();
              }}
              data-testid={`button-confirm-remove-${te.id}`}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function TemplateEditor() {
  const params = useParams<{ id: string }>();
  const templateId = Number(params.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [localName, setLocalName] = useState<string | null>(null);
  const [localNotes, setLocalNotes] = useState<string | null>(null);

  const { data: template, isLoading } = useQuery<WorkoutTemplateFull>({
    queryKey: ["/api/workout-templates", String(templateId)],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workout-templates/${templateId}`);
      return res.json();
    },
    enabled: !Number.isNaN(templateId),
  });

  const { data: exercises } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });
  const { data: muscleGroups } = useQuery<MuscleGroup[]>({
    queryKey: ["/api/muscle-groups"],
  });

  const exerciseNameLookup = new Map<number, string>();
  for (const e of exercises ?? []) exerciseNameLookup.set(e.id, e.name);
  const muscleGroupNameLookup = new Map<number, string>();
  for (const mg of muscleGroups ?? []) muscleGroupNameLookup.set(mg.id, mg.name);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/workout-templates", String(templateId)] });
    queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
  };

  const patchTemplateMutation = useMutation({
    mutationFn: async (patch: { name?: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/workout-templates/${templateId}`, patch);
      return res.json();
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't save changes", variant: "destructive" }),
  });
  const debouncedPatchTemplate = useDebouncedCallback((patch: { name?: string; notes?: string }) =>
    patchTemplateMutation.mutate(patch),
  );

  const updateExerciseMutation = useMutation({
    mutationFn: async ({ teId, patch }: { teId: number; patch: Partial<WorkoutTemplateExercise> }) => {
      const res = await apiRequest("PATCH", `/api/workout-templates/${templateId}/exercises/${teId}`, patch);
      return res.json();
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't save exercise", variant: "destructive" }),
  });
  const debouncedUpdateExercise = useDebouncedCallback(
    (teId: number, patch: Partial<WorkoutTemplateExercise>) => updateExerciseMutation.mutate({ teId, patch }),
  );

  const removeExerciseMutation = useMutation({
    mutationFn: async (teId: number) => {
      await apiRequest("DELETE", `/api/workout-templates/${templateId}/exercises/${teId}`);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Exercise removed" });
    },
    onError: () => toast({ title: "Couldn't remove exercise", variant: "destructive" }),
  });

  const addExerciseMutation = useMutation({
    mutationFn: async (exerciseId: number) => {
      const res = await apiRequest("POST", `/api/workout-templates/${templateId}/exercises`, {
        exerciseId,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRir: 2,
        restSeconds: 90,
        exerciseRole: "Isolation",
        failureTarget: "Never",
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      toast({ title: "Exercise added" });
    },
    onError: () => toast({ title: "Couldn't add exercise", variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await apiRequest("POST", `/api/workout-templates/${templateId}/exercises/reorder`, { orderedIds });
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't save order", variant: "destructive" }),
  });

  const [deleteTemplateOpen, setDeleteTemplateOpen] = useState(false);
  const deleteTemplateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/workout-templates/${templateId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
      toast({ title: "Template deleted" });
      navigate("/templates");
    },
    onError: () => toast({ title: "Couldn't delete template", variant: "destructive" }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const sorted = template ? [...template.exercises].sort((a, b) => a.exerciseOrder - b.exerciseOrder) : [];
  const orderedIds = localOrder ?? sorted.map((te) => te.id);
  const orderedExercises = orderedIds
    .map((id) => sorted.find((te) => te.id === id))
    .filter((te): te is WorkoutTemplateExercise => Boolean(te));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sorted.map((te) => te.id);
    const oldIndex = ids.indexOf(active.id as number);
    const newIndex = ids.indexOf(over.id as number);
    const newOrder = arrayMove(ids, oldIndex, newIndex);
    setLocalOrder(newOrder);
    reorderMutation.mutate(newOrder);
  };

  if (isLoading || !template) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const usedExerciseIds = new Set(template.exercises.map((te) => te.exerciseId));
  const availableExercises = (exercises ?? [])
    .filter((e) => !usedExerciseIds.has(e.id))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id - b.id,
    );

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 -ml-2"
        onClick={() => navigate("/templates")}
        data-testid="button-back-to-templates"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Templates
      </Button>

      <Card data-testid="card-template-header">
        <CardHeader>
          <CardTitle className="text-base">Template Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              value={localName ?? template.name}
              onChange={(e) => {
                setLocalName(e.target.value);
                debouncedPatchTemplate({ name: e.target.value });
              }}
              data-testid="input-template-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea
              value={localNotes ?? template.notes ?? ""}
              placeholder="Optional notes about this template"
              onChange={(e) => {
                setLocalNotes(e.target.value);
                debouncedPatchTemplate({ notes: e.target.value });
              }}
              data-testid="textarea-template-notes"
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-template-exercises">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Exercises</CardTitle>
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" className="gap-1.5" data-testid="button-add-exercise">
                <Plus className="h-3.5 w-3.5" />
                Add Exercise
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <Command>
                <CommandInput placeholder="Search exercises..." data-testid="input-search-exercise" />
                <CommandList>
                  <CommandEmpty>No exercises found.</CommandEmpty>
                  <CommandGroup>
                    {availableExercises.map((e) => (
                      <CommandItem
                        key={e.id}
                        value={e.name}
                        onSelect={() => addExerciseMutation.mutate(e.id)}
                        data-testid={`option-add-exercise-${e.id}`}
                      >
                        <div className="flex flex-col">
                          <span>{e.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {muscleGroupNameLookup.get(e.primaryMuscleGroupId) ?? ""}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </CardHeader>
        <CardContent>
          {orderedExercises.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No exercises yet — add one to get started.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-2" data-testid="list-editor-exercises">
                  {orderedExercises.map((te) => (
                    <ExerciseRow
                      key={te.id}
                      te={te}
                      exerciseName={exerciseNameLookup.get(te.exerciseId) ?? `Exercise #${te.exerciseId}`}
                      onUpdate={(patch) => debouncedUpdateExercise(te.id, patch)}
                      onRemove={() => removeExerciseMutation.mutate(te.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-delete-template" className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Delete Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently deletes this template. Any schedule days already using it keep their label but
            will no longer link to a live template. This can't be undone.
          </p>
          <Button
            variant="destructive"
            className="gap-2"
            onClick={() => setDeleteTemplateOpen(true)}
            data-testid="button-delete-template"
          >
            <Trash2 className="h-4 w-4" />
            Delete Template
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={deleteTemplateOpen} onOpenChange={setDeleteTemplateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {localName ?? template.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this template and its exercise list. This can't be undone.
              If it's currently assigned to any day in a weekly schedule, that day will just be
              unassigned (its label stays, but it won't point to a template anymore).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-template">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setDeleteTemplateOpen(false);
                deleteTemplateMutation.mutate();
              }}
              disabled={deleteTemplateMutation.isPending}
              data-testid="button-confirm-delete-template"
            >
              {deleteTemplateMutation.isPending ? "Deleting..." : "Delete Template"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
