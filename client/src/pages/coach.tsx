import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowUp, ArrowRight, Minus, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

interface Suggestion {
  exerciseId: number;
  exerciseName: string;
  lastSessionDate: string;
  action: "increase_weight" | "add_rep" | "hold_weight";
  suggestedWeight: number;
  suggestedRepTarget: number;
  reasoning: string;
}

interface DeloadResult {
  shouldDeload: boolean;
  reasons: { reason: string; detail: string }[];
}

const ACTION_META: Record<
  Suggestion["action"],
  { label: string; icon: typeof ArrowUp; className: string }
> = {
  increase_weight: {
    label: "Increase weight",
    icon: ArrowUp,
    className: "border-volume-optimal text-volume-optimal",
  },
  add_rep: {
    label: "Add a rep",
    icon: ArrowRight,
    className: "border-volume-under text-volume-under",
  },
  hold_weight: {
    label: "Hold weight",
    icon: Minus,
    className: "border-volume-high text-volume-high",
  },
};

export default function Coach() {
  const { data: suggestions, isLoading: suggestionsLoading } = useQuery<Suggestion[]>({
    queryKey: ["/api/coach/suggestions"],
  });

  const { data: deload, isLoading: deloadLoading } = useQuery<DeloadResult>({
    queryKey: ["/api/coach/deload"],
  });

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
          Coach
        </h1>
        <p className="text-sm text-muted-foreground">Next-session targets and recovery guidance</p>
      </div>

      {!deloadLoading && deload && (
        <Card
          className={
            deload.shouldDeload
              ? "border-destructive/40 bg-destructive/10"
              : "border-volume-optimal/40 bg-volume-optimal/10"
          }
          data-testid="card-deload-status"
        >
          <CardContent className="p-4 flex gap-3">
            {deload.shouldDeload ? (
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            ) : (
              <Sparkles className="h-5 w-5 text-volume-optimal shrink-0 mt-0.5" />
            )}
            <div className="space-y-2 min-w-0">
              <p className="font-semibold text-sm" data-testid="text-deload-headline">
                {deload.shouldDeload ? "Consider a deload" : "No deload needed"}
              </p>
              {deload.shouldDeload ? (
                <ul className="space-y-1">
                  {deload.reasons.map((r, i) => (
                    <li key={i} className="text-sm text-muted-foreground" data-testid={`text-deload-reason-${i}`}>
                      <span className="font-medium text-foreground">{r.reason}:</span> {r.detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Fatigue markers (stalled lifts, RPE, and volume vs MRV) all look manageable. Keep training as
                  planned.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next-Session Suggestions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggestionsLoading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}

          {!suggestionsLoading && (suggestions?.length ?? 0) === 0 && (
            <div className="flex flex-col items-center text-center gap-3 py-10 text-muted-foreground">
              <Sparkles className="h-8 w-8 text-muted-foreground/60" />
              <div>
                <p className="font-medium text-foreground">No suggestions yet</p>
                <p className="text-sm">Log a workout to get personalized progression targets.</p>
              </div>
            </div>
          )}

          {!suggestionsLoading &&
            suggestions?.map((s) => {
              const meta = ACTION_META[s.action];
              const Icon = meta.icon;
              return (
                <Link key={s.exerciseId} href={`/progress/${s.exerciseId}`}>
                  <div
                    className="rounded-md border p-3 space-y-2 hover-elevate cursor-pointer"
                    data-testid={`card-suggestion-${s.exerciseId}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="font-medium text-sm" data-testid={`text-suggestion-exercise-${s.exerciseId}`}>
                        {s.exerciseName}
                      </p>
                      <Badge variant="outline" className={`text-xs gap-1 ${meta.className}`}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{s.reasoning}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Last trained {formatDate(s.lastSessionDate)}</span>
                      <span className="font-mono tabular-nums">
                        Target: {s.suggestedWeight} lb × {s.suggestedRepTarget}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
