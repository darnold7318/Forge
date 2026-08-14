import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, RotateCcw, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActiveUser } from "@/lib/user-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RECOVERY_HALF_LIFE_HOURS } from "@shared/coaching";
import {
  DEFAULT_RECOVERY_SETTINGS,
  muscleGroupDisplayNames,
  muscleGroupNames,
  type MuscleGroupName,
  type RecoverySettings,
} from "@shared/schema";

function cloneSettings(settings: RecoverySettings): RecoverySettings {
  return { ...settings, muscleRecoverySpeeds: { ...settings.muscleRecoverySpeeds } };
}

function PercentSlider({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const percent = Math.round(value * 100);
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-sm font-semibold tabular-nums" data-testid={`value-${id}`}>{percent}%</span>
      </div>
      <Slider
        id={id}
        min={75}
        max={125}
        step={5}
        value={[percent]}
        onValueChange={([next]) => onChange(next / 100)}
        data-testid={`slider-${id}`}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function RecoverySettingsEditor({ onSaved }: { onSaved?: () => void }) {
  const { activeUserId } = useActiveUser();
  const { toast } = useToast();
  const [draft, setDraft] = useState<RecoverySettings>(() => cloneSettings(DEFAULT_RECOVERY_SETTINGS));
  const [muscleToAdd, setMuscleToAdd] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data, isLoading } = useQuery<RecoverySettings>({
    queryKey: ["/api/recovery/settings", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/recovery/settings");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  useEffect(() => {
    if (data) setDraft(cloneSettings(data));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (settings: RecoverySettings) => {
      const res = await apiRequest("PUT", "/api/recovery/settings", settings);
      return res.json() as Promise<RecoverySettings>;
    },
    onSuccess: (saved) => {
      setDraft(cloneSettings(saved));
      queryClient.setQueryData(["/api/recovery/settings", activeUserId], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/recovery"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
      toast({ title: "Recovery settings saved" });
      onSaved?.();
    },
    onError: () => toast({ title: "Couldn't save recovery settings", variant: "destructive" }),
  });

  const configuredMuscles = useMemo(
    () => muscleGroupNames.filter((muscle) => draft.muscleRecoverySpeeds[muscle] != null),
    [draft.muscleRecoverySpeeds],
  );
  const availableMuscles = muscleGroupNames.filter((muscle) => draft.muscleRecoverySpeeds[muscle] == null);
  const isDirty = data != null && JSON.stringify(draft) !== JSON.stringify(data);

  const setMuscleSpeed = (muscle: MuscleGroupName, speed: number) => {
    setDraft((current) => ({
      ...current,
      muscleRecoverySpeeds: { ...current.muscleRecoverySpeeds, [muscle]: speed },
    }));
  };

  const removeMuscle = (muscle: MuscleGroupName) => {
    setDraft((current) => {
      const next = { ...current.muscleRecoverySpeeds };
      delete next[muscle];
      return { ...current, muscleRecoverySpeeds: next };
    });
  };

  if (isLoading || !data) {
    return <Skeleton className="h-72 w-full" data-testid="skeleton-recovery-settings" />;
  }

  return (
    <div className="space-y-4" data-testid="recovery-settings-editor">
      <div className="space-y-3">
        <PercentSlider
          id="fatigue-sensitivity"
          label="Workout fatigue sensitivity"
          description="Higher values make the same logged workout generate more initial fatigue."
          value={draft.fatigueSensitivity}
          onChange={(fatigueSensitivity) => setDraft((current) => ({ ...current, fatigueSensitivity }))}
        />
        <PercentSlider
          id="overall-recovery-speed"
          label="Overall recovery speed"
          description="Higher values make fatigue decay faster across every muscle group."
          value={draft.overallRecoverySpeed}
          onChange={(overallRecoverySpeed) => setDraft((current) => ({ ...current, overallRecoverySpeed }))}
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="rounded-md border">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="h-auto w-full justify-between gap-3 p-3 text-left" data-testid="button-toggle-muscle-overrides">
            <span>
              <span className="block text-sm font-medium">Advanced muscle overrides</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {configuredMuscles.length > 0
                  ? `${configuredMuscles.length} customized muscle${configuredMuscles.length === 1 ? "" : "s"}`
                  : "Optional per-muscle recovery speed adjustments"}
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t p-3">
          <p className="text-xs text-muted-foreground">
            Overrides combine with the overall recovery speed. Unlisted muscles remain at 100%.
          </p>

        {availableMuscles.length > 0 && (
          <Select
            value={muscleToAdd}
            onValueChange={(value) => {
              setMuscleSpeed(value as MuscleGroupName, 1);
              setMuscleToAdd("");
            }}
          >
            <SelectTrigger data-testid="select-add-muscle-override">
              <SelectValue placeholder="Add a muscle override" />
            </SelectTrigger>
            <SelectContent>
              {availableMuscles.map((muscle) => (
                <SelectItem key={muscle} value={muscle}>
                  {muscleGroupDisplayNames[muscle]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {configuredMuscles.map((muscle) => {
          const speed = draft.muscleRecoverySpeeds[muscle] ?? 1;
          const percent = Math.round(speed * 100);
          const effectiveHalfLife = Math.round(
            RECOVERY_HALF_LIFE_HOURS[muscle] / (draft.overallRecoverySpeed * speed),
          );
          return (
            <div key={muscle} className="space-y-2 rounded-md bg-muted/40 p-3" data-testid={`override-${muscle.toLowerCase()}`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{muscleGroupDisplayNames[muscle]}</p>
                  <p className="text-xs text-muted-foreground">
                    Estimated fatigue half-life: {effectiveHalfLife}h
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeMuscle(muscle)}
                  aria-label={`Remove ${muscleGroupDisplayNames[muscle]} override`}
                  data-testid={`button-remove-override-${muscle.toLowerCase()}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  min={75}
                  max={125}
                  step={5}
                  value={[percent]}
                  onValueChange={([next]) => setMuscleSpeed(muscle, next / 100)}
                  className="flex-1"
                  data-testid={`slider-muscle-${muscle.toLowerCase()}`}
                />
                <span className="w-12 text-right text-sm font-semibold tabular-nums">{percent}%</span>
              </div>
            </div>
          );
        })}
        </CollapsibleContent>
      </Collapsible>

      <p className="text-xs text-muted-foreground">
        These controls tune Forge's estimated fatigue model. They do not modify workout history or measure biological recovery.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => setDraft(cloneSettings(DEFAULT_RECOVERY_SETTINGS))}
          disabled={saveMutation.isPending}
          data-testid="button-reset-recovery-settings"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </Button>
        <Button
          type="button"
          onClick={() => saveMutation.mutate(draft)}
          disabled={!isDirty || saveMutation.isPending}
          data-testid="button-save-recovery-settings"
        >
          {saveMutation.isPending ? "Saving..." : "Save recovery settings"}
        </Button>
      </div>
    </div>
  );
}
