import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface RestTimer {
  id: string;
  secondsLeft: number;
  totalSeconds: number;
  isRunning: boolean;
  label: string;
}

interface StoredRestTimer extends RestTimer {
  /** Wall-clock finish time. This keeps timers accurate when the tab is backgrounded. */
  endsAt: number | null;
}

interface RestTimerContextValue {
  /** Active, paused, and newly completed timers in the order they were started. */
  timers: RestTimer[];
  /** Add a new rest timer without replacing timers that are already counting down. */
  start: (seconds: number, label?: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  /** Add/subtract seconds from one running or paused timer (e.g. +/-15s). */
  adjust: (id: string, deltaSeconds: number) => void;
  /** Stop and hide one timer. */
  dismiss: (id: string) => void;
}

const RestTimerContext = createContext<RestTimerContextValue | undefined>(undefined);

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const playTone = (startTime: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    };
    const now = ctx.currentTime;
    playTone(now, 880);
    playTone(now + 0.35, 1046.5);
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    // Audio isn't critical — ignore failures (autoplay policy, unsupported browser, etc.)
  }
}

function vibrate() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([120, 60, 120]);
    }
  } catch {
    // ignore
  }
}

function currentSeconds(timer: StoredRestTimer, now = Date.now()): number {
  if (!timer.isRunning || timer.endsAt === null) return timer.secondsLeft;
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<StoredRestTimer[]>([]);
  const nextId = useRef(0);
  const completedTimerIds = useRef(new Set<string>());
  const hasRunningTimer = timers.some((timer) => timer.isRunning);

  const start = (seconds: number, newLabel: string = "") => {
    const duration = Math.max(0, Math.floor(seconds));
    const id = `rest-timer-${Date.now()}-${nextId.current++}`;
    setTimers((current) => [
      ...current,
      {
        id,
        secondsLeft: duration,
        totalSeconds: duration,
        isRunning: duration > 0,
        label: newLabel.trim(),
        endsAt: duration > 0 ? Date.now() + duration * 1000 : null,
      },
    ]);
  };

  const pause = (id: string) => {
    const now = Date.now();
    setTimers((current) =>
      current.map((timer) =>
        timer.id === id && timer.isRunning
          ? { ...timer, secondsLeft: currentSeconds(timer, now), isRunning: false, endsAt: null }
          : timer,
      ),
    );
  };

  const resume = (id: string) => {
    const now = Date.now();
    setTimers((current) =>
      current.map((timer) => {
        if (timer.id !== id || timer.isRunning || timer.secondsLeft <= 0) return timer;
        completedTimerIds.current.delete(id);
        return { ...timer, isRunning: true, endsAt: now + timer.secondsLeft * 1000 };
      }),
    );
  };

  const adjust = (id: string, deltaSeconds: number) => {
    const now = Date.now();
    setTimers((current) =>
      current.map((timer) => {
        if (timer.id !== id) return timer;
        const nextSeconds = Math.max(0, currentSeconds(timer, now) + deltaSeconds);
        if (nextSeconds > 0) completedTimerIds.current.delete(id);
        return {
          ...timer,
          secondsLeft: nextSeconds,
          totalSeconds: Math.max(timer.totalSeconds, nextSeconds),
          isRunning: timer.isRunning && nextSeconds > 0,
          endsAt: timer.isRunning && nextSeconds > 0 ? now + nextSeconds * 1000 : null,
        };
      }),
    );
  };

  const dismiss = (id: string) => {
    completedTimerIds.current.delete(id);
    setTimers((current) => current.filter((timer) => timer.id !== id));
  };

  useEffect(() => {
    if (!hasRunningTimer) return;

    const tick = () => {
      const now = Date.now();
      setTimers((current) => {
        let changed = false;
        const next = current.map((timer) => {
          if (!timer.isRunning) return timer;
          const secondsLeft = currentSeconds(timer, now);
          if (secondsLeft === timer.secondsLeft) return timer;
          changed = true;
          return {
            ...timer,
            secondsLeft,
            isRunning: secondsLeft > 0,
            endsAt: secondsLeft > 0 ? timer.endsAt : null,
          };
        });
        return changed ? next : current;
      });
    };

    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [hasRunningTimer]);

  useEffect(() => {
    let newlyCompleted = false;
    for (const timer of timers) {
      if (timer.secondsLeft === 0 && !completedTimerIds.current.has(timer.id)) {
        completedTimerIds.current.add(timer.id);
        newlyCompleted = true;
      }
    }
    if (newlyCompleted) {
      playBeep();
      vibrate();
    }
  }, [timers]);

  return (
    <RestTimerContext.Provider value={{ timers, start, pause, resume, adjust, dismiss }}>
      {children}
    </RestTimerContext.Provider>
  );
}

export function useRestTimer() {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error("useRestTimer must be used within a RestTimerProvider");
  return ctx;
}
