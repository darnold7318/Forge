import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Plus, ChevronRight, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Workout } from "@shared/schema";
import { formatDate, VOLUME_STATUS_BG, VOLUME_STATUS_LABEL } from "@/lib/format";

interface VolumeEntry {
  muscleGroupId: number;
  muscleGroupName: string;
  sets: number;
  mev: number;
  mav: number;
  mrv: number;
  status: "under" | "optimal" | "high" | "excessive";
}

interface DeloadResult {
  shouldDeload: boolean;
  reasons: { reason: string; detail: string }[];
}

function VolumeBar({ entry }: { entry: VolumeEntry }) {
  // Scale bar to MRV * 1.15 so overflow past MRV is still visible.
  const scaleMax = entry.mrv * 1.15;
  const pct = Math.min(100, (entry.sets / scaleMax) * 100);
  const mevPct = (entry.mev / scaleMax) * 100;
  const mavPct = (entry.mav / scaleMax) * 100;
  const mrvPct = (entry.mrv / scaleMax) * 100;

  return (
    <div className="space-y-1.5" data-testid={`row-volume-${entry.muscleGroupName.toLowerCase()}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{entry.muscleGroupName}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums" data-testid={`text-sets-${entry.muscleGroupName.toLowerCase()}`}>
            {entry.sets} sets
          </span>
          <Badge
            variant="outline"
            className={`text-xs ${
              entry.status === "optimal"
                ? "border-volume-optimal text-volume-optimal"
                : entry.status === "under"
                ? "border-volume-under text-volume-under"
                : entry.status === "high"
                ? "border-volume-high text-volume-high"
                : "border-volume-excessive text-volume-excessive"
            }`}
          >
            {VOLUME_STATUS_LABEL[entry.status]}
          </Badge>
        </div>
      </div>
      <div className="relative h-2.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${VOLUME_STATUS_BG[entry.status]}`}
          style={{ width: `${pct}%` }}
        />
        {/* MEV/MAV/MRV landmark ticks */}
        <div className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${mevPct}%` }} />
        <div className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${mavPct}%` }} />
        <div className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${mrvPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>MEV {entry.mev}</span>
        <span>MAV {entry.mav}</span>
        <span>MRV {entry.mrv}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: volume, isLoading: volumeLoading } = useQuery<VolumeEntry[]>({
    queryKey: ["/api/dashboard/volume"],
  });

  const { data: deload, isLoading: deloadLoading } = useQuery<DeloadResult>({
    queryKey: ["/api/coach/deload"],
  });

  const { data: workouts, isLoading: workoutsLoading } = useQuery<Workout[]>({
    queryKey: ["/api/workouts"],
  });

  const recentWorkouts = (workouts ?? []).slice(0, 5);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">This week's training at a glance</p>
        </div>
        <Link href="/log">
          <Button data-testid="button-start-workout">
            <Plus className="h-4 w-4" />
            Start Workout
          </Button>
        </Link>
      </div>

      {!deloadLoading && deload?.shouldDeload && (
        <Card className="border-destructive/40 bg-destructive/10" data-testid="banner-deload-alert">
          <CardContent className="p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-2 min-w-0">
              <p className="font-semibold text-sm">Consider a deload</p>
              <ul className="space-y-1">
                {deload.reasons.map((r, i) => (
                  <li key={i} className="text-sm text-muted-foreground" data-testid={`text-deload-reason-${i}`}>
                    <span className="font-medium text-foreground">{r.reason}:</span> {r.detail}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                Suggestion: reduce volume ~40-50% and/or intensity for 1 week before resuming normal training.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Weekly Volume by Muscle Group</CardTitle>
          <Link href="/volume" className="text-xs text-muted-foreground hover-elevate rounded-md px-2 py-1 flex items-center gap-0.5" data-testid="link-view-volume-tracker">
            Details <ChevronRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          {volumeLoading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          {!volumeLoading &&
            volume?.map((entry) => <VolumeBar key={entry.muscleGroupId} entry={entry} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-0">
          <CardTitle className="text-base">Recent Workouts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {workoutsLoading &&
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          {!workoutsLoading && recentWorkouts.length === 0 && (
            <div className="flex flex-col items-center text-center gap-3 py-10 text-muted-foreground">
              <Dumbbell className="h-8 w-8 text-muted-foreground/60" />
              <div>
                <p className="font-medium text-foreground">No workouts logged yet</p>
                <p className="text-sm">Start your first session to begin tracking volume and progress.</p>
              </div>
              <Link href="/log">
                <Button size="sm" data-testid="button-empty-start-workout">
                  <Plus className="h-4 w-4" />
                  Start Workout
                </Button>
              </Link>
            </div>
          )}
          {!workoutsLoading &&
            recentWorkouts.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-2 rounded-md border p-3"
                data-testid={`row-workout-${w.id}`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{w.name || "Workout"}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(w.date)}</p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
