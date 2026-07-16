import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, RotateCcw, MapPin, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import {
  workoutSplitIds,
  workoutSplitLabels,
  scheduleModeIds,
  type WorkoutSplitId,
  type ScheduleModeId,
} from "@shared/schema";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SPLITS_FOR_GENERATION = workoutSplitIds.filter((id) => id !== "custom") as Exclude<
  WorkoutSplitId,
  "custom"
>[];

interface WorkoutTemplateFull {
  id: number;
  name: string;
}

interface ScheduleSlot {
  id: number;
  scheduleId: number;
  dayOfWeek: number | null;
  position: number;
  workoutTemplateId: number | null;
  label: string | null;
}

interface ScheduleResponse {
  schedule: { id: number; userId: number; mode: ScheduleModeId; rotationPosition: number } | null;
  slots: ScheduleSlot[];
}

function SetupFlow({ onGenerate, pending }: { onGenerate: (input: { split: string; mode: ScheduleModeId; trainingDays?: number[] }) => void; pending: boolean }) {
  const [split, setSplit] = useState<Exclude<WorkoutSplitId, "custom">>("ppl");
  const [mode, setMode] = useState<ScheduleModeId>("fixed");
  const [trainingDays, setTrainingDays] = useState<number[]>([1, 2, 3, 5, 6]);

  const toggleDay = (day: number) => {
    setTrainingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  return (
    <Card data-testid="card-schedule-setup">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Build Your Weekly Schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Workout Split</p>
          <Select value={split} onValueChange={(v) => setSplit(v as Exclude<WorkoutSplitId, "custom">)}>
            <SelectTrigger data-testid="select-setup-split">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPLITS_FOR_GENERATION.map((id) => (
                <SelectItem key={id} value={id} data-testid={`option-setup-split-${id}`}>
                  {workoutSplitLabels[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Schedule Type</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("fixed")}
              className={`text-left rounded-md border p-3 hover-elevate ${mode === "fixed" ? "ring-2 ring-ring" : ""}`}
              data-testid="button-setup-mode-fixed"
            >
              <p className="font-medium text-sm">Fixed weekdays</p>
              <p className="text-xs text-muted-foreground mt-1">
                Same days every week, e.g. Mon/Wed/Fri.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("rotating")}
              className={`text-left rounded-md border p-3 hover-elevate ${mode === "rotating" ? "ring-2 ring-ring" : ""}`}
              data-testid="button-setup-mode-rotating"
            >
              <p className="font-medium text-sm">Rotating cycle</p>
              <p className="text-xs text-muted-foreground mt-1">
                Cycle through your split regardless of weekday — advances each time you finish a workout.
              </p>
            </button>
          </div>
        </div>

        {mode === "fixed" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Training Days</p>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((name, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`h-9 w-12 rounded-md border text-xs font-medium hover-elevate ${
                    trainingDays.includes(idx) ? "bg-primary text-primary-foreground border-primary" : ""
                  }`}
                  data-testid={`button-training-day-${idx}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        <Button
          className="w-full gap-2"
          disabled={pending}
          onClick={() => onGenerate({ split, mode, trainingDays: mode === "fixed" ? trainingDays : undefined })}
          data-testid="button-generate-schedule"
        >
          <Sparkles className="h-4 w-4" />
          {pending ? "Generating..." : "Generate my schedule"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SlotTemplateSelect({
  slot,
  templates,
  onChange,
  testId,
}: {
  slot: ScheduleSlot;
  templates: WorkoutTemplateFull[];
  onChange: (workoutTemplateId: number | null) => void;
  testId: string;
}) {
  return (
    <Select
      value={slot.workoutTemplateId != null ? String(slot.workoutTemplateId) : "rest"}
      onValueChange={(v) => onChange(v === "rest" ? null : Number(v))}
    >
      <SelectTrigger className="h-8 text-xs w-full" data-testid={testId}>
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="rest">Rest Day</SelectItem>
        {templates.map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RotatingSlotRow({
  slot,
  templates,
  isCurrent,
  onChange,
}: {
  slot: ScheduleSlot;
  templates: WorkoutTemplateFull[];
  isCurrent: boolean;
  onChange: (workoutTemplateId: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const templateName = templates.find((t) => t.id === slot.workoutTemplateId)?.name ?? "Rest Day";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border p-3 ${isCurrent ? "ring-2 ring-ring" : ""}`}
      data-testid={`row-rotation-slot-${slot.id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground touch-none"
        aria-label="Drag to reorder"
        data-testid={`button-drag-slot-${slot.id}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate" data-testid={`text-rotation-slot-name-${slot.id}`}>
            {templateName}
          </p>
          {isCurrent && (
            <Badge variant="default" className="gap-1 text-[10px]" data-testid={`badge-you-are-here-${slot.id}`}>
              <MapPin className="h-3 w-3" />
              You are here
            </Badge>
          )}
        </div>
      </div>
      <div className="w-40 shrink-0">
        <SlotTemplateSelect slot={slot} templates={templates} onChange={onChange} testId={`select-rotation-slot-${slot.id}`} />
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const { activeUserId } = useActiveUser();
  const { toast } = useToast();
  const [showSetup, setShowSetup] = useState(false);

  const { data, isLoading } = useQuery<ScheduleResponse>({
    queryKey: ["/api/schedule", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/schedule");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const { data: templates } = useQuery<WorkoutTemplateFull[]>({
    queryKey: ["/api/workout-templates", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-templates");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
    queryClient.invalidateQueries({ queryKey: ["/api/users"] });
  };

  const generateMutation = useMutation({
    mutationFn: async (input: { split: string; mode: ScheduleModeId; trainingDays?: number[] }) => {
      const res = await apiRequest("POST", "/api/schedule/generate", input);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setShowSetup(false);
      toast({ title: "Schedule generated" });
    },
    onError: () => toast({ title: "Couldn't generate schedule", variant: "destructive" }),
  });

  const updateSlotsMutation = useMutation({
    mutationFn: async (input: { mode: ScheduleModeId; slots: Array<Partial<ScheduleSlot> & { dayOfWeek: number | null; position: number; workoutTemplateId: number | null }> }) => {
      const res = await apiRequest("PATCH", "/api/schedule", input);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Schedule updated", description: "Your workout split is now set to Custom." });
    },
    onError: () => toast({ title: "Couldn't update schedule", variant: "destructive" }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const hasSchedule = data?.schedule != null && (data?.slots.length ?? 0) > 0;
  const mode = data?.schedule?.mode ?? "fixed";
  const slots = [...(data?.slots ?? [])].sort((a, b) => a.position - b.position);
  const templateList = templates ?? [];

  const handleFixedDayChange = (slot: ScheduleSlot, workoutTemplateId: number | null) => {
    const nextSlots = slots.map((s) => (s.id === slot.id ? { ...s, workoutTemplateId } : s));
    updateSlotsMutation.mutate({
      mode: "fixed",
      slots: nextSlots.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        position: s.position,
        workoutTemplateId: s.workoutTemplateId,
        label: s.label,
      })),
    });
  };

  const handleRotatingChange = (slot: ScheduleSlot, workoutTemplateId: number | null) => {
    const nextSlots = slots.map((s) => (s.id === slot.id ? { ...s, workoutTemplateId } : s));
    updateSlotsMutation.mutate({
      mode: "rotating",
      slots: nextSlots.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        position: s.position,
        workoutTemplateId: s.workoutTemplateId,
        label: s.label,
      })),
    });
  };

  const handleRotationDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = slots.map((s) => s.id);
    const oldIndex = ids.indexOf(active.id as number);
    const newIndex = ids.indexOf(over.id as number);
    const newOrder = arrayMove(slots, oldIndex, newIndex).map((s, idx) => ({ ...s, position: idx }));
    updateSlotsMutation.mutate({
      mode: "rotating",
      slots: newOrder.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        position: s.position,
        workoutTemplateId: s.workoutTemplateId,
        label: s.label,
      })),
    });
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-display font-bold flex items-center gap-2" data-testid="text-page-title">
            <CalendarDays className="h-5 w-5" />
            Schedule
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-schedule-subtitle">
            Your auto-planned training week
          </p>
        </div>
        {hasSchedule && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setShowSetup((s) => !s)}
            data-testid="button-regenerate-schedule"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
        )}
      </div>

      {(!hasSchedule || showSetup) && (
        <SetupFlow onGenerate={(input) => generateMutation.mutate(input)} pending={generateMutation.isPending} />
      )}

      {!hasSchedule && !showSetup && (
        <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-schedule-hint">
          No schedule yet — generate one above to auto-plan your training week.
        </p>
      )}

      {hasSchedule && !showSetup && mode === "fixed" && (
        <Card data-testid="card-fixed-schedule">
          <CardHeader>
            <CardTitle className="text-base">Weekly Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="grid-fixed-schedule">
              {DAY_NAMES_FULL.map((dayName, dayIdx) => {
                const slot = slots.find((s) => s.dayOfWeek === dayIdx);
                if (!slot) return null;
                const isToday = new Date().getDay() === dayIdx;
                return (
                  <div
                    key={dayIdx}
                    className={`rounded-md border p-3 space-y-2 ${isToday ? "ring-2 ring-ring" : ""}`}
                    data-testid={`card-schedule-day-${dayIdx}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">{DAY_NAMES[dayIdx]}</p>
                      {isToday && (
                        <Badge variant="default" className="text-[9px] px-1.5 py-0">
                          Today
                        </Badge>
                      )}
                    </div>
                    <SlotTemplateSelect
                      slot={slot}
                      templates={templateList}
                      onChange={(id) => handleFixedDayChange(slot, id)}
                      testId={`select-schedule-day-${dayIdx}`}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {hasSchedule && !showSetup && mode === "rotating" && (
        <Card data-testid="card-rotating-schedule">
          <CardHeader>
            <CardTitle className="text-base">Rotation Order</CardTitle>
          </CardHeader>
          <CardContent>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRotationDragEnd}>
              <SortableContext items={slots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2" data-testid="list-rotation-slots">
                  {slots.map((slot) => (
                    <RotatingSlotRow
                      key={slot.id}
                      slot={slot}
                      templates={templateList}
                      isCurrent={slot.position === (data?.schedule?.rotationPosition ?? 0)}
                      onChange={(id) => handleRotatingChange(slot, id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
