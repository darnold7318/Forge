import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useActiveUser } from "@/lib/user-context";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { formatShortDate, formatDate } from "@/lib/format";
import type { Exercise } from "@shared/schema";

interface HistorySet {
  id: number;
  workoutId: number;
  weight: number;
  reps: number;
  durationSeconds: number | null;
  rir: number | null;
  isWarmup: boolean;
  workoutDate: string;
}

interface PersonalRecord {
  exerciseId: number;
  exerciseName: string;
  recordType: "Heaviest Set" | "Estimated 1RM" | "Best Set Volume" | "Exercise Volume" | "Longest Hold";
  value: number;
  achievedAt: string;
  summary: string;
}

function estimate1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

const RECORD_TYPE_ICON_CLASS = "h-3.5 w-3.5";

export default function ProgressPage() {
  const params = useParams<{ exerciseId?: string }>();
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<string>(params.exerciseId ?? "");

  const { data: exercises, isLoading: exercisesLoading } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });

  const activeId = params.exerciseId ?? selectedId;

  const { activeUserId } = useActiveUser();

  const { data: history, isLoading: historyLoading } = useQuery<HistorySet[]>({
    queryKey: ["/api/exercises", activeId, "sets", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/exercises/${activeId}/sets`);
      return res.json();
    },
    enabled: !!activeId && activeUserId != null,
  });

  const { data: records, isLoading: recordsLoading } = useQuery<PersonalRecord[]>({
    queryKey: ["/api/exercises", activeId, "records", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/exercises/${activeId}/records`);
      return res.json();
    },
    enabled: !!activeId && activeUserId != null,
  });

  const selectedExercise = exercises?.find((e) => String(e.id) === activeId);
  const isDuration = selectedExercise?.trackingMode === "duration";

  const chartData = useMemo(() => {
    if (!history) return [];
    const byWorkout = new Map<number, HistorySet[]>();
    for (const s of history) {
      if (s.isWarmup) continue;
      if (!byWorkout.has(s.workoutId)) byWorkout.set(s.workoutId, []);
      byWorkout.get(s.workoutId)!.push(s);
    }
    return Array.from(byWorkout.values())
      .map((sets) => {
        const date = sets[0].workoutDate;
        const topSet = sets.reduce((best, s) => (s.weight > best.weight ? s : best), sets[0]);
        const e1rm = Math.max(...sets.map((s) => estimate1RM(s.weight, s.reps)));
        const longestHold = Math.max(...sets.map((s) => s.durationSeconds ?? 0));
        return {
          date,
          label: formatShortDate(date),
          topWeight: topSet.weight,
          e1RM: Math.round(e1rm * 10) / 10,
          longestHold,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [history]);

  const sessionRows = useMemo(() => {
    if (!history) return [];
    const byWorkout = new Map<number, HistorySet[]>();
    for (const s of history) {
      if (!byWorkout.has(s.workoutId)) byWorkout.set(s.workoutId, []);
      byWorkout.get(s.workoutId)!.push(s);
    }
    return Array.from(byWorkout.values()).sort((a, b) =>
      b[0].workoutDate.localeCompare(a[0].workoutDate),
    );
  }, [history]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setLocation(`/progress/${id}`);
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
          Exercise Progress
        </h1>
        <p className="text-sm text-muted-foreground">Track strength, hold duration, and personal records</p>
      </div>

      <Card>
        <CardContent className="p-4">
          {exercisesLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select value={activeId} onValueChange={handleSelect}>
              <SelectTrigger data-testid="select-progress-exercise">
                <SelectValue placeholder="Choose an exercise" />
              </SelectTrigger>
              <SelectContent>
                {(exercises ?? []).map((ex) => (
                  <SelectItem key={ex.id} value={String(ex.id)}>
                    {ex.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {!activeId && (
        <div className="flex flex-col items-center text-center gap-3 py-16 text-muted-foreground">
          <TrendingUp className="h-8 w-8 text-muted-foreground/60" />
          <p>Select an exercise to view its progress chart.</p>
        </div>
      )}

      {activeId && !recordsLoading && (records?.length ?? 0) > 0 && (
        <Card data-testid="card-personal-records">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              Personal Records
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {records!.map((r, i) => (
                <div
                  key={`${r.recordType}-${i}`}
                  className="rounded-md border p-3 space-y-1"
                  data-testid={`row-pr-${r.recordType.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={RECORD_TYPE_ICON_CLASS}>
                      {r.recordType}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(r.achievedAt)}</span>
                  </div>
                  <p className="text-sm">{r.summary}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeId && historyLoading && <Skeleton className="h-72 w-full" />}

      {activeId && !historyLoading && chartData.length === 0 && (
        <div className="flex flex-col items-center text-center gap-3 py-16 text-muted-foreground">
          <TrendingUp className="h-8 w-8 text-muted-foreground/60" />
          <p>No logged sets for {selectedExercise?.name ?? "this exercise"} yet.</p>
        </div>
      )}

      {activeId && !historyLoading && chartData.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base" data-testid="text-chart-title">
                {selectedExercise?.name} — {isDuration ? "Longest Hold" : "Top Set Weight & Est. 1RM"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full" data-testid="chart-progress">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {isDuration ? (
                      <Line
                        type="monotone"
                        dataKey="longestHold"
                        name="Longest hold (sec)"
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ) : (
                      <>
                        <Line
                          type="monotone"
                          dataKey="topWeight"
                          name="Top set weight"
                          stroke="hsl(var(--chart-1))"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="e1RM"
                          name="Est. 1RM"
                          stroke="hsl(var(--chart-2))"
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          dot={{ r: 3 }}
                        />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Session History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Sets</TableHead>
                      <TableHead className="text-right">{isDuration ? "Longest hold" : "Top e1RM"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionRows.map((sets) => {
                      const workingSets = sets.filter((s) => !s.isWarmup);
                      const topE1RM =
                        workingSets.length > 0
                          ? Math.max(...workingSets.map((s) => estimate1RM(s.weight, s.reps)))
                          : 0;
                      return (
                        <TableRow key={sets[0].workoutId} data-testid={`row-session-${sets[0].workoutId}`}>
                          <TableCell className="whitespace-nowrap">{formatDate(sets[0].workoutDate)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {workingSets.map((s) => (
                                <span
                                  key={s.id}
                                  className="text-xs font-mono tabular-nums bg-muted rounded px-1.5 py-0.5"
                                >
                                  {isDuration
                                    ? `${s.durationSeconds ?? 0} sec${
                                        s.weight > 0
                                          ? selectedExercise?.equipment === "Bodyweight" ? ` @ +${s.weight} lb` : ` @ ${s.weight} lb`
                                          : ""
                                      }`
                                    : `${s.weight}×${s.reps}`}
                                  {s.rir != null ? ` @${s.rir}RIR` : ""}
                                </span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {isDuration
                              ? workingSets.length > 0
                                ? `${Math.max(...workingSets.map((s) => s.durationSeconds ?? 0))} sec`
                                : "—"
                              : topE1RM > 0 ? topE1RM.toFixed(1) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
