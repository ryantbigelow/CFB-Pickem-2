/**
 * Refreshing betting lines on page load, without ever running out of credits.
 *
 * THE ECONOMICS, because they drive every number in this file:
 *   - ESPN scores: free, unlimited. Sync aggressively (lib/sync.ts, 25s).
 *   - The Odds API: 500 credits/month, 2 per slate refresh. That's 250
 *     refreshes for the WHOLE SEASON — about 8 per day.
 *
 * THE RULE (Ryan's, and it's deliberately simple):
 *   Refresh lines whenever the picker loads, at most once per hour.
 *
 * That's it. No cleverness about whether the draft is finished or whether
 * games have kicked off — if you reload and it's been an hour, you get fresh
 * numbers.
 *
 * The ONE exception is a hard credit floor, because the alternative failure is
 * worse: burning the month's budget in week two and then showing no lines at
 * all. Below CREDIT_FLOOR the auto-refresh pauses, cached lines keep showing,
 * and the picker says so out loud. A manual /api/refresh still works.
 *
 * BUDGET REALITY: hourly, unconditional, is up to 24 refreshes a day at 2
 * credits each — 48/day against 500/month. Heavy daily use could exhaust the
 * free tier in about ten days. If that starts happening, the cheapest fix is
 * to stop refreshing once the week's picks are all in; that gate is three
 * lines and is described at the bottom of this file. Failing that, The Odds
 * API's next tier up is $30/month.
 *
 * And remember: the displayed line is a STARTING POINT. Ryan types the number
 * actually agreed in the group text, so an hour-old line is fine. It never
 * needs to be accurate to the second, which is exactly why hourly is safe in a
 * way it wouldn't be for scores.
 */

import { db } from "./db";
import { fetchSlate, BOOK, lastRemaining, CREDIT_FLOOR } from "./odds";

export const LINES_STALE_AFTER_MS = 60 * 60 * 1000; // once per hour

export type LinesResult = {
  refreshed: boolean;
  reason: "ok" | "fresh" | "low-credits" | "error";
  updatedAt: string | null;
  creditsLeft: number | null;
};

async function readCredits(): Promise<number | null> {
  if (lastRemaining !== null) return lastRemaining;
  const { data } = await db()
    .from("app_state").select("value").eq("key", "odds_credits_remaining").maybeSingle();
  return data ? Number(data.value) : null;
}

async function writeCredits(n: number | null) {
  if (n === null) return;
  await db().from("app_state").upsert({
    key: "odds_credits_remaining",
    value: String(n),
    updated_at: new Date().toISOString(),
  });
}

export async function refreshLinesIfStale(
  period: { id: string },
  force = false
): Promise<LinesResult> {
  const s = db();

  const { data: games } = await s
    .from("games").select("id,kickoff,lines_updated").eq("period_id", period.id);

  const freshest = (games ?? []).reduce(
    (max, g) => Math.max(max, g.lines_updated ? Date.parse(g.lines_updated) : 0),
    0
  );
  const updatedAt = freshest ? new Date(freshest).toISOString() : null;
  const credits = await readCredits();
  const stop = (reason: LinesResult["reason"]): LinesResult => ({
    refreshed: false, reason, updatedAt, creditsLeft: credits,
  });

  if (!force) {
    // The rule: once per hour, on load. Nothing else.
    if (Date.now() - freshest < LINES_STALE_AFTER_MS) return stop("fresh");

    // The one safety net. Running dry mid-season is worse than a stale line.
    if (credits !== null && credits < CREDIT_FLOOR) return stop("low-credits");
  }

  try {
    const events = await fetchSlate();
    const stamp = new Date().toISOString();

    const rows = events.map((e) => {
      const bk = e.bookmakers?.find((b) => b.key === BOOK);
      const spreads = bk?.markets?.find((m) => m.key === "spreads");
      const totals = bk?.markets?.find((m) => m.key === "totals");
      const home = spreads?.outcomes?.find((o) => o.name === e.home_team);
      return {
        period_id: period.id,
        external_id: e.id,
        home_team: e.home_team,
        away_team: e.away_team,
        kickoff: e.commence_time,
        current_spread: home?.point ?? null,
        current_total: totals?.outcomes?.[0]?.point ?? null,
        lines_updated: stamp,
      };
    });

    if (rows.length) {
      // Upsert only touches games.current_*. picks.line is never written here
      // — a frozen line stays frozen no matter how often this runs.
      await s.from("games").upsert(rows, { onConflict: "period_id,external_id" });
    }

    await writeCredits(lastRemaining);
    return {
      refreshed: true, reason: "ok", updatedAt: stamp, creditsLeft: lastRemaining,
    };
  } catch (e) {
    console.error("[lines] refresh failed:", e);
    return stop("error");
  }
}

/** "12 minutes ago" for the picker's freshness note. */
export function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/* ---------------------------------------------------------------------
 * IF CREDITS GET TIGHT — the cheapest saver, drop this into the !force
 * block above. It stops refreshing once every pick for the week is in,
 * which is when a fresher line stops mattering anyway:
 *
 *   const [{ count: made }, { count: roster }] = await Promise.all([
 *     s.from("picks").select("id", { count: "exact", head: true })
 *       .eq("period_id", period.id),
 *     s.from("season_players").select("player_id", { count: "exact", head: true }),
 *   ]);
 *   if ((made ?? 0) >= (roster ?? 6) * picksPerPlayer) return stop("fresh");
 * ------------------------------------------------------------------- */
