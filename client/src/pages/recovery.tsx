import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeartPulse, Settings2 } from "lucide-react";
import { useActiveUser } from "@/lib/user-context";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecoverySettingsEditor } from "@/components/recovery-settings-editor";
import type { MuscleRecoveryState } from "@shared/coaching";

const STATUS_STYLE: Record<string, string> = {
  Recovered: "border-volume-optimal text-volume-optimal",
  Recovering: "border-volume-high text-volume-high",
  "Needs Rest": "border-destructive text-destructive",
};

const BAR_STYLE: Record<string, string> = {
  Recovered: "bg-volume-optimal",
  Recovering: "bg-volume-high",
  "Needs Rest": "bg-destructive",
};

function MuscleCard({ state }: { state: MuscleRecoveryState }) {
  return (
    <Card data-testid={`card-recovery-${state.muscle.toLowerCase()}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">{state.displayName}</CardTitle>
        <Badge variant="outline" className={`text-xs ${STATUS_STYLE[state.status] ?? ""}`}>
          {state.status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid={`text-recovery-percent-${state.muscle.toLowerCase()}`}>
            {state.recoveryPercent}% recovered
          </span>
          <span>{state.fatiguePercent}% fatigue</span>
        </div>
        <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${BAR_STYLE[state.status] ?? "bg-primary"}`}
            style={{ width: `${state.fatiguePercent}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {state.lastTrainedAt
            ? `Last trained ${Math.round(state.hoursSinceLastTrained)}h ago`
            : "No recent training logged"}
        </p>
      </CardContent>
    </Card>
  );
}

export default function RecoveryMap() {
  const { activeUserId } = useActiveUser();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data, isLoading } = useQuery<MuscleRecoveryState[]>({
    queryKey: ["/api/recovery", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/recovery");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const sorted = (data ?? []).slice().sort((a, b) => b.fatiguePercent - a.fatiguePercent);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold flex items-center gap-2" data-testid="text-page-title">
            <HeartPulse className="h-5 w-5" />
            Muscle Recovery Map
          </h1>
          <p className="text-sm text-muted-foreground">
            Fatigue decay across all 20 muscle groups, distributed by each exercise's effective stimulus ratios
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => setSettingsOpen(true)}
          aria-label="Customize recovery model"
          title="Customize recovery model"
          data-testid="button-open-recovery-settings"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading &&
          Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        {!isLoading && sorted.map((state) => <MuscleCard key={state.muscle} state={state} />)}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="dialog-recovery-settings">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Customize Recovery Model
            </DialogTitle>
            <DialogDescription>
              Adjust how strongly workouts create fatigue and how quickly that fatigue decays for this profile.
            </DialogDescription>
          </DialogHeader>
          <RecoverySettingsEditor onSaved={() => setSettingsOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
