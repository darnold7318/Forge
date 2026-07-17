import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface RestTimerContextValue {
  /** Seconds remaining, or null when no timer is running/paused-with-value. */
  secondsLeft: number | null;
  /** Total duration of the current/most-recent timer, for progress display. */
  totalSeconds: number;
  isRunning: boolean;
  isPaused: boolean;
  /** Label shown in the widget, e.g. the exercise name the rest is for. */
  label: string;
  /** Start (or restart) a rest timer for `seconds`, optionally labeled. */
  start: (seconds: number, label?: string) => void;
  pause: () => void;
  resume: () => void;
  /** Add/subtract seconds from the running or paused timer (e.g. +/-15s). */
  adjust: (deltaSeconds: number) => void;
  /** Stop and hide the timer entirely. */
  dismiss: () => void;
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

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [label, setLabel] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasFiredCompletion = useRef(false);

  const clearTick = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const tick = () => {
    setSecondsLeft((prev) => {
      if (prev === null) return prev;
      if (prev <= 1) {
        clearTick();
        setIsRunning(false);
        if (!hasFiredCompletion.current) {
          hasFiredCompletion.current = true;
          playBeep();
          vibrate();
        }
        return 0;
      }
      return prev - 1;
    });
  };

  const start = (seconds: number, newLabel: string = "") => {
    clearTick();
    hasFiredCompletion.current = false;
    setTotalSeconds(seconds);
    setSecondsLeft(seconds);
    setLabel(newLabel);
    setIsRunning(true);
    intervalRef.current = setInterval(tick, 1000);
  };

  const pause = () => {
    clearTick();
    setIsRunning(false);
  };

  const resume = () => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    clearTick();
    hasFiredCompletion.current = false;
    setIsRunning(true);
    intervalRef.current = setInterval(tick, 1000);
  };

  const adjust = (deltaSeconds: number) => {
    setSecondsLeft((prev) => {
      if (prev === null) return prev;
      const next = Math.max(0, prev + deltaSeconds);
      if (next > 0) hasFiredCompletion.current = false;
      return next;
    });
    setTotalSeconds((prev) => Math.max(prev, (secondsLeft ?? 0) + deltaSeconds));
  };

  const dismiss = () => {
    clearTick();
    setIsRunning(false);
    setSecondsLeft(null);
    setTotalSeconds(0);
    setLabel("");
  };

  useEffect(() => () => clearTick(), []);

  return (
    <RestTimerContext.Provider
      value={{
        secondsLeft,
        totalSeconds,
        isRunning,
        isPaused: secondsLeft !== null && secondsLeft > 0 && !isRunning,
        label,
        start,
        pause,
        resume,
        adjust,
        dismiss,
      }}
    >
      {children}
    </RestTimerContext.Provider>
  );
}

export function useRestTimer() {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error("useRestTimer must be used within a RestTimerProvider");
  return ctx;
}
