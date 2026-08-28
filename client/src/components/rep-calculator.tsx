import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { calculateRepProjection, nextAvailableWeight } from "@shared/coaching";
import type { EquipmentWeightSettings } from "@shared/schema";

interface LoggedSet {
  id: number;
  weight: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
}

interface RepCalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseId: number;
  exerciseName: string;
  equipmentSettings: EquipmentWeightSettings;
  prescribedRepMinimum?: number;
  prescribedRir?: number;
}

export function RepCalculator({
  open,
  onOpenChange,
  exerciseId,
  exerciseName,
  equipmentSettings,
  prescribedRepMinimum = 6,
  prescribedRir = 2,
}: RepCalculatorProps) {
  const { activeUserId } = useActiveUser();
  const { data, isLoading } = useQuery<LoggedSet[]>({
    queryKey: ["/api/exercises", String(exerciseId), "sets", activeUserId],
    queryFn: async () => (await apiRequest("GET", `/api/exercises/${exerciseId}/sets`)).json(),
    enabled: open && activeUserId != null,
  });
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rir, setRir] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [targetReps, setTargetReps] = useState(String(prescribedRepMinimum));

  useEffect(() => {
    if (!open || !data) return;
    const latest = data.find((set) => !set.isWarmup && set.reps > 0);
    if (!latest) {
      setWeight("");
      setReps("");
      setRir(String(prescribedRir));
      setTargetWeight("");
      setTargetReps(String(prescribedRepMinimum));
      return;
    }
    setWeight(String(latest.weight));
    setReps(String(latest.reps));
    setRir(String(latest.rir ?? prescribedRir));
    setTargetWeight(String(nextAvailableWeight(latest.weight, equipmentSettings) ?? latest.weight));
    setTargetReps(String(prescribedRepMinimum));
  }, [open, data, equipmentSettings, prescribedRepMinimum, prescribedRir]);

  const projection = useMemo(() => calculateRepProjection({
    weight: Number(weight),
    reps: Number(reps),
    rir: Number(rir),
    targetWeight: Number(targetWeight),
    targetReps: Number(targetReps),
  }), [weight, reps, rir, targetWeight, targetReps]);
  const parsedTargetWeight = Number(targetWeight);
  const targetOutsideAvailableRange = Number.isFinite(parsedTargetWeight) && targetWeight !== "" && (
    parsedTargetWeight < equipmentSettings.minWeight || parsedTargetWeight > equipmentSettings.maxWeight
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-rep-calculator">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Rep calculator
          </DialogTitle>
          <DialogDescription>
            {exerciseName}: estimate the reps a different load may allow. The latest working set is filled automatically and can be changed for hypotheticals.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? <Skeleton className="h-40 w-full" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="rep-calc-weight">Last weight</Label>
                <Input id="rep-calc-weight" type="number" min={0} step="0.5" value={weight} onChange={(event) => setWeight(event.target.value)} data-testid="input-rep-calc-weight" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rep-calc-reps">Reps</Label>
                <Input id="rep-calc-reps" type="number" min={1} step={1} value={reps} onChange={(event) => setReps(event.target.value)} data-testid="input-rep-calc-reps" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rep-calc-rir">RIR</Label>
                <Input id="rep-calc-rir" type="number" min={0} max={10} step={0.5} value={rir} onChange={(event) => setRir(event.target.value)} data-testid="input-rep-calc-rir" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="rep-calc-target-weight">Hypothetical weight</Label>
                <Input id="rep-calc-target-weight" type="number" min={equipmentSettings.minWeight} max={equipmentSettings.maxWeight} step={equipmentSettings.weightIncrement} value={targetWeight} onChange={(event) => setTargetWeight(event.target.value)} data-testid="input-rep-calc-target-weight" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rep-calc-target-reps">Desired reps</Label>
                <Input id="rep-calc-target-reps" type="number" min={1} step={1} value={targetReps} onChange={(event) => setTargetReps(event.target.value)} data-testid="input-rep-calc-target-reps" />
              </div>
            </div>
            {targetOutsideAvailableRange && (
              <p className="text-xs text-volume-high">
                This hypothetical is outside your configured {equipmentSettings.minWeight}-{equipmentSettings.maxWeight} lb range.
              </p>
            )}

            {projection ? (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Estimated at {targetWeight} lb</span>
                  <strong data-testid="text-rep-calc-projection">about {projection.projectedRepsAtTargetWeight} reps @ RIR {rir}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">To reach {targetReps} reps at {targetWeight} lb</span>
                  <strong data-testid="text-rep-calc-required">about {projection.requiredRepsAtCurrentWeight} reps at {weight} lb</strong>
                </div>
                <div className="flex justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Estimated 1-rep max</span>
                  <span>{projection.estimatedOneRepMax} lb</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Estimate uses an RIR-adjusted Epley formula. Treat it as a planning aid, not a guaranteed performance result.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Enter a positive weight, reps, RIR, and hypothetical weight to calculate.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
