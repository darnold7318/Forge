import { Pause, Play, TimerReset, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type RestTimer, useRestTimer } from "@/lib/rest-timer-context";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface RestTimerCardProps {
  timer: RestTimer;
  pause: (id: string) => void;
  resume: (id: string) => void;
  adjust: (id: string, deltaSeconds: number) => void;
  dismiss: (id: string) => void;
}

function RestTimerCard({ timer, pause, resume, adjust, dismiss }: RestTimerCardProps) {
  const { id, secondsLeft, totalSeconds, isRunning, label } = timer;
  const isDone = secondsLeft === 0;
  const progressPct = totalSeconds > 0 ? Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100)) : 0;
  const exerciseStatus = label
    ? isDone
      ? `${label} is ready`
      : `${label} cooling down`
    : isDone
      ? "Rest complete"
      : "Rest timer";

  return (
    <div
      className="relative overflow-hidden rounded-xl border bg-card shadow-lg"
      data-testid="card-rest-timer"
      data-timer-id={id}
    >
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
          <span className="text-xs text-muted-foreground truncate" data-testid="text-rest-timer-label">
            {exerciseStatus}
          </span>
        </div>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {!isDone && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => adjust(id, -15)}
                data-testid="button-rest-timer-minus15"
                aria-label={`Subtract 15 seconds from ${exerciseStatus}`}
              >
                <span className="text-xs font-semibold">-15</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => adjust(id, 15)}
                data-testid="button-rest-timer-plus15"
                aria-label={`Add 15 seconds to ${exerciseStatus}`}
              >
                <span className="text-xs font-semibold">+15</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => (isRunning ? pause(id) : resume(id))}
                data-testid={isRunning ? "button-rest-timer-pause" : "button-rest-timer-resume"}
                aria-label={`${isRunning ? "Pause" : "Resume"} ${exerciseStatus}`}
              >
                {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            </>
          )}
          {isDone && <TimerReset className="mx-2 h-4 w-4 text-primary" aria-hidden="true" />}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => dismiss(id)}
            data-testid="button-rest-timer-dismiss"
            aria-label={`Dismiss ${exerciseStatus}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RestTimerWidget() {
  const { timers, pause, resume, adjust, dismiss } = useRestTimer();

  if (timers.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm max-h-[calc(100vh-7rem)] overflow-y-auto"
      data-testid="widget-rest-timer"
      aria-label="Exercise rest timers"
    >
      <div className="flex flex-col gap-2">
        {timers.map((timer) => (
          <RestTimerCard
            key={timer.id}
            timer={timer}
            pause={pause}
            resume={resume}
            adjust={adjust}
            dismiss={dismiss}
          />
        ))}
      </div>
    </div>
  );
}
