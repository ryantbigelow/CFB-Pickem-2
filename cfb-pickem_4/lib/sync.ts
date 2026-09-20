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
import { fetchScores, findEspnMatch, grade } from "./scores";
import { APP_TIMEZONE, todayKeyIn } from "./time";

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
    .select("id,home_team,away_team,kickoff,status,scores_updated,espn_id")
    .eq("period_id", periodId);

  if (!games?.length) return none;

  // Worth a check if anything might have live-score news (in progress, or
  // scheduled with kickoff already passed) OR simply doesn't have an
  // espn_id pinned yet -- that second case is what lets a game's Picks-page
  // link out to ESPN before it's even kicked off, not just once it's live.
  const now = Date.now();
  const worthChecking = games.some(
    (g) =>
      g.status === "in_progress" ||
      (g.status === "scheduled" && new Date(g.kickoff).getTime() < now) ||
      !g.espn_id
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
    // fetchScores() with no argument only returns TODAY's slate -- fine for
    // the Scoreboard on a Saturday, not enough to id-match a whole week's
    // games from the Picks page on, say, a Tuesday. Fetch once per distinct
    // kickoff day actually present in this period instead. Judged in the
    // pool's own timezone (see lib/lines.ts's comment on the same trap) so
    // a late-night game doesn't fetch the wrong calendar day.
    const dates = new Set(
      games.map((g) => todayKeyIn(APP_TIMEZONE, new Date(g.kickoff)).replace(/-/g, ""))
    );
    const espn = (await Promise.all([...dates].map((d) => fetchScores(d)))).flat();
    const stamp = new Date().toISOString();

    for (const g of games) {
      // Once a game has matched before, its espn_id is an exact lookup --
      // skip re-guessing entirely. This isn't just faster, it's safer: a
      // game that's already correctly pinned can never get reassigned to
      // a different event by some later ambiguous name-matching pass.
      let hit = g.espn_id ? espn.find((e) => e.espnId === g.espn_id) : undefined;

      if (!hit) {
        const result = findEspnMatch(
          { homeTeam: g.home_team, awayTeam: g.away_team, kickoff: g.kickoff },
          espn
        );

        if (result.kind === "ambiguous") {
          // Real example: our "Virginia" game matched BOTH ESPN's "West
          // Virginia" and "Virginia Tech" events under the old
          // substring-only rule -- "Virginia" is a genuine substring of
          // both, and they're different teams. Guessing here doesn't just
          // risk a missed sync, it risks grading a pick against the wrong
          // game's score entirely, so this refuses to pick one. Set
          // games.espn_id by hand (Supabase table editor) using the
          // correct id from ESPN's scoreboard to resolve it.
          console.warn(
            `[sync] AMBIGUOUS ESPN match for "${g.away_team} @ ${g.home_team}" ` +
              `(kickoff ${g.kickoff}) -- candidates: ` +
              result.candidates.map((c) => `${c.awayTeam} @ ${c.homeTeam} (espnId=${c.espnId})`).join(", ") +
              ` -- set games.espn_id by hand to the correct one, this game will not auto-grade until then`
          );
          continue;
        }

        if (result.kind === "none") {
          // Team-name matching is the known fragile point (see the comment
          // atop lib/scores.ts) -- a game that's already kicked off but
          // still isn't matching is worth knowing about immediately, not
          // guessing at blind after someone notices the Scoreboard looks
          // wrong. A game that just hasn't started yet is normal and not
          // logged; ESPN may simply not have posted it yet.
          if (new Date(g.kickoff).getTime() < now) {
            console.warn(
              `[sync] no ESPN match for "${g.away_team} @ ${g.home_team}" ` +
                `(kickoff ${g.kickoff}) -- check normalizeTeam() in lib/scores.ts ` +
                `against ESPN's actual name for these teams`
            );
          }
          continue;
        }

        hit = result.event;
      }
      matched++;

      await s
        .from("games")
        .update({
          home_score: hit.homeScore,
          away_score: hit.awayScore,
          status: hit.status,
          period_clock: hit.clock,
          scores_updated: stamp,
          espn_id: hit.espnId,
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
