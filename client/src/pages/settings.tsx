import { useState } from "react";
import { Sun, Moon, Check, Settings as SettingsIcon, CalendarDays } from "lucide-react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";
import {
  themeColorIds,
  workoutSplitIds,
  workoutSplitLabels,
  type ThemeColorId,
  type WorkoutSplitId,
} from "@shared/schema";

// Light-mode --primary HSL for each palette id, used to render swatches for
// colors that may not currently be active (can't rely on CSS vars for that).
const THEME_COLOR_SWATCHES: Record<ThemeColorId, { label: string; hsl: string }> = {
  green: { label: "Forge Green", hsl: "142 76% 36%" },
  blue: { label: "Electric Blue", hsl: "217 91% 48%" },
  orange: { label: "Ember Orange", hsl: "22 88% 48%" },
  purple: { label: "Voltage Purple", hsl: "262 75% 50%" },
  red: { label: "Crimson", hsl: "4 78% 46%" },
  teal: { label: "Cyan Teal", hsl: "187 75% 38%" },
};

const WORKOUT_SPLIT_DESCRIPTIONS: Record<WorkoutSplitId, string> = {
  ppl: "Train pushing, pulling, and leg movements on separate days.",
  upper_lower: "Alternate between upper body and lower body sessions.",
  full_body: "Hit every major muscle group in each session.",
  bro_split: "Dedicate each session to a single muscle group.",
  custom: "Build your own rotation using workout templates.",
};

export default function Settings() {
  const { activeUser, activeUserId, isLoading } = useActiveUser();
  const { theme, themeColor, setTheme } = useTheme();
  const { toast } = useToast();

  const [pendingSplit, setPendingSplit] = useState<WorkoutSplitId | null>(null);

  const updatePreferences = useMutation({
    mutationFn: async (prefs: Record<string, string>) => {
      if (activeUserId == null) throw new Error("No active user");
      const res = await apiRequest("PATCH", `/api/users/${activeUserId}/preferences`, prefs);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Preferences saved" });
    },
    onError: () => {
      toast({ title: "Couldn't save preference", variant: "destructive" });
    },
  });

  const { data: existingSchedule } = useQuery<{ schedule: { mode: "fixed" | "rotating" } | null }>({
    queryKey: ["/api/schedule", activeUserId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/schedule");
      return res.json();
    },
    enabled: activeUserId != null,
  });

  const generateSchedule = useMutation({
    mutationFn: async (split: Exclude<WorkoutSplitId, "custom">) => {
      const mode = existingSchedule?.schedule?.mode ?? "fixed";
      const res = await apiRequest("POST", "/api/schedule/generate", { split, mode });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      toast({ title: "Schedule generated" });
    },
    onError: () => {
      toast({ title: "Couldn't generate schedule", variant: "destructive" });
    },
  });

  const handleSplitChange = (split: WorkoutSplitId) => {
    if (split === "custom") {
      updatePreferences.mutate({ workoutSplit: split });
      return;
    }
    setPendingSplit(split);
  };

  const confirmSplitChange = () => {
    if (!pendingSplit || pendingSplit === "custom") return;
    generateSchedule.mutate(pendingSplit);
    setPendingSplit(null);
  };

  if (isLoading || !activeUser) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
            Settings
          </h1>
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-display font-bold flex items-center gap-2" data-testid="text-page-title">
          <SettingsIcon className="h-5 w-5" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="text-settings-subtitle">
          Preferences for {activeUser.name}
        </p>
      </div>

      {/* Appearance — Mode */}
      <Card data-testid="card-appearance-mode">
        <CardHeader>
          <CardTitle className="text-base">Appearance — Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              className="flex-1 gap-2"
              onClick={() => setTheme("light", themeColor)}
              data-testid="button-mode-light"
            >
              <Sun className="h-4 w-4" />
              Light
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              className="flex-1 gap-2"
              onClick={() => setTheme("dark", themeColor)}
              data-testid="button-mode-dark"
            >
              <Moon className="h-4 w-4" />
              Dark
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Appearance — Accent Color */}
      <Card data-testid="card-appearance-color">
        <CardHeader>
          <CardTitle className="text-base">Appearance — Accent Color</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
            {themeColorIds.map((id) => {
              const swatch = THEME_COLOR_SWATCHES[id];
              const isSelected = themeColor === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={`${swatch.label} theme`}
                  onClick={() => setTheme(theme, id)}
                  className="flex flex-col items-center gap-1.5 group"
                  data-testid={`button-theme-color-${id}`}
                >
                  <span
                    className="relative flex h-10 w-10 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow"
                    style={{
                      background: `hsl(${swatch.hsl})`,
                      boxShadow: isSelected ? "0 0 0 2px hsl(var(--ring))" : undefined,
                    }}
                  >
                    {isSelected && <Check className="h-4 w-4 text-white drop-shadow" />}
                  </span>
                  <span className="text-[11px] text-muted-foreground text-center leading-tight">
                    {swatch.label}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Training — Workout Split */}
      <Card data-testid="card-workout-split">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Training — Workout Split</CardTitle>
          <Link href="/schedule">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" data-testid="link-view-schedule">
              <CalendarDays className="h-3.5 w-3.5" />
              View your schedule
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={activeUser.workoutSplit}
            onValueChange={(v) => handleSplitChange(v as WorkoutSplitId)}
            data-testid="radio-group-workout-split"
          >
            {workoutSplitIds.map((id: WorkoutSplitId) => (
              <label
                key={id}
                htmlFor={`split-${id}`}
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover-elevate"
                data-testid={`option-workout-split-${id}`}
              >
                <RadioGroupItem value={id} id={`split-${id}`} className="mt-0.5" data-testid={`radio-workout-split-${id}`} />
                <div className="space-y-0.5">
                  <Label htmlFor={`split-${id}`} className="cursor-pointer">
                    {workoutSplitLabels[id]}
                  </Label>
                  <p className="text-xs text-muted-foreground">{WORKOUT_SPLIT_DESCRIPTIONS[id]}</p>
                </div>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <AlertDialog open={pendingSplit != null} onOpenChange={(open) => !open && setPendingSplit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Generate a new {pendingSplit ? workoutSplitLabels[pendingSplit] : ""} schedule?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current weekly schedule with a fresh one built for this split. You can
              still edit it afterward from the Schedule page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-split-change">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSplitChange} data-testid="button-confirm-split-change">
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
