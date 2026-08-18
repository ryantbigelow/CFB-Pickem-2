/**
 * Score syncing, shared by the Scoreboard page and the refresh route.
 *
 * WHY THIS EXISTS INSTEAD OF A CRON
 * Vercel's free Hobby plan allows daily cron jobs only, so a 10-minute score
 * cron isn't available. It turns out we don't want one anyway: scores only
 * matter when somebody is watching, so the Scoreboard page syncs on load and
 * throttles itself. Nobody watching means no work done, which is strictly
 * better than polling ESPN around the clock.
 *
 * The Scoreboard page auto-refreshes every 30s, so with STALE_AFTER at 25s an open
 * tab keeps scores current on its own.
 */

import { db } from "./db";
import { fetchScores, sameGame, grade } from "./scores";

export const STALE_AFTER_MS = 25_000;

export type SyncResult = {
  skipped: boolean;
  matched: number;
  unmatched: number;
  graded: number;
};

/**
 * Pull scores, match them to our games, and grade anything that finished.
 *
 * @param force ignore the staleness check (used by the manual refresh route)
 */
export async function syncScores(
  periodId: string,
  force = false
): Promise<SyncResult> {
  const s = db();
  const none = { skipped: true, matched: 0, unmatched: 0, graded: 0 };

  const { data: games } = await s
    .from("games")
    .select("id,home_team,away_team,kickoff,status,scores_updated")
    .eq("period_id", periodId);

  if (!games?.length) return none;

  // Nothing to do if every game is still days away or already finished and
  // graded — no reason to call ESPN just because someone opened the page.
  const now = Date.now();
  const worthChecking = games.some(
    (g) =>
      g.status === "in_progress" ||
      (g.status === "scheduled" && new Date(g.kickoff).getTime() < now)
  );

  const freshest = games.reduce(
    (max, g) => Math.max(max, g.scores_updated ? Date.parse(g.scores_updated) : 0),
    0
  );
  const stale = now - freshest > STALE_AFTER_MS;

  if (!force && (!worthChecking || !stale)) return none;

  let matched = 0;
  let graded = 0;

  try {
    const espn = await fetchScores();
    const stamp = new Date().toISOString();

    for (const g of games) {
      const hit = espn.find((e) =>
        sameGame(
          { homeTeam: g.home_team, awayTeam: g.away_team, kickoff: g.kickoff },
          { homeTeam: e.homeTeam, awayTeam: e.awayTeam, kickoff: e.kickoff }
        )
      );
      if (!hit) continue;
      matched++;

      await s
        .from("games")
        .update({
          home_score: hit.homeScore,
          away_score: hit.awayScore,
          status: hit.status,
          period_clock: hit.clock,
          scores_updated: stamp,
        })
        .eq("id", g.id);
    }

    graded = await gradeFinished(periodId);
  } catch (e) {
    // ESPN is undocumented and unguaranteed. A failure here must never take
    // the Scoreboard page down — we just show whatever we last stored.
    console.error("[sync] score sync failed:", e);
  }

  return { skipped: false, matched, unmatched: games.length - matched, graded };
}

/** Grade every ungraded pick whose game is final. Safe to call repeatedly. */
export async function gradeFinished(periodId: string): Promise<number> {
  const s = db();
  const { data: pending } = await s
    .from("picks")
    .select("id,market,side,line,games!inner(home_score,away_score,status)")
    .eq("period_id", periodId)
    .is("result", null);

  let n = 0;
  for (const p of (pending ?? []) as any[]) {
    const g = p.games;
    if (g?.status !== "final" || g.home_score === null || g.away_score === null)
      continue;

    const result = grade(
      p.market,
      p.side,
      Number(p.line),
      g.home_score,
      g.away_score
    );
    await s
      .from("picks")
      .update({ result, graded_at: new Date().toISOString() })
      .eq("id", p.id);
    n++;
  }
  return n;
}
