import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ClipboardList, Play, Clock, Dumbbell, Flame, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import type { WorkoutComposition } from "@shared/coaching";

interface WorkoutTemplateExercise {
  id: number;
  exerciseId: number;
  exerciseOrder: number;
  exerciseRole: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRir: number;
  failureTarget: string;
  restSeconds: number;
}

interface WorkoutTemplateFull {
  id: number;
  name: string;
  notes: string | null;
  exercises: WorkoutTemplateExercise[];
}

interface Exercise {
  id: number;
  name: string;
}

const FATIGUE_RATING_STYLE: Record<string, string> = {
  Low: "border-volume-optimal text-volume-optimal",
  Medium: "border-volume-high text-volume-high",
  High: "border-destructive text-destructive",
};

function TemplateCard({ template, exerciseNameLookup }: { template: WorkoutTemplateFull; exerciseNameLookup: Map<number, string> }) {
  const { data: analysis, isLoading } = useQuery<WorkoutComposition>({
    queryKey: ["/api/workout-templates", String(template.id), "analysis"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workout-templates/${template.id}/analysis`);
      return res.json();
    },
  });

  const sorted = [...template.exercises].sort((a, b) => a.exerciseOrder - b.exerciseOrder);

  return (
    <Card data-testid={`card-template-${template.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base" data-testid={`text-template-name-${template.id}`}>
            {template.name}
          </CardTitle>
          {template.notes && <p className="text-xs text-muted-foreground mt-1">{template.notes}</p>}
        </div>
        <Link href={`/log?template=${template.id}`}>
          <Button size="sm" data-testid={`button-start-template-${template.id}`}>
            <Play className="h-3.5 w-3.5" />
            Start
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Skeleton className="h-16 w-full" />}
        {!isLoading && analysis && (
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border-b pb-3">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {analysis.estimatedMinutes} min
            </span>
            <span className="flex items-center gap-1.5">
              <Dumbbell className="h-3.5 w-3.5" />
              {analysis.exerciseCount} exercises · {analysis.workingSetCount} sets
            </span>
            <Badge variant="outline" className={`text-xs gap-1 ${FATIGUE_RATING_STYLE[analysis.fatigueRating] ?? ""}`}>
              <Flame className="h-3 w-3" />
              {analysis.fatigueRating} fatigue
            </Badge>
            {analysis.primaryMuscles && (
              <span className="text-muted-foreground">Targets: {analysis.primaryMuscles}</span>
            )}
          </div>
        )}
        {!isLoading && analysis?.warnings && (
          <div className="flex items-start gap-2 text-xs text-volume-high" data-testid={`text-template-warnings-${template.id}`}>
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{analysis.warnings}</span>
          </div>
        )}

        <div className="space-y-1.5">
          {sorted.map((te) => (
            <div
              key={te.id}
              className="flex items-center justify-between gap-2 text-sm border rounded-md px-3 py-2"
              data-testid={`row-template-exercise-${te.id}`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{exerciseNameLookup.get(te.exerciseId) ?? `Exercise #${te.exerciseId}`}</p>
                <p className="text-xs text-muted-foreground">{te.exerciseRole}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground shrink-0">
                <p className="font-mono tabular-nums">
                  {te.targetSets} × {te.targetRepsMin}-{te.targetRepsMax}
                </p>
                <p>{te.targetRir} RIR · {te.restSeconds}s rest</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkoutTemplates() {
  const { data: templates, isLoading } = useQuery<WorkoutTemplateFull[]>({
    queryKey: ["/api/workout-templates"],
  });
  const { data: exercises } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });

  const exerciseNameLookup = new Map<number, string>();
  for (const e of exercises ?? []) exerciseNameLookup.set(e.id, e.name);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
          Workout Templates
        </h1>
        <p className="text-sm text-muted-foreground">Pre-built sessions with prescribed sets, reps, and RIR targets</p>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!isLoading && (templates?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center text-center gap-3 py-16 text-muted-foreground">
          <ClipboardList className="h-8 w-8 text-muted-foreground/60" />
          <p>No workout templates yet.</p>
        </div>
      )}

      <div className="space-y-4">
        {templates?.map((t) => (
          <TemplateCard key={t.id} template={t} exerciseNameLookup={exerciseNameLookup} />
        ))}
      </div>
    </div>
  );
}
