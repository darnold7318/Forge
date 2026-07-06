export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const VOLUME_STATUS_COLOR: Record<string, string> = {
  under: "text-volume-under",
  optimal: "text-volume-optimal",
  high: "text-volume-high",
  excessive: "text-volume-excessive",
};

export const VOLUME_STATUS_BG: Record<string, string> = {
  under: "bg-volume-under",
  optimal: "bg-volume-optimal",
  high: "bg-volume-high",
  excessive: "bg-volume-excessive",
};

export const VOLUME_STATUS_LABEL: Record<string, string> = {
  under: "Under-training",
  optimal: "Optimal",
  high: "High",
  excessive: "Excessive",
};
