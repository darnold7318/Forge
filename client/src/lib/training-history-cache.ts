import type { QueryClient } from "@tanstack/react-query";

// Any completed-workout or set mutation can change all of these views. The
// app caches queries indefinitely, so each history mutation must explicitly
// mark every derived result stale or recovery/volume/coaching can continue to
// show calculations from a workout that was edited or deleted.
const trainingHistoryQueryRoots = [
  "/api/workouts",
  "/api/advanced-trainer/state",
  "/api/dashboard",
  "/api/recovery",
  "/api/volume-tracker",
  "/api/coach/suggestions",
  "/api/coach/fatigue-trend",
  "/api/coach/personal-records",
  "/api/coach/settings",
  "/api/progress/tracked-exercises",
  "/api/exercises",
] as const;

export async function invalidateTrainingHistoryQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    trainingHistoryQueryRoots.map((root) => queryClient.invalidateQueries({ queryKey: [root] })),
  );
}
