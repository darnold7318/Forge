import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExerciseView } from "@shared/schema";

interface HistorySet {
  id: number;
  workoutId: number;
  weight: number;
  reps: number;
  durationSeconds: number | null;
  rir: number | null;
  isWarmup: boolean;
  workoutDate: string;
  isPr?: boolean;
}

export function ExerciseHistory({ exercise, excludeWorkoutId }: {
  exercise: Pick<ExerciseView, "id" | "trackingMode" | "equipment">;
  excludeWorkoutId?: number;
}) {
  const exerciseId = exercise.id;
  const { activeUserId } = useActiveUser();
  const { data, isLoading, isError, refetch } = useQuery<HistorySet[]>({
    queryKey: ["/api/exercises", String(exerciseId), "sets", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/exercises/${exerciseId}/sets`);
      return res.json();
    },
    enabled: activeUserId != null,
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (isError) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>Could not load previous sessions.</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }

  // Group by workoutId, take last 3 sessions (most recent first).
  const byWorkout = new Map<number, HistorySet[]>();
  for (const set of data ?? []) {
    if (set.workoutId === excludeWorkoutId) continue;
    if (!byWorkout.has(set.workoutId)) byWorkout.set(set.workoutId, []);
    byWorkout.get(set.workoutId)!.push(set);
  }
  const sessions = Array.from(byWorkout.entries())
    .sort((a, b) => (b[1][0]?.workoutDate ?? "").localeCompare(a[1][0]?.workoutDate ?? ""))
    .slice(0, 3);

  if (sessions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="text-no-history">
        No previous sessions for this exercise yet.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="section-exercise-history">
      <p className="text-xs font-medium text-muted-foreground">Last 3 sessions</p>
      {sessions.map(([workoutId, sets]) => (
        <div key={workoutId} className="flex items-start justify-between gap-2 text-xs">
          <span className="text-muted-foreground shrink-0">{formatDate(sets[0].workoutDate)}</span>
          <div className="flex flex-wrap justify-end gap-1">
            {sets
              .filter((set) => !set.isWarmup)
              .map((set) => (
                <span
                  key={set.id}
                  className={cn(
                    "tabular-nums font-mono rounded px-1.5 py-0.5 inline-flex items-center gap-1",
                    set.isPr ? "bg-primary/15 text-primary font-semibold" : "bg-muted",
                  )}
                  data-testid={`text-history-set-${set.id}`}
                >
                  {set.isPr && <Trophy className="h-3 w-3" data-testid={`icon-pr-badge-${set.id}`} />}
                  {exercise.trackingMode === "duration"
                    ? `${set.durationSeconds ?? 0} sec${
                        set.weight > 0
                          ? exercise.equipment === "Bodyweight" ? ` @ +${set.weight} lb` : ` @ ${set.weight} lb`
                          : ""
                      }`
                    : `${set.weight}×${set.reps}`}
                  {set.rir != null ? ` @${set.rir}RIR` : ""}
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
