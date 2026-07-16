import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ClipboardList, Play, Clock, Dumbbell, Flame, AlertCircle, Copy, Lock, Pencil, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
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

function TemplateCard({
  template,
  exerciseNameLookup,
  readOnly,
  onCopy,
  copyPending,
}: {
  template: WorkoutTemplateFull;
  exerciseNameLookup: Map<number, string>;
  readOnly?: boolean;
  onCopy?: () => void;
  copyPending?: boolean;
}) {
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
        {readOnly ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onCopy}
            disabled={copyPending}
            data-testid={`button-copy-template-${template.id}`}
          >
            <Copy className="h-3.5 w-3.5" />
            {copyPending ? "Copying..." : "Copy to my templates"}
          </Button>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            <Link href={`/templates/${template.id}/edit`}>
              <Button size="sm" variant="outline" data-testid={`button-edit-template-${template.id}`}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
            <Link href={`/log?template=${template.id}`}>
              <Button size="sm" data-testid={`button-start-template-${template.id}`}>
                <Play className="h-3.5 w-3.5" />
                Start
              </Button>
            </Link>
          </div>
        )}
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
  const { activeUserId, activeUser, users } = useActiveUser();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"mine" | "other">("mine");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const otherUser = users.find((u) => u.id !== activeUserId);

  const { data: templates, isLoading } = useQuery<WorkoutTemplateFull[]>({
    queryKey: ["/api/workout-templates", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-templates");
      return res.json();
    },
    enabled: activeUserId != null,
  });
  const { data: otherTemplates, isLoading: otherLoading } = useQuery<WorkoutTemplateFull[]>({
    queryKey: ["/api/workout-templates/shared", otherUser?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workout-templates/shared/${otherUser!.id}`);
      return res.json();
    },
    enabled: tab === "other" && otherUser != null,
  });
  const { data: exercises } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });

  const exerciseNameLookup = new Map<number, string>();
  for (const e of exercises ?? []) exerciseNameLookup.set(e.id, e.name);

  const [copyingId, setCopyingId] = useState<number | null>(null);
  const copyMutation = useMutation({
    mutationFn: async (templateId: number) => {
      setCopyingId(templateId);
      const res = await apiRequest("POST", `/api/workout-templates/${templateId}/copy`, {
        targetUserId: activeUserId,
      });
      return res.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
      toast({ title: `Copied "${created.name}" to your templates` });
      setCopyingId(null);
    },
    onError: () => {
      toast({ title: "Couldn't copy template", variant: "destructive" });
      setCopyingId(null);
    },
  });

  const activeList = tab === "mine" ? templates : otherTemplates;
  const activeLoading = tab === "mine" ? isLoading : otherLoading;

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/workout-templates", { name, notes: null });
      return res.json();
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
      setNewOpen(false);
      setNewName("");
      navigate(`/templates/${created.id}/edit`);
    },
    onError: () => toast({ title: "Couldn't create template", variant: "destructive" }),
  });

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createMutation.mutate(trimmed);
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
            Workout Templates
          </h1>
          <p className="text-sm text-muted-foreground">Pre-built sessions with prescribed sets, reps, and RIR targets</p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setNewOpen(true)}
          data-testid="button-new-template"
        >
          <Plus className="h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      <Dialog open={newOpen} onOpenChange={(open) => { setNewOpen(open); if (!open) setNewName(""); }}>
        <DialogContent data-testid="dialog-new-template">
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              autoFocus
              placeholder="e.g. Push Day"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              data-testid="input-new-template-name"
            />
            <p className="text-xs text-muted-foreground">
              You'll add exercises next — start with a blank template and build it up.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} data-testid="button-cancel-new-template">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-confirm-new-template"
            >
              {createMutation.isPending ? "Creating..." : "Create & Add Exercises"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {otherUser && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "mine" | "other")}>
          <TabsList data-testid="tabs-template-scope">
            <TabsTrigger value="mine" data-testid="tab-my-templates">
              {activeUser ? `${activeUser.name}'s Templates` : "My Templates"}
            </TabsTrigger>
            <TabsTrigger value="other" data-testid="tab-other-templates">
              <Lock className="h-3 w-3 mr-1" />
              {otherUser.name}'s Templates
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {activeLoading && (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!activeLoading && (activeList?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center text-center gap-3 py-16 text-muted-foreground">
          <ClipboardList className="h-8 w-8 text-muted-foreground/60" />
          <p>{tab === "mine" ? "No workout templates yet." : `${otherUser?.name} has no templates yet.`}</p>
        </div>
      )}

      <div className="space-y-4" data-testid={`list-templates-${tab}`}>
        {activeList?.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            exerciseNameLookup={exerciseNameLookup}
            readOnly={tab === "other"}
            onCopy={() => copyMutation.mutate(t.id)}
            copyPending={copyingId === t.id}
          />
        ))}
      </div>
    </div>
  );
}
