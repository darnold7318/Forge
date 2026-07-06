import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useActiveUser } from "@/lib/user-context";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, Plus, ChevronRight, Dumbbell, Flame, TrendingUp, Trophy, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardSnapshot } from "@shared/coaching";

const FATIGUE_STATUS_STYLE: Record<string, string> = {
  Learning: "border-muted-foreground/40 text-muted-foreground",
  Stable: "border-volume-optimal text-volume-optimal",
  "Watch Trend": "border-volume-high text-volume-high",
  "Fatigue Risk": "border-destructive text-destructive",
};

const RECOMMENDATION_STYLE: Record<string, string> = {
  "Increase Weight": "border-volume-optimal text-volume-optimal",
  "Optional Increase": "border-volume-optimal text-volume-optimal",
  "Repeat Weight": "border-muted-foreground/40 text-muted-foreground",
  "Repeat Or Reduce": "border-volume-high text-volume-high",
  "Hold Weight": "border-volume-high text-volume-high",
  "Hold Progression": "border-volume-high text-volume-high",
  "Reduce Or Delay": "border-destructive text-destructive",
  "Start Conservative": "border-muted-foreground/40 text-muted-foreground",
};

function recommendationStyle(rec: string) {
  return RECOMMENDATION_STYLE[rec] ?? "border-muted-foreground/40 text-muted-foreground";
}

export default function Dashboard() {
  const { activeUserId } = useActiveUser();
  const { data: snapshot, isLoading } = useQuery<DashboardSnapshot>({
    queryKey: ["/api/dashboard", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">Today's training at a glance</p>
        </div>
        <Link href="/log">
          <Button data-testid="button-start-workout">
            <Plus className="h-4 w-4" />
            Start Workout
          </Button>
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!isLoading && snapshot && (
        <>
          {snapshot.workoutStatus === "Deload Suggested" && (
            <Card className="border-destructive/40 bg-destructive/10" data-testid="banner-deload-alert">
              <CardContent className="p-4 flex gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="font-semibold text-sm">Deload Suggested</p>
                  <p className="text-sm text-muted-foreground" data-testid="text-fatigue-summary">
                    {snapshot.fatigueText}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-todays-workout">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-base truncate" data-testid="text-todays-workout-name">
                  {snapshot.todaysWorkoutName}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-last-workout">
                  {snapshot.lastWorkoutText}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0" data-testid="badge-workout-status">
                {snapshot.workoutStatus}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground" data-testid="text-recovery-summary">
                {snapshot.recoveryText}
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span data-testid="text-estimated-duration">{snapshot.estimatedDurationMinutes} min</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Dumbbell className="h-4 w-4 text-muted-foreground" />
                  <span data-testid="text-exercise-count">{snapshot.exerciseCount} exercises</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <span data-testid="text-completed-workouts">{snapshot.completedWorkouts} logged</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-fatigue-trend">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <Flame className="h-4 w-4" />
                Fatigue Trend
              </CardTitle>
              <Badge
                variant="outline"
                className={FATIGUE_STATUS_STYLE[snapshot.fatigueStatus] ?? ""}
                data-testid="badge-fatigue-status"
              >
                {snapshot.fatigueStatus}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground" data-testid="text-fatigue-text">
                {snapshot.fatigueText}
              </p>
              <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    snapshot.fatigueRiskScore >= 70
                      ? "bg-destructive"
                      : snapshot.fatigueRiskScore >= 45
                      ? "bg-volume-high"
                      : "bg-volume-optimal"
                  }`}
                  style={{ width: `${snapshot.fatigueRiskScore}%` }}
                  data-testid="bar-fatigue-risk"
                />
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-recent-achievement">
            <CardContent className="p-4 flex gap-3 items-start">
              <Trophy className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm" data-testid="text-recent-achievement">
                {snapshot.recentAchievementText}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Muscle Recovery</CardTitle>
              <Link
                href="/recovery"
                className="text-xs text-muted-foreground hover-elevate rounded-md px-2 py-1 flex items-center gap-0.5"
                data-testid="link-view-recovery-map"
              >
                Full Map <ChevronRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {snapshot.muscleFatigueMap
                  .slice()
                  .sort((a, b) => b.fatiguePercent - a.fatiguePercent)
                  .slice(0, 6)
                  .map((m) => (
                    <div
                      key={m.muscleName}
                      className="rounded-md border p-2.5 space-y-1"
                      data-testid={`row-recovery-${m.muscleName.toLowerCase()}`}
                    >
                      <p className="text-xs font-medium truncate">{m.displayName}</p>
                      <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full ${
                            m.status === "Needs Rest"
                              ? "bg-destructive"
                              : m.status === "Recovering"
                              ? "bg-volume-high"
                              : "bg-volume-optimal"
                          }`}
                          style={{ width: `${m.fatiguePercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{m.recoveryPercent}% recovered</p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {snapshot.suggestions.length > 0 && (
            <Card data-testid="card-exercise-suggestions">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">Today's Suggestions</CardTitle>
                <Link
                  href="/coach"
                  className="text-xs text-muted-foreground hover-elevate rounded-md px-2 py-1 flex items-center gap-0.5"
                  data-testid="link-view-coach"
                >
                  Full Coach <ChevronRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {snapshot.suggestions.map((s) => (
                  <div
                    key={s.exerciseId}
                    className="rounded-md border p-3 space-y-1.5"
                    data-testid={`row-suggestion-${s.exerciseId}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="font-medium text-sm truncate" data-testid={`text-suggestion-exercise-${s.exerciseId}`}>
                        {s.exerciseName}
                      </p>
                      <Badge variant="outline" className={recommendationStyle(s.recommendation)}>
                        {s.recommendation}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{s.suggestedGoal}</p>
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
