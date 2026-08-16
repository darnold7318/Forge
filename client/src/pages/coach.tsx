import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowUp,
  ArrowRight,
  Minus,
  Sparkles,
  Flame,
  ShieldAlert,
  Gauge,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import type { WorkoutExerciseSuggestion, FatigueSignal } from "@shared/coaching";

interface Suggestion extends WorkoutExerciseSuggestion {
  exerciseId: number;
}

interface WorkoutTemplateLite {
  id: number;
  name: string;
}

const RECOMMENDATION_META: Record<
  string,
  { icon: typeof ArrowUp; className: string }
> = {
  "Increase Weight": { icon: ArrowUp, className: "border-volume-optimal text-volume-optimal" },
  "Optional Increase": { icon: ArrowUp, className: "border-volume-optimal text-volume-optimal" },
  "Repeat Weight": { icon: Minus, className: "border-muted-foreground/40 text-muted-foreground" },
  "Repeat Or Reduce": { icon: ArrowRight, className: "border-volume-high text-volume-high" },
  "Hold Weight": { icon: Minus, className: "border-volume-high text-volume-high" },
  "Hold Progression": { icon: Minus, className: "border-volume-high text-volume-high" },
  "Reduce Or Delay": { icon: AlertTriangle, className: "border-destructive text-destructive" },
  "Start Conservative": { icon: ArrowRight, className: "border-muted-foreground/40 text-muted-foreground" },
  "Add Reps": { icon: ArrowUp, className: "border-volume-optimal text-volume-optimal" },
  "Increase Hold Duration": { icon: ArrowUp, className: "border-volume-optimal text-volume-optimal" },
  "Add Hold Time": { icon: ArrowUp, className: "border-volume-optimal text-volume-optimal" },
  "Increase Control": { icon: ArrowUp, className: "border-volume-optimal text-volume-optimal" },
  Maintain: { icon: Minus, className: "border-muted-foreground/40 text-muted-foreground" },
};

function recommendationMeta(rec: string) {
  return RECOMMENDATION_META[rec] ?? { icon: ArrowRight, className: "border-muted-foreground/40 text-muted-foreground" };
}

const FATIGUE_STATUS_STYLE: Record<string, string> = {
  Learning: "border-muted-foreground/40 text-muted-foreground",
  Stable: "border-volume-optimal text-volume-optimal",
  "Watch Trend": "border-volume-high text-volume-high",
  "Fatigue Risk": "border-destructive text-destructive",
};

const RECOVERY_STATUS_STYLE: Record<string, string> = {
  Recovered: "text-volume-optimal",
  Recovering: "text-volume-high",
  "Needs Rest": "text-destructive",
};

export default function Coach() {
  const [templateId, setTemplateId] = useState<string>("all");
  const { activeUserId, activeUser } = useActiveUser();
  const showIntermediate = activeUser?.trainingLevel !== "beginner";
  const showAdvanced = activeUser?.trainingLevel === "advanced";

  const { data: templates } = useQuery<WorkoutTemplateLite[]>({
    queryKey: ["/api/workout-templates", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-templates");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery<Suggestion[]>({
    queryKey: ["/api/coach/suggestions", templateId, activeUserId],
    queryFn: async () => {
      const url =
        templateId === "all"
          ? "/api/coach/suggestions"
          : `/api/coach/suggestions?templateId=${templateId}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const { data: fatigue, isLoading: fatigueLoading } = useQuery<FatigueSignal>({
    queryKey: ["/api/coach/fatigue-trend", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/coach/fatigue-trend");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
          Coach
        </h1>
        <p className="text-sm text-muted-foreground">Next-session targets for {suggestions?.[0]?.goalLabel ?? "your training goal"}</p>
      </div>

      {!fatigueLoading && fatigue && (
        <Card
          className={
            fatigue.deloadSuggested
              ? "border-destructive/40 bg-destructive/10"
              : "border-volume-optimal/40 bg-volume-optimal/10"
          }
          data-testid="card-fatigue-status"
        >
          <CardContent className="p-4 flex gap-3">
            {fatigue.deloadSuggested ? (
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            ) : (
              <Flame className="h-5 w-5 text-volume-optimal shrink-0 mt-0.5" />
            )}
            <div className="space-y-2 min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-semibold text-sm" data-testid="text-fatigue-headline">
                  {fatigue.deloadSuggested ? "Deload Suggested" : "Fatigue Trend"}
                </p>
                <Badge variant="outline" className={FATIGUE_STATUS_STYLE[fatigue.status] ?? ""}>
                  {fatigue.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="text-fatigue-summary">
                {fatigue.summary}
              </p>
              <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    fatigue.riskScore >= 70
                      ? "bg-destructive"
                      : fatigue.riskScore >= 45
                      ? "bg-volume-high"
                      : "bg-volume-optimal"
                  }`}
                  style={{ width: `${fatigue.riskScore}%` }}
                  data-testid="bar-fatigue-risk"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 flex-wrap">
          <CardTitle className="text-base">Exercise Suggestions</CardTitle>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="w-44" data-testid="select-coach-template-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All trained exercises</SelectItem>
              {(templates ?? []).map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggestionsLoading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}

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
              const meta = recommendationMeta(s.recommendation);
              const Icon = meta.icon;
              const primaryContext = s.muscleContexts?.[0];
              const learnedRangeLabel = s.goal === "hypertrophy" ? "Observed productive range" : "Observed volume tolerance";
              return (
                <div
                  key={s.exerciseId}
                  className="rounded-md border p-4 space-y-3"
                  data-testid={`card-suggestion-${s.exerciseId}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Link
                      href={`/progress/${s.exerciseId}`}
                      className="font-medium text-sm hover-elevate rounded px-1 -mx-1"
                      data-testid={`link-suggestion-exercise-${s.exerciseId}`}
                    >
                      {s.exerciseName}
                    </Link>
                    <Badge variant="outline" className={`text-xs gap-1 ${meta.className}`}>
                      <Icon className="h-3 w-3" />
                      {s.recommendation}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Last: {s.lastPerformance}</span>
                    <span className="font-mono tabular-nums">Goal: {s.suggestedGoal}</span>
                  </div>

                  <p className="text-sm" data-testid={`text-suggestion-reason-${s.exerciseId}`}>
                    {s.reason}
                  </p>
                  {showIntermediate && s.evidenceText && (
                    <p className="text-xs text-muted-foreground">{s.evidenceText}</p>
                  )}
                  {s.nextGoalText && (
                    <p className="text-xs text-muted-foreground italic">{s.nextGoalText}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs border-t pt-2">
                    <span className="flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      <span className={RECOVERY_STATUS_STYLE[s.recoveryStatus] ?? "text-muted-foreground"}>
                        {s.recoveryText}
                      </span>
                    </span>
                    {showIntermediate && <span className="flex items-center gap-1">
                      <Gauge className="h-3.5 w-3.5" />
                      Readiness {s.readinessScore}/100 - {s.readinessStatus}
                    </span>}
                    {showIntermediate && <span className="text-muted-foreground">Confidence {s.confidenceScore}%</span>}
                    {showIntermediate && s.trend && <span>Trend {s.trend}</span>}
                    {showIntermediate && s.setRecommendation && <span>{s.setRecommendation}</span>}
                  </div>
                  {showIntermediate && primaryContext && (
                    <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Target: {primaryContext.displayName} · {primaryContext.currentEffectiveSets.toFixed(1)} effective sets · MEV {primaryContext.mev} / MAV {primaryContext.mav} / MRV {primaryContext.mrv}
                    </p>
                    {s.limitingMuscleNote && <p className="text-xs text-volume-high">Limiting context: {s.limitingMuscleNote}</p>}
                    {s.goal !== "mobility" && (primaryContext.learnedLow != null && primaryContext.learnedHigh != null ? (
                      <p className="text-xs text-muted-foreground">
                        {learnedRangeLabel}: {primaryContext.learnedLow.toFixed(1)}-{primaryContext.learnedHigh.toFixed(1)} sets ({primaryContext.learnedConfidence ?? 0}% confidence)
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{learnedRangeLabel}: Learning ({primaryContext.learnedValidWeekCount ?? 0}/4 valid weeks)</p>
                    ))}
                    </div>
                  )}
                  {showAdvanced && s.confidenceFactors && (
                    <div className="space-y-2">
                      <div className="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                        {s.confidenceFactors.map((factor) => <span key={factor.label} className="mr-3">{factor.label}: {factor.score}% ({factor.detail})</span>)}
                        {s.stimulusQuality && <span>Stimulus: {s.stimulusQuality}</span>}
                        {s.rirAdherence && <span className="ml-3">RIR: {s.rirAdherence.status.replaceAll("_", " ")}</span>}
                        {s.effortNormalizedStatus && <span className="ml-3">Effort-adjusted: {s.effortNormalizedStatus}</span>}
                      </div>
                      {(s.muscleContexts?.length ?? 0) > 0 && (
                        <details className="rounded border bg-muted/20 p-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer font-medium text-foreground">Per-muscle evidence</summary>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {s.muscleContexts?.map((context) => (
                              <div key={context.muscleGroupId} className="rounded bg-background/60 p-2">
                                <p className="font-medium text-foreground">{context.displayName}</p>
                                <p>Stimulus {context.stimulusRatio.toFixed(2)}</p>
                                <p>{context.currentEffectiveSets.toFixed(1)} effective sets · {context.volumeStatus}</p>
                                <p>Recovery {context.recoveryPercent}% · {context.recoveryStatus}</p>
                                <p>MEV {context.mev} / MAV {context.mav} / MRV {context.mrv}</p>
                                {s.goal !== "mobility" && context.learnedExplanation && <p className="mt-1">{context.learnedExplanation}</p>}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                  {s.readinessGuidance && (
                    <p className="text-xs text-muted-foreground" data-testid={`text-readiness-guidance-${s.exerciseId}`}>
                      {s.readinessGuidance}
                    </p>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
