/**
 * Refresh: pull lines, pull scores, grade whatever finished.
 *
 * Call it from a Vercel Cron (vercel.json) or just hit the URL. Guarded by the
 * same passphrase as the write path, passed as ?key=.
 *
 * CREDIT BUDGET: the odds call costs 2 credits against a 500/month free tier,
 * so refresh lines a few times a day, NOT on every page load. Scores come from
 * ESPN and are free, so they can refresh as often as you like.
 * Use ?scores=only during game day to skip the odds call entirely.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshLinesIfStale } from "@/lib/lines";
import { syncScores, gradeFinished } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== process.env.PICK_PASSPHRASE)
    return NextResponse.json({ error: "Wrong key." }, { status: 401 });

  // ?scores=skip -> lines only (the daily cron); ?scores=only -> skip the odds call
  const mode = url.searchParams.get("scores");
  const scoresOnly = mode === "only";
  const skipScores = mode === "skip";
  const s = db();

  const { data: season } = await s
    .from("seasons").select("id").eq("is_active", true).single();
  if (!season) return NextResponse.json({ error: "No active season." }, { status: 400 });

  const { data: period } = await s
    .from("periods").select("*").eq("season_id", season.id)
    .eq("status", "open").single();
  if (!period)
    return NextResponse.json({ error: "No period is open. Set one to 'open'." }, { status: 400 });

  const out: Record<string, unknown> = { period: period.label };

  /* ---------- 1. lines ---------- */
  if (!scoresOnly) {
    // force=true: this route is the manual/cron path, so it ignores the
    // hourly throttle. It still records credits remaining.
    const lines = await refreshLinesIfStale(period, true);
    out.lines_refreshed = lines.refreshed;
    out.lines_updated = lines.updatedAt;
    out.odds_credits_left = lines.creditsLeft;
  }

  /* ---------- 2. scores + grading ---------- */
  // Forced: this route is the manual/cron path, so it always checks.
  const sync = skipScores
    ? { matched: 0, unmatched: 0, graded: await gradeFinished(period.id) }
    : await syncScores(period.id, true);
  out.scores_matched = sync.matched;
  out.scores_unmatched = sync.unmatched;
  out.picks_graded = sync.graded;

  return NextResponse.json(out);
}
