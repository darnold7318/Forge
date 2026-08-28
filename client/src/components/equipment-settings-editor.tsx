import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dumbbell, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import type { EquipmentWeightSettings } from "@shared/schema";

const EQUIPMENT_LABELS: Record<string, string> = {
  SmithMachine: "Smith Machine",
  PlateLoaded: "Plate Loaded",
};

function EquipmentRow({ setting }: { setting: EquipmentWeightSettings }) {
  const { toast } = useToast();
  const [minWeight, setMinWeight] = useState(String(setting.minWeight));
  const [maxWeight, setMaxWeight] = useState(String(setting.maxWeight));
  const [weightIncrement, setWeightIncrement] = useState(String(setting.weightIncrement));

  useEffect(() => {
    setMinWeight(String(setting.minWeight));
    setMaxWeight(String(setting.maxWeight));
    setWeightIncrement(String(setting.weightIncrement));
  }, [setting.minWeight, setting.maxWeight, setting.weightIncrement]);

  const values = {
    minWeight: Number(minWeight),
    maxWeight: Number(maxWeight),
    weightIncrement: Number(weightIncrement),
  };
  const valid = Object.values(values).every(Number.isFinite) &&
    values.minWeight >= 0 && values.maxWeight >= values.minWeight && values.weightIncrement > 0;
  const changed = valid && (
    values.minWeight !== setting.minWeight ||
    values.maxWeight !== setting.maxWeight ||
    values.weightIncrement !== setting.weightIncrement
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "PUT",
        `/api/equipment-settings/${encodeURIComponent(setting.equipment)}`,
        values,
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
      toast({ title: `${EQUIPMENT_LABELS[setting.equipment] ?? setting.equipment} weights saved` });
    },
    onError: () => toast({ title: "Couldn't save equipment weights", variant: "destructive" }),
  });

  return (
    <div className="rounded-md border p-3 space-y-3" data-testid={`equipment-setting-${setting.equipment}`}>
      <div>
        <p className="text-sm font-medium">{EQUIPMENT_LABELS[setting.equipment] ?? setting.equipment}</p>
        {setting.equipment === "Bodyweight" && (
          <p className="text-[11px] text-muted-foreground">Values represent additional weight.</p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]" htmlFor={`equipment-min-${setting.equipment}`}>Minimum</Label>
          <Input id={`equipment-min-${setting.equipment}`} type="number" min={0} step="0.5" value={minWeight} onChange={(event) => setMinWeight(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]" htmlFor={`equipment-max-${setting.equipment}`}>Maximum</Label>
          <Input id={`equipment-max-${setting.equipment}`} type="number" min={0} step="0.5" value={maxWeight} onChange={(event) => setMaxWeight(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]" htmlFor={`equipment-step-${setting.equipment}`}>Increment</Label>
          <Input id={`equipment-step-${setting.equipment}`} type="number" min={0.01} step="0.5" value={weightIncrement} onChange={(event) => setWeightIncrement(event.target.value)} />
        </div>
      </div>
      {!valid && <p className="text-xs text-destructive">Use positive values and keep maximum at or above minimum.</p>}
      <Button size="sm" variant="outline" disabled={!changed || mutation.isPending} onClick={() => mutation.mutate()}>
        <Save className="h-3.5 w-3.5" />
        Save
      </Button>
    </div>
  );
}

export function EquipmentSettingsEditor() {
  const { activeUserId } = useActiveUser();
  const { data, isLoading } = useQuery<EquipmentWeightSettings[]>({
    queryKey: ["/api/equipment-settings", activeUserId],
    queryFn: async () => (await apiRequest("GET", "/api/equipment-settings")).json(),
    enabled: activeUserId != null,
  });

  return (
    <Card data-testid="card-equipment-settings">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Dumbbell className="h-4 w-4" />
          Available Equipment Weights
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Coach uses these limits and increments for load recommendations and rep projections. Enter weights in the same units used in workout logs.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(data ?? []).map((setting) => <EquipmentRow key={setting.equipment} setting={setting} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
