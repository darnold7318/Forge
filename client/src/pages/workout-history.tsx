import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, Dumbbell, Pencil, Plane, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GuidedSessionPlan } from "@shared/guided-workout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { invalidateTrainingHistoryQueries } from "@/lib/training-history-cache";
import { useToast } from "@/hooks/use-toast";
import type { PlannedAbsenceReasonId, WorkoutCompletionReasonId } from "@shared/schema";

interface Exercise {
  id: number;
  name: string;
}

interface SetWithExercise {
  id: number;
  exerciseId: number;
  weight: number;
  reps: number;
  isWarmup: boolean;
  exercise: Exercise;
}

interface WorkoutWithSets {
  id: number;
  date: string;
  name: string | null;
  sets: SetWithExercise[];
  advancedTrainer?: GuidedSessionPlan["advancedTrainer"];
  plannedWorkingSets: number | null;
  completedWorkingSets: number | null;
  completionReason: WorkoutCompletionReasonId | null;
  completionNote: string | null;
}

interface TrainingAbsence {
  id: number;
  startDate: string;
  endDate: string;
  reason: PlannedAbsenceReasonId;
  note: string | null;
  cycleBehavior: "keep_running";
}

const ABSENCE_LABELS: Record<PlannedAbsenceReasonId, string> = { travel: "Travel / vacation", time: "Time or schedule", fatigue: "Fatigue / recovery", illness: "Illness", pain: "Pain / injury", equipment: "No equipment", deload: "Intentional recovery", other: "Other" };
const COMPLETION_LABELS: Record<WorkoutCompletionReasonId, string> = { time: "Time limit", fatigue: "Too fatigued", pain: "Pain / discomfort", equipment: "Equipment unavailable", intentional: "Intentional cut", other: "Other" };

function formatDate(dateStr: string) {
  // Civil dates (YYYY-MM-DD) are calendar days, not instants: pin the
  // formatter to UTC so a workout logged on the 16th never renders as the
  // 15th for viewers west of UTC.
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const d = new Date(civil ? `${dateStr}T00:00:00Z` : dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(civil ? { timeZone: "UTC" } : {}),
  });
}

function WorkoutRow({ workout, onDelete, onEditReason }: { workout: WorkoutWithSets; onDelete: () => void; onEditReason: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const workingSets = workout.sets.filter((s) => !s.isWarmup);
  const exerciseNames = Array.from(new Set(workout.sets.map((s) => s.exercise.name)));
  const exerciseCount = exerciseNames.length;

  return (
    <Card data-testid={`card-workout-${workout.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/history/${workout.id}`}
            className="flex-1 min-w-0 flex items-center gap-3"
            data-testid={`link-workout-detail-${workout.id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium truncate" data-testid={`text-workout-name-${workout.id}`}>
                  {workout.name || "Workout"}
                </p>
                <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                  <CalendarDays className="h-3 w-3" />
                  {formatDate(workout.date)}
                </span>
              </div>
              {workout.advancedTrainer && <Badge variant="outline" className="mt-1 text-xs">Cycle #{workout.advancedTrainer.cycleId} · week {workout.advancedTrainer.weekNumber} · {workout.advancedTrainer.phase}</Badge>}
              {workout.completionReason && <Badge variant="secondary" className="mt-1 text-xs">Ended early · {COMPLETION_LABELS[workout.completionReason]}</Badge>}
              <p className="text-sm text-muted-foreground truncate mt-1" data-testid={`text-workout-summary-${workout.id}`}>
                {exerciseCount > 0
                  ? `${exerciseNames.slice(0, 3).join(", ")}${exerciseCount > 3 ? ` +${exerciseCount - 3} more` : ""}`
                  : "No sets logged"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1" data-testid={`text-workout-set-count-${workout.id}`}>
                <Dumbbell className="h-3 w-3" />
                {workingSets.length} working {workingSets.length === 1 ? "set" : "sets"}
                {workout.sets.length !== workingSets.length ? ` · ${workout.sets.length - workingSets.length} warm-up` : ""}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </Link>
          {workout.completionReason && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onEditReason}
              aria-label="Edit workout completion reason"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive shrink-0"
            onClick={() => setConfirmOpen(true)}
            aria-label="Delete workout"
            data-testid={`button-delete-workout-${workout.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {workout.name || "this workout"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workout and all {workout.sets.length} logged{" "}
              {workout.sets.length === 1 ? "set" : "sets"} from {formatDate(workout.date)}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-workout-${workout.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmOpen(false);
                onDelete();
              }}
              data-testid={`button-confirm-delete-workout-${workout.id}`}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function WorkoutHistory() {
  const { toast } = useToast();
  const [editingAbsence, setEditingAbsence] = useState<TrainingAbsence | null>(null);
  const [editingWorkout, setEditingWorkout] = useState<WorkoutWithSets | null>(null);
  const [editReason, setEditReason] = useState<string>("");
  const [editNote, setEditNote] = useState("");

  const { data: workouts, isLoading } = useQuery<WorkoutWithSets[]>({
    queryKey: ["/api/workouts"],
  });

  const { data: absences, isLoading: absencesLoading } = useQuery<TrainingAbsence[]>({ queryKey: ["/api/training-exceptions"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/workouts/${id}`);
    },
    onSuccess: async () => {
      await invalidateTrainingHistoryQueries(queryClient);
      toast({ title: "Workout deleted" });
    },
    onError: () => toast({ title: "Couldn't delete workout", variant: "destructive" }),
  });

  const correctionMutation = useMutation({
    mutationFn: async () => {
      if (editingAbsence) return (await apiRequest("PATCH", `/api/training-exceptions/planned-absence/${editingAbsence.id}`, { startDate: editingAbsence.startDate, endDate: editingAbsence.endDate, reason: editReason, note: editNote.trim() || null, cycleBehavior: "keep_running" })).json();
      if (editingWorkout) return (await apiRequest("PATCH", `/api/workouts/${editingWorkout.id}/completion-context`, { reason: editReason, note: editNote.trim() || null })).json();
    },
    onSuccess: async () => {
      await invalidateTrainingHistoryQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["/api/training-exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      setEditingAbsence(null); setEditingWorkout(null);
      toast({ title: "Training exception updated" });
    },
    onError: (error: Error) => toast({ title: "Couldn't update reason", description: error.message, variant: "destructive" }),
  });

  const deleteAbsenceMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/training-exceptions/planned-absence/${id}`),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["/api/training-exceptions"] }); queryClient.invalidateQueries({ queryKey: ["/api/schedule"] }); toast({ title: "Planned absence removed" }); },
    onError: (error: Error) => toast({ title: "Couldn't remove planned absence", description: error.message, variant: "destructive" }),
  });

  const timeline = [
    ...(workouts ?? []).map((workout) => ({ type: "workout" as const, date: workout.date, workout })),
    ...(absences ?? []).map((absence) => ({ type: "absence" as const, date: absence.startDate, absence })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (b.type === "workout" ? 1 : -1));

  const openAbsence = (absence: TrainingAbsence) => { setEditingWorkout(null); setEditingAbsence(absence); setEditReason(absence.reason); setEditNote(absence.note ?? ""); };
  const openWorkout = (workout: WorkoutWithSets) => { setEditingAbsence(null); setEditingWorkout(workout); setEditReason(workout.completionReason ?? "time"); setEditNote(workout.completionNote ?? ""); };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold" data-testid="text-page-title">
          Workout History
        </h1>
        <p className="text-sm text-muted-foreground">View, edit, or delete your past workouts</p>
      </div>

      {isLoading || absencesLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : timeline.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground" data-testid="text-no-workouts">
              No workouts logged yet. Head to Log Workout to record your first session.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-workout-history">
          {timeline.map((item) => item.type === "workout" ? <WorkoutRow key={`workout-${item.workout.id}`} workout={item.workout} onDelete={() => deleteMutation.mutate(item.workout.id)} onEditReason={() => openWorkout(item.workout)} /> : <Card key={`absence-${item.absence.id}`} className="border-dashed" data-testid={`card-absence-${item.absence.id}`}><CardContent className="flex items-center gap-3 p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Plane className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="font-medium">Planned absence</p><p className="text-xs text-muted-foreground">{formatDate(item.absence.startDate)}{item.absence.endDate !== item.absence.startDate ? ` – ${formatDate(item.absence.endDate)}` : ""}</p><div className="mt-1 flex flex-wrap gap-1"><Badge variant="secondary">{ABSENCE_LABELS[item.absence.reason]}</Badge><Badge variant="outline">Cycle kept running</Badge></div>{item.absence.note && <p className="mt-1 text-xs text-muted-foreground">{item.absence.note}</p>}</div><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => openAbsence(item.absence)} aria-label="Edit planned absence"><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteAbsenceMutation.mutate(item.absence.id)} aria-label="Delete planned absence"><Trash2 className="h-4 w-4" /></Button></div></CardContent></Card>)}
        </div>
      )}

      <Dialog open={editingAbsence != null || editingWorkout != null} onOpenChange={(open) => { if (!open) { setEditingAbsence(null); setEditingWorkout(null); } }}>
        <DialogContent><DialogHeader><DialogTitle>Edit training exception</DialogTitle><DialogDescription>Correct the explanation without rewriting workouts, sets, or mesocycle dates.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{(editingAbsence ? Object.entries(ABSENCE_LABELS) : Object.entries(COMPLETION_LABELS)).map(([id, label]) => <Button key={id} type="button" size="sm" variant={editReason === id ? "default" : "outline"} className="h-auto min-h-10 whitespace-normal" onClick={() => setEditReason(id)}>{label}</Button>)}</div>{editingAbsence && <div className="grid grid-cols-2 gap-2"><Input type="date" value={editingAbsence.startDate} onChange={(event) => setEditingAbsence({ ...editingAbsence, startDate: event.target.value })} /><Input type="date" min={editingAbsence.startDate} value={editingAbsence.endDate} onChange={(event) => setEditingAbsence({ ...editingAbsence, endDate: event.target.value })} /></div>}<Textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} maxLength={500} placeholder="Optional note" /></div><DialogFooter><Button variant="outline" onClick={() => { setEditingAbsence(null); setEditingWorkout(null); }}>Cancel</Button><Button disabled={!editReason || correctionMutation.isPending || Boolean(editingAbsence && editingAbsence.endDate < editingAbsence.startDate)} onClick={() => correctionMutation.mutate()}>{correctionMutation.isPending ? "Saving…" : "Save correction"}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
