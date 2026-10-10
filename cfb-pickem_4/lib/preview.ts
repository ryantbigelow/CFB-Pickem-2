/**
 * Generates the Saturday "Weekend Preview" — sassy commentary on the
 * week's picks plus one confident "AI Lock of the Week" — by handing this
 * pool's own data to the Claude API and storing the result.
 *
 * Called ONLY from app/api/generate-preview/route.ts (the Saturday cron,
 * or a manual hit with the passphrase). Never from a page view — the
 * Weekend Preview page only ever reads what's already stored, the same
 * lesson learned from the odds-API credit leak: a viewer's page load
 * should never be able to trigger a paid, unthrottled API call.
 *
 * GROUNDING RULE: every number handed to the model comes from this pool's
 * own database — nobody's real-world team stats, no invented "news." The
 * system prompt below tells the model that explicitly, so the jokes stay
 * confidently written without ever risking a confidently WRONG stat about
 * a real team.
 *
 * VARIETY IS ENFORCED BY CODE, NOT REQUESTED FROM THE MODEL. Every lever
 * that keeps one Saturday from reading like the last is decided here, per
 * period, before the model sees a word: the voice (STYLE_MENU), the shape
 * of the player section (FORMAT_MENU), which running jokes are even on the
 * table this week (runningJokes), and a verbatim list of recent openers it
 * is told not to echo. Asking a model to "be different this time" doesn't
 * work; handing it a different brief does.
 */

import { db, activePeriod, players, LivePick } from "./db";
import { mostRecentSeasonFor } from "./legacy-history";
import { syncScores } from "./sync";
import { APP_TIMEZONE } from "./time";

const MODEL = "claude-sonnet-5";

// The VOICE of the week's column. Picked deterministically per period (see
// the hash below), never left to the model to choose -- that's what
// actually forces different weeks to read differently, instead of relying
// on the model to remember to vary itself.
const STYLE_MENU = [
  "a sports-radio call-in host who's taken this way too personally",
  "a courtroom verdict from a judge who has seen every excuse before",
  "a nature-documentary narrator watching a fragile ecosystem",
  "a noir detective's case file on a string of bad decisions",
  "a halftime locker-room speech, delivered with total sincerity",
  "a stock-market analyst covering a very volatile portfolio",
  "a wrestling commentator hyping an undercard nobody asked for",
  "a weather forecaster tracking a slow-moving disaster",
  "an awards-show host reading nominees who all think they've already won",
  "a movie-trailer voiceover for a sequel nobody wanted",
  "a true-crime podcast host who has clearly already decided who did it",
  "a museum audio guide walking visitors past a series of bad decisions",
];

// The SHAPE of the player section -- a second, independent axis from the
// voice above. Twelve voices times eight shapes is 96 combinations before
// the actual picks even come into it, which is the point: the column
// can't settle into one groove when the brief itself keeps moving.
const FORMAT_MENU = [
  "LETTER GRADES: every player blurb opens with a grade (A+ through F) for their week so far, then justifies it",
  "POWER RANKINGS: order the players best-to-worst, open each blurb with a rank and an arrow (up/down/flat) vs. last week",
  "SCOUTING REPORT: each blurb is a deadpan scouting breakdown -- strengths, weaknesses, intangibles",
  "SUPERLATIVES: each player gets a mock award title to open their blurb ('Most Likely To...', 'Lifetime Achievement in...')",
  "FORECAST: each blurb is a weather-style forecast for that player's weekend -- conditions, percent chance of covering, any advisories",
  "PROP BETS: for each player, invent a fake prop bet about them ('over/under 1.5 excuses in the group text by Sunday') and take a side",
  "CHART NOTES: each blurb is a medical chart entry -- presenting symptoms, diagnosis, prognosis",
  "YEARBOOK: most blurbs are a single punchy caption-length line; spend the full roast on just one or two players who have it coming",
];

type GeneratedContent = {
  intro: string;
  players: { name: string; blurb: string }[];
  lock: { ref: string; call: "win" | "lose"; blurb: string } | null;
};

export type PreviewResult =
  | { skipped: true; reason: string }
  | { skipped: false; periodLabel: string };

/* ------------------------------------------------------------------ *
 * ATTEMPT LOG
 *
 * Every run of the generator -- including a rejected cron credential,
 * which never even reaches generateWeekendPreview() -- records what
 * happened to app_state, so the Weekend Preview page can say WHY it's
 * empty instead of just "nothing here yet." Three of the first four
 * Saturdays failed for three different reasons (a parsing bug, a
 * truncated response, an unknown), and each one cost a round of "hit
 * the URL by hand and tell me what it says." This makes the app tell us.
 * ------------------------------------------------------------------ */

const ATTEMPT_KEY = "weekend_preview_last_attempt";

export type PreviewAttempt = { at: string; ok: boolean; detail: string };

export async function recordPreviewAttempt(ok: boolean, detail: string): Promise<void> {
  try {
    await db().from("app_state").upsert({
      key: ATTEMPT_KEY,
      value: JSON.stringify({ at: new Date().toISOString(), ok, detail } satisfies PreviewAttempt),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    // Diagnostics must never be the thing that breaks the real path.
    console.error("[preview] couldn't record attempt:", e);
  }
}

export async function lastPreviewAttempt(): Promise<PreviewAttempt | null> {
  const { data } = await db().from("app_state").select("value").eq("key", ATTEMPT_KEY);
  const raw = data?.[0]?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PreviewAttempt;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */

export async function generateWeekendPreview(force = false): Promise<PreviewResult> {
  const active = await activePeriod();
  if (!active) throw new Error("No active season.");
  const { season, period, periods } = active;
  const s = db();

  if (!force) {
    // Plain array select, not .maybeSingle() -- see app/weekend-preview/page.tsx
    // for why: a real row was provably reachable through a plain select
    // while .maybeSingle() on the identical filter came back empty.
    const { data: existing } = await s
      .from("weekend_previews")
      .select("id")
      .eq("period_id", period.id);
    if (existing?.length) return { skipped: true, reason: "already generated for this period" };
  }

  // Midweek games (Tuesday MACtion, Thursday/Friday night) are usually
  // final by Saturday morning. Pull scores and grade them NOW, so the
  // column can roast an actual loss with an actual score instead of
  // previewing a game that's already over. force=true skips the 25s
  // throttle; ESPN is free, and this runs once a week.
  try {
    await syncScores(period.id, true);
  } catch (e) {
    console.error("[preview] pre-generation score sync failed (continuing):", e);
  }

  const roster = await players();
  const byPlayerId = new Map(roster.map((p) => [p.id, p.name]));

  const { data: picksData } = await s
    .from("live_picks")
    .select("*")
    .eq("period_id", period.id)
    .order("kickoff");
  const currentPicks = (picksData ?? []) as LivePick[];

  if (currentPicks.length === 0) {
    return { skipped: true, reason: "no picks in yet this week" };
  }

  // Give each current pick a stable short ref, so the model can point at
  // "which pick is the Lock" by id instead of us fuzzy-matching its prose
  // back to a real row. That mapping has to be exact — it's how a pick_id
  // ends up stored for the History page to grade later.
  const refs = currentPicks.map((p, i) => ({ ref: String(i + 1), pick: p }));

  // Kickoffs in the pool's own timezone ("Thu, Oct 8, 7:30 PM"), so the
  // model can say "Thursday night" and mean it. Same reasoning as every
  // other date in this app: never let the server's UTC clock pick the day.
  const kickoffFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const describe = ({ ref, pick }: (typeof refs)[number]) => ({
    ref,
    player: pick.player,
    game: `${pick.away_team} @ ${pick.home_team}`,
    bet: pick.bet,
    kickoff: kickoffFmt.format(new Date(pick.kickoff)),
  });

  // Split the week's picks by what the model can actually KNOW about them.
  // A final has a result -- it's news, not a prediction. The lock must
  // come from the upcoming list only; locking a game that's over isn't
  // confidence, it's cheating, and it's validated below, not just asked.
  const alreadyPlayed = refs
    .filter((r) => r.pick.status === "final" && r.pick.home_score !== null)
    .map((r) => ({
      ...describe(r),
      finalScore: `${r.pick.away_team} ${r.pick.away_score}, ${r.pick.home_team} ${r.pick.home_score}`,
      result: r.pick.result ?? "ungraded",
      // > 0 covered by that much, < 0 missed by that much, 0 push.
      coverMargin: r.pick.margin,
    }));
  const inProgress = refs
    .filter((r) => r.pick.status === "in_progress")
    .map((r) => ({
      ...describe(r),
      currentScore: `${r.pick.away_team} ${r.pick.away_score ?? 0}, ${r.pick.home_team} ${r.pick.home_score ?? 0}`,
      clock: r.pick.period_clock,
    }));
  const upcoming = refs
    .filter((r) => r.pick.status === "scheduled")
    .map(describe);
  const lockCandidates = upcoming.map((u) => u.ref);

  // Season-to-date record, from the same verified view Results uses.
  const { data: recordsData } = await s
    .from("player_records")
    .select("*")
    .eq("season_id", season.id);
  const seasonRecords = (recordsData ?? []).map((r: any) => ({
    player: byPlayerId.get(r.player_id) ?? "?",
    wins: r.wins,
    losses: r.losses,
    pushes: r.pushes,
  }));

  // The only number anyone in this pool actually cares about.
  const { data: payoutRows } = await s
    .from("payouts")
    .select("name,net_usd")
    .eq("season_id", season.id);
  const moneyStandings = (payoutRows ?? [])
    .map((r: any) => ({ player: r.name, netDollars: Number(r.net_usd) }))
    .sort((a, b) => b.netDollars - a.netDollars);

  // Prior period ("last week"), or — on a season's very first period —
  // each player's most recent archived season, since there's no prior
  // period yet to look back at.
  const prevPeriod = periods.find((p: any) => p.seq === period.seq - 1);
  let priorPeriod: { label: string; rows: { player: string; w: number; l: number }[] };
  if (prevPeriod) {
    const { data: gridData } = await s
      .from("weekly_grid")
      .select("*")
      .eq("season_id", season.id)
      .eq("seq", prevPeriod.seq);
    priorPeriod = {
      label: prevPeriod.label,
      rows: (gridData ?? []).map((r: any) => ({ player: r.name, w: r.w, l: r.l })),
    };
  } else {
    priorPeriod = {
      label: "last season",
      rows: roster.map((p) => {
        const row = mostRecentSeasonFor(p.name);
        return row ? { player: p.name, w: row.w, l: row.l } : { player: p.name, w: 0, l: 0 };
      }),
    };
  }

  // This season's picking tendencies per player: favorite vs. underdog,
  // over vs. under. locked line is already signed (negative = favored),
  // so this needs no extra lookup.
  const { data: seasonPicks } = await s
    .from("picks")
    .select("player_id,market,side,line")
    .in(
      "period_id",
      periods.map((p: any) => p.id)
    );
  const tendencies = new Map<string, { favorites: number; dogs: number; overs: number; unders: number }>();
  for (const pk of seasonPicks ?? []) {
    const name = byPlayerId.get(pk.player_id);
    if (!name) continue;
    const t = tendencies.get(name) ?? { favorites: 0, dogs: 0, overs: 0, unders: 0 };
    if (pk.market === "spread") {
      if (pk.line < 0) t.favorites++;
      else if (pk.line > 0) t.dogs++;
    } else if (pk.side === "over") t.overs++;
    else t.unders++;
    tendencies.set(name, t);
  }

  // This pool's own history on the teams in play this week, spread picks
  // only, this season only (team-name spelling isn't guaranteed stable
  // across seasons, so we don't reach further back for this one).
  const teamsInPlay = new Set(
    refs
      .filter((r) => r.pick.market === "spread")
      .map((r) => (r.pick.side === "home" ? r.pick.home_team : r.pick.away_team))
  );
  const { data: spreadHistory } = await s
    .from("live_picks")
    .select("home_team,away_team,side,market,result")
    .in(
      "period_id",
      periods.map((p: any) => p.id)
    )
    .eq("market", "spread");
  const teamRecord = new Map<string, { w: number; l: number }>();
  for (const row of spreadHistory ?? []) {
    if (!row.result || row.result === "push" || row.result === "void") continue;
    const team = row.side === "home" ? row.home_team : row.away_team;
    if (!teamsInPlay.has(team)) continue;
    const t = teamRecord.get(team) ?? { w: 0, l: 0 };
    if (row.result === "win") t.w++;
    else t.l++;
    teamRecord.set(team, t);
  }

  // Each player's current streak (win or loss, pushes ignored -- a push is
  // neither, same convention as the money math), chronological by period
  // seq this season.
  const { data: gradedPicks } = await s
    .from("picks")
    .select("player_id,period_id,result")
    .in(
      "period_id",
      periods.map((p: any) => p.id)
    )
    .not("result", "is", null)
    .neq("result", "push");
  const seqByPeriodId = new Map(periods.map((p: any) => [p.id, p.seq]));
  const gradedByPlayer = new Map<string, { seq: number; result: string }[]>();
  for (const pk of gradedPicks ?? []) {
    const name = byPlayerId.get(pk.player_id);
    const seq = seqByPeriodId.get(pk.period_id);
    if (!name || seq == null) continue;
    const arr = gradedByPlayer.get(name) ?? [];
    arr.push({ seq, result: pk.result });
    gradedByPlayer.set(name, arr);
  }
  const streaks: Record<string, { type: "win" | "loss"; count: number }> = {};
  for (const [name, arr] of gradedByPlayer) {
    arr.sort((a, b) => a.seq - b.seq);
    let type: "win" | "loss" | null = null;
    let count = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const r: "win" | "loss" = arr[i].result === "win" ? "win" : "loss";
      if (type === null) {
        type = r;
        count = 1;
      } else if (r === type) {
        count++;
      } else break;
    }
    if (type) streaks[name] = { type, count };
  }

  // This week's overall "lean" across the whole pool -- chalk-heavy or
  // dog-heavy, overs or unders. A vibe about the *week*, not any one player.
  let favorites = 0, dogs = 0, overs = 0, unders = 0;
  for (const { pick } of refs) {
    if (pick.market === "spread") {
      if (pick.line < 0) favorites++;
      else if (pick.line > 0) dogs++;
    } else if (pick.side === "over") overs++;
    else if (pick.side === "under") unders++;
  }
  const weeklyLean = { favorites, dogs, overs, unders };

  // Two players on opposite sides of the same game -- a family feud with
  // an actual scoreboard. Spread home vs. away, or over vs. under.
  const bySlot = new Map<string, { player: string; bet: string }[]>();
  for (const { pick } of refs) {
    const key = `${pick.away_team} @ ${pick.home_team}|${pick.market}`;
    const arr = bySlot.get(key) ?? [];
    arr.push({ player: pick.player, bet: pick.bet });
    bySlot.set(key, arr);
  }
  const headToHead = [...bySlot.entries()]
    .filter(([, sides]) => sides.length >= 2)
    .map(([key, sides]) => ({ game: key.split("|")[0], market: key.split("|")[1], sides }));

  // The AI's OWN track record on the Lock of the Week -- so it can own a
  // whiff instead of pretending every call was a lock. Self-deprecation
  // is both funnier and different every week by construction.
  const { data: lockRows } = await s
    .from("weekend_preview_locks")
    .select("seq,period,player,bet,lock_call,call_correct")
    .eq("season_id", season.id)
    .neq("period_id", period.id);
  const graded = (lockRows ?? []).filter((r: any) => r.call_correct !== null);
  const latest = (lockRows ?? []).sort((a: any, b: any) => b.seq - a.seq)[0];
  const lockRecord = {
    hits: graded.filter((r: any) => r.call_correct === true).length,
    misses: graded.filter((r: any) => r.call_correct === false).length,
    lastWeek: latest
      ? {
          period: latest.period,
          player: latest.player,
          bet: latest.bet,
          call: latest.lock_call,
          correct: latest.call_correct, // null = that game hasn't graded
        }
      : null,
  };

  // The last few weeks' previews, verbatim, so the model has something
  // concrete to NOT repeat -- see SYSTEM_PROMPT's anti-rerun rule. The
  // first sentence of each intro and lock blurb is also pulled out into an
  // explicit do-not-echo list, since openers are where reruns show first.
  // Excludes the current period so a re-run (?force=1) never sees itself
  // as "last week."
  const { data: recentRows } = await s
    .from("weekend_previews")
    .select("period_id,intro,players,lock_blurb,generated_at")
    .neq("period_id", period.id)
    .order("generated_at", { ascending: false })
    .limit(3);
  let recentPreviews: { period: string; intro: string; players: any; lockBlurb: string | null }[] = [];
  if (recentRows?.length) {
    const { data: labelRows } = await s
      .from("periods")
      .select("id,label")
      .in("id", recentRows.map((r: any) => r.period_id));
    const labelById = new Map((labelRows ?? []).map((p: any) => [p.id, p.label]));
    recentPreviews = recentRows.map((r: any) => ({
      period: labelById.get(r.period_id) ?? "a past week",
      intro: r.intro,
      players: r.players,
      lockBlurb: r.lock_blurb,
    }));
  }
  const firstSentence = (text: string | null | undefined) =>
    (text ?? "").split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  const bannedOpeners = recentPreviews
    .flatMap((r) => [firstSentence(r.intro), firstSentence(r.lockBlurb)])
    .filter(Boolean);

  // Everything variety-related is decided HERE, from the period id, not by
  // the model: the voice, the shape, and which running jokes are even
  // available this week. Different bits of the same hash drive each one so
  // they vary independently. Stable across a ?force=1 re-run of the same
  // week on purpose.
  let hash = 0;
  for (const ch of period.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const styleForThisWeek = STYLE_MENU[hash % STYLE_MENU.length];
  const formatForThisWeek = FORMAT_MENU[(hash >>> 4) % FORMAT_MENU.length];
  const runningJokes = {
    // "From time to time" / "occasionally" -- about half the weeks for
    // Guido, about a third for "rigged." Letting the model decide would
    // mean both, every week, because models use whatever they're handed.
    guido: (hash >>> 8) % 2 === 0,
    rigged: (hash >>> 10) % 3 === 0,
  };

  const dataForModel = {
    period: { label: period.label, season: season.label },
    styleForThisWeek,
    formatForThisWeek,
    runningJokes,
    alreadyPlayed,
    inProgress,
    upcoming,
    lockCandidates,
    headToHead,
    seasonRecords,
    moneyStandings,
    priorPeriod,
    streaks,
    tendencies: Object.fromEntries(tendencies),
    teamHistoryThisSeason: Object.fromEntries(teamRecord),
    weeklyLean,
    lockRecord,
    recentPreviews,
    bannedOpeners,
  };

  const content = await callClaude(dataForModel);

  // The lock has to be a real, still-upcoming pick. This is validated, not
  // trusted: a lock on a game that already finished would be stored, then
  // "graded" by the History page as a free hit.
  let lockEntry: (typeof refs)[number] | undefined;
  if (lockCandidates.length > 0) {
    if (!content.lock) {
      throw new Error("Model returned no lock even though upcoming picks exist.");
    }
    if (!lockCandidates.includes(content.lock.ref)) {
      throw new Error(
        `Model's lock.ref "${content.lock.ref}" isn't an upcoming pick ` +
          `(valid: ${lockCandidates.join(", ")}).`
      );
    }
    lockEntry = refs.find((r) => r.ref === content.lock!.ref);
  }

  const row = {
    period_id: period.id,
    intro: content.intro,
    players: content.players,
    lock_pick_id: lockEntry?.pick.pick_id ?? null,
    lock_call: lockEntry ? content.lock!.call : null,
    lock_blurb: lockEntry ? content.lock!.blurb : null,
    generated_at: new Date().toISOString(),
  };

  const { error } = await s.from("weekend_previews").upsert(row, { onConflict: "period_id" });
  if (error) throw new Error(`Failed to store preview: ${error.message}`);

  return { skipped: false, periodLabel: period.label };
}

async function callClaude(data: unknown): Promise<GeneratedContent> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      // Sonnet 5 thinks by default -- that reasoning draws from the same
      // max_tokens budget as the actual column. 2500 once truncated a real
      // response mid-JSON (stop_reason=max_tokens); the brief has grown
      // again since (played-game recaps, head-to-heads, the lock record),
      // so there's real headroom here. effort:"medium" keeps the thinking
      // bounded on what's fundamentally a styled writing task, which is
      // also what keeps this comfortably inside the route's 60s maxDuration.
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(data) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  // Find the actual text block by type, don't assume it's content[0] --
  // a thinking block (or anything else) sorting first would otherwise
  // silently hand us `undefined`, coerced to an empty string, which is
  // exactly what produced 'Model response wasn't valid JSON: ' (nothing
  // after the colon) the first time this ran for real.
  const textBlock = (body.content ?? []).find((b: any) => b.type === "text");
  const text: string = textBlock?.text ?? "";
  // Strip a markdown code fence if the model added one despite being told
  // not to -- cheap insurance, since JSON.parse has zero tolerance for it.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: GeneratedContent;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const blockTypes = (body.content ?? []).map((b: any) => b.type).join(",") || "none";
    throw new Error(
      `Model response wasn't valid JSON (stop_reason=${body.stop_reason}, ` +
        `content blocks=[${blockTypes}]): ${text.slice(0, 300)}`
    );
  }
  if (!parsed.intro || !Array.isArray(parsed.players)) {
    throw new Error("Model response is missing required fields (intro, players).");
  }
  if (parsed.lock !== null && (!parsed.lock?.ref || !parsed.lock?.call || !parsed.lock?.blurb)) {
    throw new Error("Model response's lock is malformed (needs ref, call, blurb, or null).");
  }
  return parsed;
}

const SYSTEM_PROMPT = `You write "Weekend Preview," the Saturday-morning roast column for a
six-person family college-football pick'em pool. Six family members claim
betting slots each week; you get that week's picks and this pool's own
history, and you turn it into something genuinely funny to read over
Saturday-morning coffee.

VOICE: sharp, cheeky, confident, a little judgmental — like a trash-talking
group text, not a corporate sports blog. Short, punchy sentences beat long
ones. Give your honest, funny opinion on each pick — that means real range,
not a uniform roast:
- Not every pick needs to be poked at. If you think a pick is a genuine
  winner, say so, and mean it — a confident compliment is funnier than
  forced mockery when the pick actually deserves credit.
- Generic jokes are completely fine, even ones with no specific stat
  behind them (a line's just funny on its own, someone's team name is a
  gift, whatever). Not every laugh needs a footnote — see the data as
  ammunition available to you, not a checklist you must exhaust.
- Vary the target and the angle blurb to blurb. Reaching for the same
  joke shape (record, then tendency, then jab) six times in a row reads
  like a template, not a column.

THIS WEEK'S BRIEF — two independent dials, both set for you, both mandatory:
- "styleForThisWeek" is the VOICE: a persona or framing device. Write the
  whole column — intro, every blurb, the lock — loosely filtered through
  that lens: its vocabulary, its rhythm, its verbal tics. Don't announce
  the bit ("as your sports-radio host, I...") and don't force a sentence
  into character when it stops being funny; just let it flavor everything.
- "formatForThisWeek" is the SHAPE of the player section: how each blurb
  is structured. Follow it literally — it's what makes this week
  structurally different from last week, not merely reworded. If the
  format calls for ordering the players (power rankings), order the
  "players" array that way.

GAMES THAT ALREADY HAPPENED: "alreadyPlayed" lists picks whose games are
already FINAL (Tuesday/Thursday/Friday games, mostly), with the real
final score and that pick's result. This is NEWS, not a prediction:
- Never preview a game that's over. Never hedge about an outcome you've
  been handed. A loss is a loss — roast it, with the score. A win is a
  win — give it its due, out loud, and let the winner gloat for a
  sentence. A push is a push: nothing happened, and that's its own joke.
- If anything is in alreadyPlayed, the intro should open on it — it's
  the only thing that's actually happened yet, so it's the lead. Weeks
  with nothing in alreadyPlayed just preview as normal.
- "inProgress" is a game that's live right now (rare on a Saturday
  morning). Treat it as unfinished: you can note the current score, but
  no result exists yet.
- "coverMargin" on an alreadyPlayed pick: positive = covered by that
  much, negative = missed by that much. A one-point miss and a
  twenty-point miss are different jokes.

RUNNING JOKES: this group has two inside jokes, and "runningJokes" says
which are on the table THIS week. Use a joke only when its flag is true,
at most once per column each, and skip it entirely when false — they're
funny because they're occasional.
- GUIDO: a shadowy fixer the family blames whenever someone loses — he
  "got to" the refs, the kicker, the coach, the replay booth. He's never
  seen, never explained, and never doubted. When runningJokes.guido is
  true, work in exactly one Guido reference, pinned on something real:
  an alreadyPlayed loss, a brutal cover margin, a result that beggars
  belief. Never explain who Guido is. Everyone knows.
- RIGGED: the family's standing position that any result that goes
  against them was rigged. When runningJokes.rigged is true, one
  deadpan "rigged" accusation, delivered as settled fact — not a
  complaint, a conclusion.

DON'T REPEAT LAST WEEK: "recentPreviews" has the actual text of your last
few columns, and "bannedOpeners" is a verbatim list of their opening
sentences. Read both before you write a word. Then:
- Never reuse a joke, a phrase, a metaphor, or a sentence shape from
  them, even about a different player. Do not open the intro or the lock
  with anything resembling a bannedOpener. "Welcome back" is permanently
  retired.
- Don't default to the same paragraph order every week just because
  that's what ran last time — mix up where in a blurb the joke lands.
- If a player's situation genuinely is the same as last week (still on a
  cold streak, still fading favorites), that's fine to mention — just say
  it in a new way, don't recycle the old line about it.

FRESH MATERIAL (use it where it's funny, skip it where it isn't):
- "headToHead": two players on opposite sides of the same game. That's a
  family feud with a scoreboard — name it, and pick a side to mock.
- "moneyStandings": net dollars this season. The only number anyone in
  this pool actually cares about. Who's buying, who's collecting.
- "lockRecord": YOUR OWN track record on the Lock of the Week this
  season, and what happened to last week's call. Own it. A whiff last
  week is funnier admitted than ignored, and a hot streak is permission
  to be insufferable.
- "streaks", "weeklyLean", "tendencies", "teamHistoryThisSeason",
  "priorPeriod", "seasonRecords": the same ammunition as always.

HARD RULES:
- Any SPECIFIC number you cite (records, scores, dollars, tendencies,
  team history) MUST come from the DATA JSON you're given. Never invent
  or assume a stat about a real team's real-world season, injuries,
  coaching drama, or anything else you weren't handed in the data. This
  only limits made-up NUMBERS — general jokes, opinions, and vibes need
  no citation at all.
- Never be mean about anything outside the game itself — no comments on
  appearance, personal life, or anything not related to picks and
  records. Family-safe trash talk: PG-13, needling, never cruel. Guido
  and "rigged" are bits about the GAMES, never about a person's
  character.
- Write one blurb per person who appears in the picks or seasonRecords
  (skip nobody who has data).
- THE LOCK: pick exactly ONE ref from "lockCandidates" — and ONLY from
  that list; those are the picks whose games haven't kicked off yet. A
  game that's already over cannot be a lock, no matter how obvious the
  result; that's not a lock, that's reading the paper. Call it a lock to
  COVER ("win") or a lock to BUST ("lose") — whichever the data supports
  better — and commit fully. Be confident and a little cocky. Ground it
  in data when data makes the funnier case; a strong opinion grounded in
  vibes alone is fine too. If lockCandidates is EMPTY (every game this
  week already finished), set "lock" to null.

OUTPUT: respond with ONLY raw JSON, no markdown fences, no commentary
before or after, matching exactly this shape:
{
  "intro": "1-2 short paragraphs setting up the weekend -- leading with alreadyPlayed if there is any",
  "players": [ { "name": "...", "blurb": "2-4 sentences, shaped per formatForThisWeek" }, ... ],
  "lock": { "ref": "<one of lockCandidates>", "call": "win" | "lose", "blurb": "2-4 confident sentences" }  OR  null when lockCandidates is empty
}`;
