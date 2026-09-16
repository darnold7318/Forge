import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import type { AdvancedTrainerState } from "@shared/advanced-trainer";
import { targetRirForWeek } from "@shared/advanced-trainer";
import type { CoachSettings, TrainingGoalId, TrainingLevelId, WorkoutLoggingModeId } from "@shared/schema";
import { workoutLoggingModeLabels, trainingGoalLabels } from "@shared/schema";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

export function CoachTrainingContext() {
  const { activeUserId } = useActiveUser();
  const query = useQuery<{ goal: TrainingGoalId; experience: TrainingLevelId; loggingMode: WorkoutLoggingModeId;
    cycle: AdvancedTrainerState | null; settings: CoachSettings }>({
    queryKey: ["/api/coach/training-context", activeUserId],
    queryFn: async () => (await apiRequest("GET", "/api/coach/training-context")).json(), enabled: activeUserId != null,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
  });
  if (query.isLoading) return null;
  if (!query.data) return <p className="text-sm text-destructive">Could not load the settings Coach is using.</p>;
  const { goal, experience, loggingMode, cycle, settings } = query.data;
  const cycleActive = loggingMode === "advanced_guided";
  return <Card data-testid="card-coach-training-context"><CardContent className="space-y-2 p-4">
    <p className="text-sm font-medium">Coach is using your app settings</p>
    <div className="flex flex-wrap gap-2"><Badge variant="outline">{trainingGoalLabels[goal]}</Badge><Badge variant="outline">{experience}</Badge><Badge variant="outline">{workoutLoggingModeLabels[loggingMode]}</Badge><Badge variant="outline">Progression: {settings.progressionStyle}</Badge></div>
    <p className="text-xs text-muted-foreground">Targets combine your template, progression policy, recovery and muscle overrides, exercise stimulus, and available equipment. A session time budget may trim lower-priority work from these targets.</p>
    {cycleActive && <p className="text-sm">{!cycle ? "Mesocycle awaiting explicit start. Recommendations below are baseline targets."
      : cycle.phase === "review" ? `Cycle #${cycle.cycleId} is ready for review. Prepare and explicitly start your next cycle before training.`
      : `Cycle #${cycle.cycleId} · ${cycle.phase} week ${cycle.weekNumber}/${cycle.totalWeeks} · RIR ${targetRirForWeek(cycle.settings, cycle.weekNumber)}–${Math.min(5, targetRirForWeek(cycle.settings, cycle.weekNumber) + 1)} before recovery adjustments.`}</p>}
    {cycleActive && cycle && <p className="text-xs text-muted-foreground">Started {cycle.startedOn}. The active settings snapshot controls this block; changes saved for the next cycle do not alter it.</p>}
    <div className="flex gap-4 text-xs"><Link href="/settings" className="underline">Training settings</Link>{cycleActive && <Link href="/log" className="underline">Mesocycle and session plan</Link>}</div>
  </CardContent></Card>;
}
