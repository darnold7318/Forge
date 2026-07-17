import { useMemo, useState } from "react";
import { Flame } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WarmupCalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseName?: string;
  /** Pre-fill from the working set the user just entered, if any. */
  defaultWorkingWeight?: number;
}

interface WarmupStep {
  pct: number;
  reps: number;
}

// Ramp schemes keyed by number of warm-up sets. Percentages target the
// working weight; reps taper down as load climbs toward the working set.
const RAMP_SCHEMES: Record<number, WarmupStep[]> = {
  2: [
    { pct: 50, reps: 8 },
    { pct: 75, reps: 4 },
  ],
  3: [
    { pct: 40, reps: 10 },
    { pct: 60, reps: 6 },
    { pct: 80, reps: 3 },
  ],
  4: [
    { pct: 40, reps: 10 },
    { pct: 55, reps: 6 },
    { pct: 70, reps: 4 },
    { pct: 85, reps: 2 },
  ],
};

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function WarmupCalculator({
  open,
  onOpenChange,
  exerciseName,
  defaultWorkingWeight,
}: WarmupCalculatorProps) {
  const [workingWeight, setWorkingWeight] = useState<string>(
    defaultWorkingWeight && defaultWorkingWeight > 0 ? String(defaultWorkingWeight) : "",
  );
  const [numSets, setNumSets] = useState<2 | 3 | 4>(3);
  const unitLabel = "lb";

  const parsedWeight = parseFloat(workingWeight);
  const isValid = !Number.isNaN(parsedWeight) && parsedWeight > 0;

  const steps = useMemo(() => {
    if (!isValid) return [];
    const scheme = RAMP_SCHEMES[numSets];
    const roundStep = 5;
    return scheme.map((s) => ({
      ...s,
      weight: Math.max(roundStep, roundToStep((parsedWeight * s.pct) / 100, roundStep)),
    }));
  }, [isValid, numSets, parsedWeight, unitLabel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-warmup-calculator">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            Warm-up calculator
          </DialogTitle>
          <DialogDescription>
            {exerciseName ? `Build a ramp into your working set for ${exerciseName}.` : "Build a ramp into your working set."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="warmup-working-weight">Working weight ({unitLabel})</Label>
            <Input
              id="warmup-working-weight"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              placeholder="e.g. 185"
              value={workingWeight}
              onChange={(e) => setWorkingWeight(e.target.value)}
              data-testid="input-warmup-working-weight"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Warm-up sets</Label>
            <div className="flex gap-2">
              {([2, 3, 4] as const).map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={numSets === n ? "default" : "outline"}
                  onClick={() => setNumSets(n)}
                  data-testid={`button-warmup-sets-${n}`}
                >
                  {n} sets
                </Button>
              ))}
            </div>
          </div>

          {isValid ? (
            <div className="rounded-lg border divide-y" data-testid="list-warmup-steps">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                  data-testid={`row-warmup-step-${i}`}
                >
                  <span className="text-muted-foreground">
                    Set {i + 1} · {s.pct}%
                  </span>
                  <span className="font-medium tabular-nums">
                    {s.weight} {unitLabel} × {s.reps}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 text-sm bg-muted/40">
                <span className="text-muted-foreground">Working set</span>
                <span className="font-semibold tabular-nums" data-testid="text-warmup-working-set">
                  {parsedWeight} {unitLabel}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-warmup-empty-state">
              Enter your working weight to see a warm-up ramp.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
