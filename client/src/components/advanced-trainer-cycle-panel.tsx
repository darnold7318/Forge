import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { advancedCycleDates, targetRirForWeek, type AdvancedTrainerOverview } from "@shared/advanced-trainer";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import { AdvancedTrainerSettingsEditor } from "./advanced-trainer-settings";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

export function AdvancedTrainerCyclePanel() {
  const { activeUserId } = useActiveUser();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<"start" | "align" | "undo" | null>(null);
  const queryKey = ["/api/advanced-trainer/state", activeUserId];
  const query = useQuery<AdvancedTrainerOverview>({
    queryKey,
    queryFn: async () => (await apiRequest("GET", "/api/advanced-trainer/state")).json(),
    enabled: activeUserId != null, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationFn: async (action: "start" | "align" | "undo") => {
      const value = query.data;
      if (!value) throw new Error("Refresh cycle status first.");
      const endpoint = action === "start" ? "/api/advanced-trainer/cycles"
        : `/api/advanced-trainer/cycles/${value.state?.cycleId}/${action === "align" ? "align-start" : "undo-start"}`;
      return (await apiRequest("POST", endpoint, action === "start" ? {} : {
        expectedStartedOn: value.state?.startedOn,
        ...(action === "align" ? { workoutId: value.alignment.workoutId } : { changeId: value.undo.changeId }),
      })).json() as Promise<AdvancedTrainerOverview>;
    },
    onSuccess: (overview, action) => {
      queryClient.setQueryData(queryKey, overview);
      queryClient.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
      toast({ title: action === "start" ? "Mesocycle started" : action === "align" ? "Start aligned to first workout" : "Previous start restored",
        description: "Your saved workout plans and sets are unchanged." });
      setConfirm(null);
    },
    onError: (error: Error) => {
      toast({ title: "Cycle update blocked", description: error.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey });
    },
  });
  if (query.isLoading) return <Skeleton className="h-48 w-full" />;
  if (!query.data || query.isError) return <Card><CardContent className="space-y-2 p-4"><p>Could not load mesocycle status.</p><Button variant="outline" onClick={() => query.refetch()}>Retry</Button></CardContent></Card>;
  const { state, settings, dates, workouts, alignment, dateChanges, undo } = query.data;
  const completed = workouts.filter((workout) => workout.status === "completed");
  const groups = Array.from(new Set(workouts.map((workout) => workout.weekNumber))).sort((a, b) => a - b);
  const changeDate = confirm === "align" ? alignment.date : confirm === "undo" ? dateChanges[0]?.previousStartedOn : dates.startedOn;
  const preview = changeDate ? advancedCycleDates(changeDate, state?.settings ?? settings) : dates;
  const rir = state ? targetRirForWeek(state.settings, state.weekNumber) : settings.startRir;
  return <>
    <Card className="border-primary/30" data-testid="card-mesocycle-status">
      <CardHeader><CardTitle className="text-base">{!state ? "Mesocycle awaiting start" : state.phase === "review" ? "Mesocycle ready for review" : `Cycle #${state.cycleId} · ${state.phase === "deload" ? "Deload" : "Accumulation"}`}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {state && <Badge>Week {state.weekNumber} of {state.totalWeeks}</Badge>}
          {state && <Badge variant="outline">{completed.length} completed workouts linked</Badge>}
          {state?.phase !== "review" && <Badge variant="outline">Target RIR {rir}–{Math.min(5, rir + 1)}</Badge>}
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <p>{state ? "Started" : "Proposed start"}<br /><span className="font-medium">{dates.startedOn}</span></p>
          <p>Deload begins<br /><span className="font-medium">{dates.deloadOn}</span></p>
          <p>Review opens<br /><span className="font-medium">{dates.reviewOn}</span></p>
        </div>
        <p className="text-xs text-muted-foreground">{state ? "Weeks follow calendar days from your start date. Missed workouts do not pause the clock. Each workout keeps the week and phase saved when it started." : "Opening this trainer does not start the clock. Save any settings below, then explicitly start when you are ready to train."}</p>
        {!state && <><AdvancedTrainerSettingsEditor /><Button disabled={mutation.isPending} onClick={() => setConfirm("start")} data-testid="button-start-mesocycle">Start mesocycle</Button></>}
        {state?.phase === "review" && <AdvancedTrainerSettingsEditor reviewCycleId={state.cycleId} />}
        {state && <details open={workouts.length > 0}><summary className="cursor-pointer text-sm font-medium">Workouts counted toward this cycle</summary>
          <div className="mt-3 space-y-3">{groups.length === 0 && <p className="text-xs text-muted-foreground">No workouts linked yet.</p>}{groups.map((week) => <div key={week}>
            <p className="text-xs font-medium">Week {week} · {workouts.find((workout) => workout.weekNumber === week)?.phase}</p>
            {workouts.filter((workout) => workout.weekNumber === week).map((workout) => <div key={workout.id} className="mt-1 flex flex-wrap justify-between gap-1 rounded border p-2 text-xs">
              {workout.status === "completed" ? <Link href={`/history/${workout.id}`} className="underline">{workout.name ?? "Workout"}</Link> : <span>{workout.name ?? "Workout"} · in progress</span>}
              <span>{workout.date} · {workout.workingSets} working sets</span>
            </div>)}
          </div>)}</div></details>}
        {state && <details><summary className="cursor-pointer text-sm font-medium">Start-date correction</summary><div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">{alignment.reason}</p>
          {alignment.eligible && <Button variant="outline" disabled={mutation.isPending} onClick={() => setConfirm("align")} data-testid="button-align-mesocycle-start">Use first workout date ({alignment.date})</Button>}
          {dateChanges.map((change) => <p key={change.id} className="text-xs text-muted-foreground">{change.previousStartedOn} → {change.newStartedOn} · {change.undoOfChangeId ? "undo" : "correction"} · {change.changedAt}</p>)}
          {undo.eligible ? <Button variant="outline" disabled={mutation.isPending} onClick={() => setConfirm("undo")}>Undo start correction</Button> : dateChanges.length > 0 && <p className="text-xs text-muted-foreground">{undo.reason}</p>}
        </div></details>}
      </CardContent>
    </Card>
    <AlertDialog open={confirm != null} onOpenChange={(open) => !open && setConfirm(null)}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm === "start" ? "Start this mesocycle?" : confirm === "align" ? "Align to your first workout?" : "Restore the previous start?"}</AlertDialogTitle>
        <AlertDialogDescription>{confirm === "start" ? `Start: ${preview.startedOn}.` : `Start changes from ${state?.startedOn} to ${preview.startedOn}.`} Deload: {preview.deloadOn}. Review: {preview.reviewOn}. Saved workouts, sets, and cycle settings are not rewritten. Date corrections are recorded and can only be undone while history remains compatible.</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); if (confirm) mutation.mutate(confirm); }}>{mutation.isPending ? "Saving…" : "Confirm"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}
