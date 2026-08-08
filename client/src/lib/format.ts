/**
 * Render a civil date string (YYYY-MM-DD) exactly as written.
 *
 * These strings are calendar days, not instants. Parsing "2026-07-16" yields
 * UTC midnight, so formatting it in a western local zone used to render it as
 * Jul 15 — an off-by-one that made logged workouts appear a day early. Pinning
 * the formatter to UTC keeps the displayed day identical to the stored day for
 * every viewer, wherever they are.
 */
function formatCivilDate(dateStr: string, opts: Intl.DateTimeFormatOptions): string {
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const d = new Date(civil ? `${dateStr}T00:00:00Z` : dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", civil ? { ...opts, timeZone: "UTC" } : opts);
}

export function formatDate(dateStr: string): string {
  return formatCivilDate(dateStr, { month: "short", day: "numeric", year: "numeric" });
}

export function formatShortDate(dateStr: string): string {
  return formatCivilDate(dateStr, { month: "short", day: "numeric" });
}

/**
 * Today's civil date on this device (YYYY-MM-DD).
 *
 * Uses en-CA because it formats as YYYY-MM-DD natively. Previously this was
 * `toISOString().slice(0, 10)`, which is the *UTC* date — so after 5pm Pacific
 * the whole UI believed it was already tomorrow.
 *
 * Note this is the *device* zone. The server is authoritative for anything
 * persisted (it applies the user's home-timezone preference); this is only for
 * optimistic local rendering.
 */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
