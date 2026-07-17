import { Pause, Play, TimerReset, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRestTimer } from "@/lib/rest-timer-context";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RestTimerWidget() {
  const { secondsLeft, totalSeconds, isRunning, label, pause, resume, adjust, dismiss } = useRestTimer();

  if (secondsLeft === null) return null;

  const isDone = secondsLeft === 0;
  const progressPct = totalSeconds > 0 ? Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100)) : 0;

  return (
    <div
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm"
      data-testid="widget-rest-timer"
    >
      <div className="relative overflow-hidden rounded-xl border bg-card shadow-lg">
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-1000 ease-linear ${
            isDone ? "bg-primary/25" : "bg-primary/15"
          }`}
          style={{ width: `${progressPct}%` }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3 px-4 py-3">
          <div className="flex flex-col min-w-0">
            <span
              className={`text-2xl font-bold tabular-nums leading-none ${isDone ? "text-primary" : ""}`}
              data-testid="text-rest-timer-clock"
            >
              {isDone ? "Rest done" : formatClock(secondsLeft)}
            </span>
            {label && (
              <span className="text-xs text-muted-foreground truncate" data-testid="text-rest-timer-label">
                {label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            {!isDone && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => adjust(-15)}
                  data-testid="button-rest-timer-minus15"
                  aria-label="Subtract 15 seconds"
                >
                  <span className="text-xs font-semibold">-15</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => adjust(15)}
                  data-testid="button-rest-timer-plus15"
                  aria-label="Add 15 seconds"
                >
                  <span className="text-xs font-semibold">+15</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => (isRunning ? pause() : resume())}
                  data-testid={isRunning ? "button-rest-timer-pause" : "button-rest-timer-resume"}
                  aria-label={isRunning ? "Pause rest timer" : "Resume rest timer"}
                >
                  {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
              </>
            )}
            {isDone && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => dismiss()}
                data-testid="button-rest-timer-restart-hint"
                aria-label="Rest complete"
              >
                <TimerReset className="h-4 w-4 text-primary" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => dismiss()}
              data-testid="button-rest-timer-dismiss"
              aria-label="Dismiss rest timer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
