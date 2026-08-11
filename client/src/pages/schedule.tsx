import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarDays, ChevronLeft, ChevronRight, Moon, Sparkles, Dumbbell, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import { workoutSplitIds, workoutSplitLabels, type WorkoutSplitId } from "@shared/schema";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SPLITS_FOR_GENERATION: WorkoutSplitId[] = [...workoutSplitIds];

interface ScheduleDay {
  id: number;
  scheduleId: number;
  date: string; // YYYY-MM-DD
  workoutTemplateId: number | null;
  label: string | null;
  isManualOverride: boolean;
  isWeeklyBlocked: boolean;
  hasCoreAddon: boolean;
}

interface WorkoutTemplateLite {
  id: number;
  name: string;
}

interface ScheduleResponse {
  id: number;
  userId: number;
  activeSplit: string | null;
  rotationCycle: string;
  rotationCursor: number;
  weeklyRestDays: string; // JSON array of 0-6
  lastGeneratedMonth: string | null;
  customWeeklyTemplate: string; // JSON array of 7 slots, index 0=Sun..6=Sat
  days: ScheduleDay[];
}

const LABEL_COLORS: Record<string, string> = {
  Push: "bg-chart-1/15 border-chart-1/40 text-chart-1",
  Pull: "bg-chart-2/15 border-chart-2/40 text-chart-2",
  Legs: "bg-chart-3/15 border-chart-3/40 text-chart-3",
  Upper: "bg-chart-1/15 border-chart-1/40 text-chart-1",
  Lower: "bg-chart-3/15 border-chart-3/40 text-chart-3",
  Rest: "bg-muted border-border text-muted-foreground",
};
const FALLBACK_COLORS = [
  "bg-chart-1/15 border-chart-1/40 text-chart-1",
  "bg-chart-2/15 border-chart-2/40 text-chart-2",
  "bg-chart-3/15 border-chart-3/40 text-chart-3",
  "bg-chart-4/15 border-chart-4/40 text-chart-4",
  "bg-chart-5/15 border-chart-5/40 text-chart-5",
];

// Alternate substrings that should map to an existing LABEL_COLORS entry — handles custom-
// template names/singulars like "Push Day", "Pull Day (Edited)", "Leg Day" (singular "Leg"
// vs. the canonical plural "Legs" key).
const LABEL_KEYWORD_ALIASES: Record<string, string> = {
  push: "Push",
  pull: "Pull",
  leg: "Legs",
  legs: "Legs",
  upper: "Upper",
  lower: "Lower",
};

function colorForLabel(label: string | null): string {
  if (!label) return "border-dashed border-border text-muted-foreground";
  if (LABEL_COLORS[label]) return LABEL_COLORS[label];
  // Custom-template labels are often variations like "Push Day", "Pull Day (Edited)", or a
  // renamed template name — match on the well-known keyword first so they inherit the same
  // color as the base split label instead of falling into an arbitrary hash bucket.
  const lower = label.toLowerCase();
  for (const [keyword, canonicalKey] of Object.entries(LABEL_KEYWORD_ALIASES)) {
    if (lower.includes(keyword)) return LABEL_COLORS[canonicalKey];
  }
  // Stable fallback color derived from the label string for splits like "Full Body A" / "Chest".
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function todayIso(): string {
  // Device-local civil date. Must NOT be toISOString() — that is the UTC date,
  // which rolls over mid-evening for western zones and highlighted the wrong
  // day on the calendar.
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}


function monthKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

function DayBubble({
  day,
  isOverlay = false,
  onClear,
}: {
  day: ScheduleDay;
  isOverlay?: boolean;
  onClear?: (date: string) => void;
}) {
  // Synthetic drag-preview bubble for the Core palette item (id === -1, label "Core").
  const isCorePreview = day.id === -1 && day.label === "Core";
  // A synthetic palette-label preview (id === -1) with a real label is never Rest, even before
  // the server resolves its final workoutTemplateId. Real calendar days still key off
  // workoutTemplateId, since that's the authoritative Rest/workout signal from the backend.
  const isRest = !isCorePreview && (day.id === -1 ? day.label == null : day.workoutTemplateId == null);
  const text = isCorePreview ? "Core" : isRest ? "Rest" : day.label ?? "Workout";
  const showClear = Boolean(onClear) && !isRest && !isCorePreview && !isOverlay;
  return (
    <div
      className={`group flex items-center justify-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium truncate select-none ${
        isCorePreview ? "bg-chart-5/15 border-chart-5/40 text-chart-5" : colorForLabel(isRest ? "Rest" : day.label)
      } ${isOverlay ? "shadow-lg" : ""}`}
      data-testid={`bubble-day-${day.date}`}
    >
      {isCorePreview ? (
        <Dumbbell className="h-3 w-3 shrink-0" />
      ) : isRest ? (
        <Moon className="h-3 w-3 shrink-0" />
      ) : null}
      <span className="truncate">{text}</span>
      {showClear && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClear!(day.date);
          }}
          className="shrink-0"
          title="Clear this day"
          data-testid={`button-clear-day-${day.date}`}
        >
          <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

function DraggableBubble({
  day,
  onClear,
  onStartWorkout,
}: {
  day: ScheduleDay;
  onClear?: (date: string) => void;
  onStartWorkout?: (workoutTemplateId: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `day:${day.date}`,
    data: { type: "day", day },
  });
  const canStart = Boolean(onStartWorkout) && day.workoutTemplateId != null;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onDoubleClick={canStart ? () => onStartWorkout!(day.workoutTemplateId) : undefined}
      className={`cursor-grab touch-none ${isDragging ? "opacity-30" : ""} ${canStart ? "cursor-pointer" : ""}`}
      title={canStart ? "Double-click to start this workout" : undefined}
      data-testid={`draggable-day-${day.date}`}
    >
      <DayBubble day={day} onClear={onClear} />
    </div>
  );
}

function RestPaletteBubble() {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: "palette:rest",
    data: { type: "palette-rest" },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none ${isDragging ? "opacity-30" : ""}`}
      data-testid="draggable-palette-rest"
    >
      <div className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <Moon className="h-3.5 w-3.5" />
        Drag a Rest Day onto the calendar
      </div>
    </div>
  );
}

/** Palette bubble for one of the active split's own day-types (e.g. Push/Pull/Legs, or a Custom
 *  split's label) so the user can drag it directly onto any day without hunting for an existing
 *  occurrence of that label elsewhere on the calendar. */
function LabelPaletteBubble({ label, workoutTemplateId }: { label: string; workoutTemplateId: number | null }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:label:${label}`,
    data: { type: "palette-label", label, workoutTemplateId },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none ${isDragging ? "opacity-30" : ""}`}
      data-testid={`draggable-palette-label-${label}`}
    >
      <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${colorForLabel(label)}`}>
        {label}
      </div>
    </div>
  );
}

function CalendarCell({
  date,
  day,
  isToday,
  isCurrentMonth,
  onClearDay,
  onStartWorkout,
}: {
  date: string;
  day: ScheduleDay | undefined;
  isToday: boolean;
  isCurrentMonth: boolean;
  onClearDay: (date: string) => void;
  onStartWorkout: (workoutTemplateId: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${date}`, data: { type: "cell", date } });
  const dayNum = Number(date.slice(8, 10));

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[64px] sm:min-h-[76px] rounded-md border p-1.5 flex flex-col gap-1 transition-colors ${
        isCurrentMonth ? "" : "opacity-40"
      } ${isToday ? "ring-2 ring-ring" : ""} ${isOver ? "bg-accent" : ""}`}
      data-testid={`cell-day-${date}`}
    >
      <div className="flex items-center gap-1 px-0.5">
        <span className={`text-[11px] ${isToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>
          {dayNum}
        </span>
        {isToday && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Today" />}
      </div>
      {day ? (
        <DraggableBubble day={day} onClear={onClearDay} onStartWorkout={onStartWorkout} />
      ) : (
        <div className="h-[26px]" />
      )}
    </div>
  );
}

export default function SchedulePage() {
  const { activeUserId } = useActiveUser();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-11
  const [showSetup, setShowSetup] = useState(false);
  const [pendingSplit, setPendingSplit] = useState<WorkoutSplitId | null>(null);
  const [dragDay, setDragDay] = useState<ScheduleDay | null>(null);
  const [pendingRestDrop, setPendingRestDrop] = useState<string | null>(null); // target date that already has a training day

  const yearMonth = monthKey(viewYear, viewMonth);

  const { data, isLoading } = useQuery<ScheduleResponse>({
    queryKey: ["/api/schedule", activeUserId, yearMonth],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/schedule?month=${yearMonth}`);
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const { data: templates } = useQuery<WorkoutTemplateLite[]>({
    queryKey: ["/api/workout-templates", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-templates");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const startWorkout = (workoutTemplateId: number | null) => {
    if (workoutTemplateId == null) return;
    setLocation(`/log?template=${workoutTemplateId}`);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  };

  const generateMutation = useMutation({
    mutationFn: async (split: WorkoutSplitId) => {
      const res = await apiRequest("POST", "/api/schedule/generate", { split, month: yearMonth });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setShowSetup(false);
      toast({ title: "Calendar generated" });
    },
    onError: () => toast({ title: "Couldn't generate calendar", variant: "destructive" }),
  });

  const weeklyRestMutation = useMutation({
    mutationFn: async (days: number[]) => {
      const res = await apiRequest("PATCH", "/api/schedule/weekly-rest-days", { days });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Weekly rest days updated" });
    },
    onError: () => toast({ title: "Couldn't update rest days", variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: async (input: { fromDate: string; toDate: string; mode: "swap" | "shift" | "skip" }) => {
      const res = await apiRequest("POST", "/api/schedule/move", input);
      return res.json();
    },
    onSuccess: () => invalidate(),
    onError: () => toast({ title: "Couldn't move day", variant: "destructive" }),
  });

  const setDayMutation = useMutation({
    mutationFn: async (input: { date: string; workoutTemplateId: number | null; label?: string | null }) => {
      const res = await apiRequest("POST", "/api/schedule/day", input);
      return res.json();
    },
    onSuccess: () => invalidate(),
    onError: () => toast({ title: "Couldn't update day", variant: "destructive" }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const days = data?.days ?? [];
  const daysByDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const weeklyRestDays: number[] = useMemo(() => {
    try {
      return JSON.parse(data?.weeklyRestDays ?? "[]");
    } catch {
      return [];
    }
  }, [data?.weeklyRestDays]);
  const hasActiveSplit = data?.activeSplit != null;

  // Palette bubbles are pulled straight from the user's saved Templates list — one bubble per
  // template, by name — so the palette always matches whatever exists on the Templates page,
  // regardless of which split is active or what's already painted on the calendar.
  const paletteTemplates = useMemo(
    () => (templates ?? []).map((t) => ({ label: t.name, workoutTemplateId: t.id })),
    [templates],
  );

  // Build the calendar grid: leading/trailing days from adjacent months to fill full weeks.
  const gridCells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startOffset = firstOfMonth.getUTCDay(); // 0=Sun
    // Built with UTC-based civil arithmetic. Using local Date objects and then
    // toISOString() shifted every cell back a day for zones east of UTC.
    const cells: { date: string; isCurrentMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(Date.UTC(viewYear, viewMonth, 1 - startOffset + i));
      cells.push({
        date: d.toISOString().slice(0, 10),
        isCurrentMonth: d.getUTCMonth() === viewMonth && d.getUTCFullYear() === viewYear,
      });
    }
    // Trim trailing all-next-month rows beyond the 5th week if the 6th week is entirely outside the month.
    const lastRowStart = 35;
    const sixthWeekHasCurrentMonth = cells.slice(lastRowStart).some((c) => c.isCurrentMonth);
    return sixthWeekHasCurrentMonth ? cells : cells.slice(0, 35);
  }, [viewYear, viewMonth]);

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const toggleWeeklyRestDay = (dow: number) => {
    const next = weeklyRestDays.includes(dow) ? weeklyRestDays.filter((d) => d !== dow) : [...weeklyRestDays, dow];
    weeklyRestMutation.mutate(next.sort());
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "day") setDragDay(data.day as ScheduleDay);
    else if (data?.type === "palette-rest")
      setDragDay({ id: -1, scheduleId: -1, date: "", workoutTemplateId: null, label: "Rest", isManualOverride: false, isWeeklyBlocked: false, hasCoreAddon: false });
    else if (data?.type === "palette-label")
      setDragDay({
        id: -1,
        scheduleId: -1,
        date: "",
        workoutTemplateId: data.workoutTemplateId ?? null,
        label: data.label as string,
        isManualOverride: false,
        isWeeklyBlocked: false,
        hasCoreAddon: false,
      });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDragDay(null);
    if (!over) return;
    const overData = over.data.current;
    if (overData?.type !== "cell") return;
    const toDate = overData.date as string;

    const activeData = active.data.current;
    if (activeData?.type === "palette-rest") {
      const existing = daysByDate.get(toDate);
      if (existing && existing.workoutTemplateId != null) {
        // Dropping Rest onto an occupied training day — ask shift vs skip.
        setPendingRestDrop(toDate);
        return;
      }
      setDayMutation.mutate({ date: toDate, workoutTemplateId: null, label: "Rest" });
      return;
    }

    if (activeData?.type === "palette-label") {
      setDayMutation.mutate({
        date: toDate,
        workoutTemplateId: (activeData.workoutTemplateId as number | null) ?? null,
        label: activeData.label as string,
      });
      return;
    }

    if (activeData?.type === "day") {
      const fromDate = (activeData.day as ScheduleDay).date;
      if (fromDate === toDate) return;
      moveMutation.mutate({ fromDate, toDate, mode: "swap" });
    }
  };

  // Manually clear a day back to Rest — marks it a manual override so auto-generation for any
  // split (rotation or Custom) leaves it alone going forward, exactly like dragging Rest onto it.
  const clearDay = (date: string) => {
    setDayMutation.mutate({ date, workoutTemplateId: null, label: "Rest" });
  };

  const resolveRestDrop = (mode: "shift" | "skip") => {
    if (!pendingRestDrop) return;
    // A synthetic "fromDate" isn't meaningful for the palette bubble, so just set the day directly
    // for skip, or use the move endpoint's shift behavior seeded from a Rest day.
    if (mode === "skip") {
      setDayMutation.mutate({ date: pendingRestDrop, workoutTemplateId: null, label: "Rest" });
    } else {
      moveMutation.mutate({ fromDate: pendingRestDrop, toDate: pendingRestDrop, mode: "shift" });
    }
    setPendingRestDrop(null);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-display font-bold flex items-center gap-2" data-testid="text-page-title">
            <CalendarDays className="h-5 w-5" />
            Schedule
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-schedule-subtitle">
            Drag bubbles to rearrange your training calendar
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setShowSetup((s) => !s)}
          data-testid="button-toggle-setup"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {hasActiveSplit ? "Change Split" : "Auto-generate"}
        </Button>
      </div>

      {(showSetup || !hasActiveSplit) && (
        <Card data-testid="card-schedule-setup">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Auto-generate a split
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Workout Split</p>
              <Select
                value={data?.activeSplit ?? "ppl"}
                onValueChange={(v) => setPendingSplit(v as WorkoutSplitId)}
              >
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
            {pendingSplit === "custom" || (!pendingSplit && data?.activeSplit === "custom") ? (
              <p className="text-xs text-muted-foreground">
                Applies your fixed Mon–Sun template every week, forever — no rotation.{" "}
                <Link href="/settings" className="underline" data-testid="link-edit-custom-template">
                  Edit the template in Settings
                </Link>
                .
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                This repeats on a continuous rotation and keeps generating into future months automatically.
              </p>
            )}
            {pendingSplit && (
              <Button
                className="w-full gap-2"
                disabled={generateMutation.isPending}
                onClick={() => generateMutation.mutate(pendingSplit)}
                data-testid="button-generate-schedule"
              >
                <Sparkles className="h-4 w-4" />
                {generateMutation.isPending ? "Generating..." : `Apply ${workoutSplitLabels[pendingSplit]}`}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <Card data-testid="card-calendar">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <Button variant="ghost" size="icon" onClick={goPrevMonth} data-testid="button-prev-month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-base" data-testid="text-current-month">
              {new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={goNextMonth} data-testid="button-next-month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <RestPaletteBubble />
              {paletteTemplates.map(({ label, workoutTemplateId }) => (
                <LabelPaletteBubble key={workoutTemplateId} label={label} workoutTemplateId={workoutTemplateId} />
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {DAY_NAMES.map((name) => (
                <div key={name} className="text-[10px] font-semibold text-muted-foreground py-1">
                  {name}
                </div>
              ))}
              {gridCells.map((cell) => (
                <CalendarCell
                  key={cell.date}
                  date={cell.date}
                  day={daysByDate.get(cell.date)}
                  isToday={cell.date === todayIso()}
                  isCurrentMonth={cell.isCurrentMonth}
                  onClearDay={clearDay}
                  onStartWorkout={startWorkout}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <DragOverlay>{dragDay ? <DayBubble day={dragDay} isOverlay /> : null}</DragOverlay>
      </DndContext>

      <Card data-testid="card-weekly-rest">
        <CardHeader>
          <CardTitle className="text-base">Weekly Rest Days</CardTitle>
          <p className="text-xs text-muted-foreground">
            Checked days are always kept as rest going forward. You can still drag a workout onto one manually.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {DAY_NAMES_FULL.map((name, idx) => (
              <label
                key={idx}
                className="flex items-center gap-1.5 text-sm cursor-pointer"
                data-testid={`label-weekly-rest-${idx}`}
              >
                <Checkbox
                  checked={weeklyRestDays.includes(idx)}
                  onCheckedChange={() => toggleWeeklyRestDay(idx)}
                  data-testid={`checkbox-weekly-rest-${idx}`}
                />
                {DAY_NAMES[idx]}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={pendingRestDrop != null} onOpenChange={(open) => !open && setPendingRestDrop(null)}>
        <AlertDialogContent data-testid="dialog-rest-drop-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>This day already has a workout</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to shift the rest of this month's schedule forward by one day, or just skip this day
              without changing anything else?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rest-drop">Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => resolveRestDrop("skip")} data-testid="button-skip-rest-drop">
              Skip
            </Button>
            <AlertDialogAction onClick={() => resolveRestDrop("shift")} data-testid="button-shift-rest-drop">
              Shift schedule right
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
