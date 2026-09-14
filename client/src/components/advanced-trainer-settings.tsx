import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCcw, Save, SlidersHorizontal } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdvancedTrainerSettings } from "@shared/schema";

const fields: Array<{
  key: keyof AdvancedTrainerSettings;
  label: string;
  min: number;
  max: number;
  suffix: string;
}> = [
  { key: "accumulationWeeks", label: "Accumulation", min: 3, max: 8, suffix: "weeks + 1 deload" },
  { key: "startRir", label: "Starting RIR", min: 2, max: 4, suffix: "reps in reserve" },
  { key: "endRir", label: "Final-week RIR", min: 0, max: 2, suffix: "reps in reserve" },
  { key: "maxSetsPerExercise", label: "Exercise set cap", min: 3, max: 6, suffix: "working sets" },
  { key: "maxSetsPerMuscleSession", label: "Muscle/session cap", min: 6, max: 14, suffix: "direct sets" },
  { key: "deloadSetPercent", label: "Deload volume", min: 25, max: 75, suffix: "% of MEV" },
  { key: "deloadLoadPercent", label: "Deload load", min: 40, max: 80, suffix: "% of normal" },
];

export function AdvancedTrainerSettingsEditor({
  reviewCycleId,
  onReviewed,
}: {
  reviewCycleId?: number;
  onReviewed?: () => void;
}) {
  const { activeUserId } = useActiveUser();
  const { toast } = useToast();
  const [draft, setDraft] = useState<AdvancedTrainerSettings | null>(null);
  const { data, isLoading } = useQuery<AdvancedTrainerSettings>({
    queryKey: ["/api/advanced-trainer/settings", activeUserId],
    queryFn: async () => (await apiRequest("GET", "/api/advanced-trainer/settings")).json(),
    enabled: activeUserId != null,
  });

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (settings: AdvancedTrainerSettings) => {
      const endpoint = reviewCycleId == null
        ? "/api/advanced-trainer/settings"
        : `/api/advanced-trainer/cycles/${reviewCycleId}/review`;
      const response = await apiRequest(reviewCycleId == null ? "PUT" : "POST", endpoint,
        reviewCycleId == null ? settings : { settings, startNextCycle: false });
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/advanced-trainer/settings", activeUserId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/advanced-trainer/state", activeUserId] });
      toast({
        title: reviewCycleId == null ? "Next-cycle settings saved" : "Next mesocycle prepared",
        description: reviewCycleId == null
          ? "The active mesocycle keeps its original snapshot. These settings apply to the next one."
          : "The clock stays stopped until you explicitly start your next mesocycle.",
      });
      onReviewed?.();
    },
    onError: (error: Error) => toast({ title: "Couldn't save trainer settings", description: error.message, variant: "destructive" }),
  });

  if (isLoading || !draft) return <Skeleton className="h-56 w-full" />;
  const valid = draft.endRir < draft.startRir;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5 rounded-md border p-3">
            <Label htmlFor={`advanced-trainer-${field.key}`}>{field.label}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`advanced-trainer-${field.key}`}
                type="number"
                min={field.min}
                max={field.max}
                value={draft[field.key]}
                onChange={(event) => setDraft({
                  ...draft,
                  [field.key]: Math.max(field.min, Math.min(field.max, Number(event.target.value))),
                })}
                data-testid={`input-advanced-trainer-${field.key}`}
              />
              <span className="min-w-24 text-xs text-muted-foreground">{field.suffix}</span>
            </div>
          </div>
        ))}
      </div>
      {!valid && <p className="text-sm text-destructive">Final-week RIR must be lower than starting RIR.</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Saved templates are never edited. An active cycle keeps its settings until review.
        </p>
        <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate(draft)} data-testid="button-save-advanced-trainer-settings">
          {reviewCycleId == null ? <Save className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}
          {mutation.isPending ? "Saving…" : reviewCycleId == null ? "Save for next cycle" : "Prepare next mesocycle"}
        </Button>
      </div>
      {reviewCycleId != null && (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0" />
          Tune only what your completed cycle supports. If recovery and performance were steady, keeping the defaults is a valid review.
        </div>
      )}
    </div>
  );
}
