import { useQuery } from "@tanstack/react-query";
import { useActiveUser } from "@/lib/user-context";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { VOLUME_STATUS_LABEL } from "@/lib/format";

interface VolumeTrackerEntry {
  muscleGroupId: number;
  muscleGroupName: string;
  displayName: string;
  currentWeekSets: number;
  lastWeekSets: number;
  delta: number;
  trend: number[];
  mev: number;
  mav: number;
  mrv: number;
  status: "under" | "optimal" | "high" | "excessive";
}

const STATUS_BORDER: Record<string, string> = {
  under: "border-volume-under text-volume-under",
  optimal: "border-volume-optimal text-volume-optimal",
  high: "border-volume-high text-volume-high",
  excessive: "border-volume-excessive text-volume-excessive",
};

function DeltaIndicator({ delta }: { delta: number }) {
  if (delta > 0)
    return (
      <span className="flex items-center gap-0.5 text-volume-optimal text-xs font-medium">
        <ArrowUp className="h-3 w-3" /> +{delta}
      </span>
    );
  if (delta < 0)
    return (
      <span className="flex items-center gap-0.5 text-volume-excessive text-xs font-medium">
        <ArrowDown className="h-3 w-3" /> {delta}
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground text-xs font-medium">
      <Minus className="h-3 w-3" /> 0
    </span>
  );
}

function MuscleGroupCard({ entry }: { entry: VolumeTrackerEntry }) {
  const chartData = entry.trend.map((v, i) => ({
    week: i === entry.trend.length - 1 ? "This wk" : `-${entry.trend.length - 1 - i}w`,
    sets: v,
  }));

  return (
    <Card data-testid={`card-muscle-group-${entry.muscleGroupId}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{entry.displayName ?? entry.muscleGroupName}</CardTitle>
        <Badge variant="outline" className={`text-xs ${STATUS_BORDER[entry.status]}`}>
          {VOLUME_STATUS_LABEL[entry.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-display font-bold tabular-nums" data-testid={`text-current-sets-${entry.muscleGroupId}`}>
              {entry.currentWeekSets}
            </p>
            <p className="text-xs text-muted-foreground">sets this week</p>
          </div>
          <div className="text-right space-y-1">
            <DeltaIndicator delta={entry.delta} />
            <p className="text-xs text-muted-foreground">vs {entry.lastWeekSets} last week</p>
          </div>
        </div>

        <div className="flex justify-between text-xs text-muted-foreground border-t pt-2">
          <span>MEV {entry.mev}</span>
          <span>MAV {entry.mav}</span>
          <span>MRV {entry.mrv}</span>
        </div>

        <div className="h-32 w-full" data-testid={`chart-trend-${entry.muscleGroupId}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={28} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <ReferenceLine y={entry.mev} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
              <ReferenceLine y={entry.mav} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
              <ReferenceLine y={entry.mrv} stroke="hsl(var(--destructive))" strokeDasharray="2 2" />
              <Line
                type="monotone"
                dataKey="sets"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VolumeTracker() {
  const { activeUserId } = useActiveUser();
  const { data, isLoading } = useQuery<VolumeTrackerEntry[]>({
    queryKey: ["/api/volume-tracker"],
    enabled: activeUserId != null,
  });

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
          Volume Tracker
        </h1>
        <p className="text-sm text-muted-foreground">
          Weekly sets across 19 muscle groups vs MEV / MAV / MRV landmarks, with 6-week trend
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        {!isLoading && data?.map((entry) => <MuscleGroupCard key={entry.muscleGroupId} entry={entry} />)}
      </div>
    </div>
  );
}
