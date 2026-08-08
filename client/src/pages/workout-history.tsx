import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, Dumbbell, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
}

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

function WorkoutRow({ workout, onDelete }: { workout: WorkoutWithSets; onDelete: () => void }) {
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

  const { data: workouts, isLoading } = useQuery<WorkoutWithSets[]>({
    queryKey: ["/api/workouts"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/workouts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/volume"] });
      toast({ title: "Workout deleted" });
    },
    onError: () => toast({ title: "Couldn't delete workout", variant: "destructive" }),
  });

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold" data-testid="text-page-title">
          Workout History
        </h1>
        <p className="text-sm text-muted-foreground">View, edit, or delete your past workouts</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !workouts || workouts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground" data-testid="text-no-workouts">
              No workouts logged yet. Head to Log Workout to record your first session.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-workout-history">
          {workouts.map((w) => (
            <WorkoutRow key={w.id} workout={w} onDelete={() => deleteMutation.mutate(w.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
