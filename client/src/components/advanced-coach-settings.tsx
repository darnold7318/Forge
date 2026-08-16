import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CoachSettings, ProgressionStyleId, SensitivityId, VolumeProgressionSensitivityId } from "@shared/schema";

interface EffectiveMuscleSetting {
  muscleGroupId: number;
  muscle: string;
  displayName: string;
  recoveryHalfLifeHours: number;
  mev: number;
  mav: number;
  mrv: number;
  customized: { recoveryHalfLifeHours: boolean; volumeLandmarks: boolean };
  learnedRange: {
    productiveLow: number | null;
    productiveHigh: number | null;
    confidence: number;
    validWeekCount: number;
    explanation: string;
  };
  forgeDefaults: { recoveryHalfLifeHours: number; mev: number; mav: number; mrv: number };
}

interface CoachSettingsResponse {
  settings: CoachSettings;
  muscles: EffectiveMuscleSetting[];
}

function NumberSetting(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  help: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{props.label}</Label>
      <Input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(event) => props.onChange(Math.min(props.max, Math.max(props.min, Number(event.target.value))))}
      />
      <p className="text-[11px] text-muted-foreground">{props.help}</p>
    </div>
  );
}

export function AdvancedCoachSettings() {
  const { activeUserId } = useActiveUser();
  const { toast } = useToast();
  const { data } = useQuery<CoachSettingsResponse>({
    queryKey: ["/api/coach/settings", activeUserId],
    queryFn: async () => (await apiRequest("GET", "/api/coach/settings")).json(),
    enabled: activeUserId != null,
  });
  const [draft, setDraft] = useState<CoachSettings | null>(null);
  useEffect(() => {
    if (data) setDraft(data.settings);
  }, [data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/coach/settings"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/recovery"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/volume-tracker"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  };

  const saveSettings = useMutation({
    mutationFn: async (settings: CoachSettings) => (await apiRequest("PUT", "/api/coach/settings", settings)).json(),
    onSuccess: async () => { await refresh(); toast({ title: "Coach settings saved" }); },
    onError: () => toast({ title: "Couldn't save Coach settings", variant: "destructive" }),
  });
  const resetAll = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", "/api/coach/settings")).json(),
    onSuccess: async () => { await refresh(); toast({ title: "Forge defaults restored" }); },
  });
  const saveMuscle = useMutation({
    mutationFn: async (muscle: EffectiveMuscleSetting) => (await apiRequest(
      "PUT",
      `/api/coach/settings/muscles/${muscle.muscleGroupId}`,
      {
        recoveryHalfLifeHours: muscle.recoveryHalfLifeHours === muscle.forgeDefaults.recoveryHalfLifeHours ? null : muscle.recoveryHalfLifeHours,
        mev: muscle.mev === muscle.forgeDefaults.mev && muscle.mav === muscle.forgeDefaults.mav && muscle.mrv === muscle.forgeDefaults.mrv ? null : muscle.mev,
        mav: muscle.mev === muscle.forgeDefaults.mev && muscle.mav === muscle.forgeDefaults.mav && muscle.mrv === muscle.forgeDefaults.mrv ? null : muscle.mav,
        mrv: muscle.mev === muscle.forgeDefaults.mev && muscle.mav === muscle.forgeDefaults.mav && muscle.mrv === muscle.forgeDefaults.mrv ? null : muscle.mrv,
      },
    )).json(),
    onSuccess: async () => { await refresh(); toast({ title: "Muscle model saved" }); },
    onError: (error: Error) => toast({ title: "Couldn't save muscle model", description: error.message, variant: "destructive" }),
  });
  const resetMuscle = useMutation({
    mutationFn: async (muscleGroupId: number) => apiRequest("DELETE", `/api/coach/settings/muscles/${muscleGroupId}`),
    onSuccess: async () => { await refresh(); toast({ title: "Muscle defaults restored" }); },
  });

  if (!data || !draft) return null;
  const update = <K extends keyof CoachSettings>(key: K, value: CoachSettings[K]) => setDraft({ ...draft, [key]: value });

  return (
    <Card data-testid="card-advanced-coach-settings">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />Advanced Coach Settings</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Tune Forge's model assumptions. These controls do not rewrite workout history.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => resetAll.mutate()} disabled={resetAll.isPending}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset all
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Preferred progression style</Label>
            <Select value={draft.progressionStyle} onValueChange={(value) => update("progressionStyle", value as ProgressionStyleId)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="automatic">Automatic</SelectItem>
                <SelectItem value="rep_first">Rep-first</SelectItem>
                <SelectItem value="load_first">Load-first</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Coach fatigue sensitivity</Label>
            <Select value={draft.fatigueSensitivity} onValueChange={(value) => update("fatigueSensitivity", value as SensitivityId)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
            </Select>
          </div>
          <NumberSetting label="Minimum comparable exposures" value={draft.minComparableExposures} min={2} max={6} onChange={(value) => update("minComparableExposures", value)} help="History required before Forge makes trend-based changes." />
          <NumberSetting label="Maximum trend history" value={draft.trendHistoryLimit} min={3} max={8} onChange={(value) => update("trendHistoryLimit", value)} help="Recent same-exercise exposures considered." />
          <NumberSetting label="Preferred minimum RIR" value={draft.preferredRirMin} min={0} max={3} onChange={(value) => update("preferredRirMin", value)} help="Fallback only; template RIR remains authoritative." />
          <NumberSetting label="Preferred maximum RIR" value={draft.preferredRirMax} min={1} max={4} onChange={(value) => update("preferredRirMax", value)} help="Fallback only; template RIR remains authoritative." />
          <div className="space-y-1.5">
            <Label>Failure fatigue sensitivity</Label>
            <Select value={draft.failureFatigueSensitivity} onValueChange={(value) => update("failureFatigueSensitivity", value as SensitivityId)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Volume progression sensitivity</Label>
            <Select value={draft.volumeProgressionSensitivity} onValueChange={(value) => update("volumeProgressionSensitivity", value as VolumeProgressionSensitivityId)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="conservative">Conservative</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="aggressive">Aggressive</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => saveSettings.mutate(draft)} disabled={saveSettings.isPending}>Save Coach settings</Button>

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Per-muscle recovery and volume landmarks</summary>
          <p className="mt-2 text-xs text-muted-foreground">Higher half-life values retain fatigue longer. These are adjustable model assumptions, not medical measurements.</p>
          <div className="mt-4 space-y-3">
            {data.muscles.map((muscle) => <MuscleRow key={muscle.muscleGroupId} muscle={muscle} onSave={(value) => saveMuscle.mutate(value)} onReset={() => resetMuscle.mutate(muscle.muscleGroupId)} />)}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function MuscleRow({ muscle, onSave, onReset }: { muscle: EffectiveMuscleSetting; onSave: (value: EffectiveMuscleSetting) => void; onReset: () => void }) {
  const [draft, setDraft] = useState(muscle);
  useEffect(() => setDraft(muscle), [muscle]);
  const field = (key: "recoveryHalfLifeHours" | "mev" | "mav" | "mrv", min: number, max: number) => (
    <Input className="h-8" type="number" min={min} max={max} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })} />
  );
  return (
    <div className="grid items-end gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-[1.5fr_repeat(4,0.7fr)_auto]">
      <div>
        <p className="text-sm font-medium">{muscle.displayName}</p>
        <p className="text-[10px] text-muted-foreground">{muscle.customized.recoveryHalfLifeHours || muscle.customized.volumeLandmarks ? "Customized" : "Using Forge default"}</p>
        <p className="text-[10px] text-muted-foreground">
          Learned range: {muscle.learnedRange.productiveLow != null && muscle.learnedRange.productiveHigh != null
            ? `${muscle.learnedRange.productiveLow.toFixed(1)}-${muscle.learnedRange.productiveHigh.toFixed(1)} (${muscle.learnedRange.confidence}% confidence)`
            : `Learning (${muscle.learnedRange.validWeekCount}/4 valid weeks)`}
        </p>
      </div>
      <label className="text-[10px] text-muted-foreground">Half-life (h){field("recoveryHalfLifeHours", 18, 120)}</label>
      <label className="text-[10px] text-muted-foreground">MEV{field("mev", 0, 60)}</label>
      <label className="text-[10px] text-muted-foreground">MAV{field("mav", 1, 70)}</label>
      <label className="text-[10px] text-muted-foreground">MRV{field("mrv", 2, 80)}</label>
      <div className="flex gap-1"><Button size="sm" onClick={() => onSave(draft)}>Save</Button><Button size="sm" variant="ghost" onClick={onReset}>Reset</Button></div>
    </div>
  );
}
