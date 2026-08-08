/**
 * Timezone handling for Forge.
 *
 * Forge separates two genuinely different concepts that were previously
 * conflated into a single date-only column:
 *
 *  1. **Civil date** ("which calendar day was this?") — depends on a timezone.
 *     Used for the calendar, history grouping and schedule matching. Computed
 *     in the user's *effective* zone at write time and then frozen, so a
 *     Tuesday-evening session in Seattle stays on Tuesday even after the user
 *     flies to Tokyo.
 *
 *  2. **Absolute instant** ("when exactly did this happen?") — timezone
 *     independent. Used for every elapsed-time calculation: fatigue decay,
 *     days-since-trained, rest between sessions. Because an instant is an
 *     instant, this stays correct across any amount of travel.
 *
 * Never derive one from the other after the fact.
 */

export const UTC = "UTC";

/** True for a syntactically usable IANA zone name on this runtime. */
export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the zone that should be used for civil-date math for a given user.
 *
 * - mode "home": use the user's configured home zone. This keeps training-week
 *   boundaries stable while travelling. Falls back to the client zone (and
 *   then UTC) if the user hasn't picked a home zone yet.
 * - mode "auto": follow the device, falling back to the home zone then UTC.
 */
export function resolveEffectiveZone(
  user: { timezoneMode?: string | null; homeTimezone?: string | null } | null | undefined,
  clientZone?: string | null,
): string {
  const home = isValidTimezone(user?.homeTimezone) ? user!.homeTimezone! : null;
  const client = isValidTimezone(clientZone) ? clientZone! : null;
  const mode = user?.timezoneMode === "auto" ? "auto" : "home";

  if (mode === "auto") return client ?? home ?? UTC;
  return home ?? client ?? UTC;
}

/**
 * The civil date (YYYY-MM-DD) for an instant, as observed in `zone`.
 *
 * Uses the en-CA locale because it formats as YYYY-MM-DD natively, which
 * avoids fragile manual padding/reordering.
 */
export function civilDateInZone(instant: Date, zone: string): string {
  const z = isValidTimezone(zone) ? zone : UTC;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: z,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The civil year-month (YYYY-MM) for an instant, as observed in `zone`. */
export function civilMonthInZone(instant: Date, zone: string): string {
  return civilDateInZone(instant, zone).slice(0, 7);
}

/**
 * The UTC offset of `zone` at `instant`, in minutes (east of UTC positive).
 *
 * Derived by formatting the instant in the target zone, reading the wall-clock
 * fields back as if they were UTC, and diffing. This correctly accounts for
 * DST because it asks Intl about that specific instant.
 */
export function zoneOffsetMinutes(instant: Date, zone: string): number {
  const z = isValidTimezone(zone) ? zone : UTC;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: z,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Intl can emit hour "24" at midnight under hour12:false; normalise to 0.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * The instant corresponding to local midnight (start of day) on a civil date
 * in `zone`. Used to build correct week/month windows for a travelling user.
 *
 * Resolved in two passes so that dates near a DST transition land correctly:
 * the first pass guesses using the offset at UTC-noon of that date, the second
 * corrects using the offset actually in effect at the guessed instant.
 */
export function startOfCivilDay(civilDate: string, zone: string): Date {
  const [y, m, d] = civilDate.split("-").map(Number);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const guessOffset = zoneOffsetMinutes(new Date(utcNoon), zone);
  const firstPass = Date.UTC(y, m - 1, d, 0, 0, 0) - guessOffset * 60000;
  const trueOffset = zoneOffsetMinutes(new Date(firstPass), zone);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - trueOffset * 60000);
}

/** Add `days` calendar days to a YYYY-MM-DD civil date (pure string math). */
export function addCivilDays(civilDate: string, days: number): string {
  const [y, m, d] = civilDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/**
 * Best-effort reconstruction of an absolute instant for a legacy workout row
 * that only ever stored a civil date.
 *
 * Anchors to 12:00 local in the given zone: a neutral midpoint that bounds the
 * worst-case error at 12h, versus midnight which is maximally wrong (and, when
 * naively parsed as UTC, lands on the previous evening for western zones).
 */
export function legacyInstantForCivilDate(civilDate: string, zone: string): Date {
  return new Date(startOfCivilDay(civilDate, zone).getTime() + 12 * 60 * 60 * 1000);
}

/**
 * Read the caller's device zone from a request header.
 * The client sends this on every request via `X-Client-Timezone`.
 */
export const CLIENT_TZ_HEADER = "x-client-timezone";
