/**
 * Timezone-explicit day-of-week helpers.
 *
 * "Is it Saturday" needs to mean the same thing to every viewer and to the
 * server itself, regardless of what timezone the server process happens to
 * run in (Vercel's is UTC). That's the exact ambiguity that caused this
 * app's kickoff-time bug -- formatting a date without naming a timezone
 * and letting whichever machine runs the code pick one for you. Here we
 * always name one explicitly, so the answer is deterministic everywhere.
 *
 * This is a *shared* fact ("is it Saturday, for this pool"), not a
 * per-viewer one like a kickoff time -- so unlike kickoff times, this is
 * fine to compute on the server and doesn't need a client component.
 */

export const APP_TIMEZONE = "America/Chicago";

/** "2026-08-29" in the given timezone. */
export function todayKeyIn(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function weekdayIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
}

export function isSaturdayIn(tz: string, d: Date = new Date()): boolean {
  return weekdayIn(tz, d) === "Sat";
}
