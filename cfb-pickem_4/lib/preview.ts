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
 */

import { db, activePeriod, players, LivePick } from "./db";
import { mostRecentSeasonFor } from "./legacy-history";

const MODEL = "claude-sonnet-5";

// A menu of framing devices for the week's column. Picked deterministically
// per period (see the hash below), never left to the model to choose --
// that's what actually forces different weeks to read differently, instead
// of relying on the model to remember to vary itself.
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
];

type GeneratedContent = {
  intro: string;
  players: { name: string; blurb: string }[];
  lock: { ref: string; call: "win" | "lose"; blurb: string };
};

export type PreviewResult =
  | { skipped: true; reason: string }
  | { skipped: false; periodLabel: string };

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
  // seq this season. Fresh ammo the model hasn't had before: "hot" and
  // "cold" are a different angle than a flat season record.
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
  // dog-heavy, overs or unders. Another fresh angle: a vibe about the
  // *week*, not just any one player.
  let favorites = 0, dogs = 0, overs = 0, unders = 0;
  for (const { pick } of refs) {
    if (pick.market === "spread") {
      if (pick.line < 0) favorites++;
      else if (pick.line > 0) dogs++;
    } else if (pick.side === "over") overs++;
    else if (pick.side === "under") unders++;
  }
  const weeklyLean = { favorites, dogs, overs, unders };

  // The last couple of weeks' previews, verbatim, so the model has
  // something concrete to NOT repeat -- see SYSTEM_PROMPT's anti-rerun
  // rule. Excludes the current period so a re-run (?force=1) never sees
  // itself as "last week."
  const { data: recentRows } = await s
    .from("weekend_previews")
    .select("period_id,intro,players,lock_blurb,generated_at")
    .neq("period_id", period.id)
    .order("generated_at", { ascending: false })
    .limit(2);
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

  // A structural frame for the week, picked deterministically from the
  // period itself (not left to the model) so consecutive weeks are
  // actually shaped differently, not just differently worded. Stable
  // across a ?force=1 re-run of the same week on purpose.
  let hash = 0;
  for (const ch of period.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const styleForThisWeek = STYLE_MENU[hash % STYLE_MENU.length];

  const dataForModel = {
    period: { label: period.label, season: season.label },
    styleForThisWeek,
    currentPicks: refs.map(({ ref, pick }) => ({
      ref,
      player: pick.player,
      game: `${pick.away_team} @ ${pick.home_team}`,
      bet: pick.bet,
    })),
    seasonRecords,
    priorPeriod,
    tendencies: Object.fromEntries(tendencies),
    teamHistoryThisSeason: Object.fromEntries(teamRecord),
    streaks,
    weeklyLean,
    recentPreviews,
  };

  const content = await callClaude(dataForModel);

  const lockEntry = refs.find((r) => r.ref === content.lock?.ref);
  if (!lockEntry) {
    throw new Error(`Model's lock.ref "${content.lock?.ref}" doesn't match any current pick.`);
  }

  const row = {
    period_id: period.id,
    intro: content.intro,
    players: content.players,
    lock_pick_id: lockEntry.pick.pick_id,
    lock_call: content.lock.call,
    lock_blurb: content.lock.blurb,
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
      max_tokens: 2500,
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
  if (!parsed.intro || !Array.isArray(parsed.players) || !parsed.lock?.ref || !parsed.lock?.call) {
    throw new Error("Model response is missing required fields.");
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

DON'T REPEAT LAST WEEK: the DATA JSON's "recentPreviews" field has the
actual text of your last one or two columns. Read it before you write a
word. Then:
- Never reuse a joke, a phrase, a metaphor, or a sentence shape from it,
  even about a different player. If "recentPreviews" called someone's
  pick "brave" or opened with "welcome back," this week finds a different
  way in.
- Don't default to the same paragraph order every week (intro sets the
  scene, then records, then tendency, then jab) just because that's what
  ran last time — mix up where in a blurb the joke lands.
- If a player's situation genuinely is the same as last week (still on a
  cold streak, still fading favorites), that's fine to mention — just say
  it in a new way, don't recycle the old line about it.

THIS WEEK'S FRAME: "styleForThisWeek" in the DATA JSON names a persona or
framing device (e.g. a courtroom verdict, a nature documentary). Write the
WHOLE column — intro, every player blurb, the lock — loosely filtered
through that lens: its vocabulary, its rhythm, its little verbal tics.
Don't announce the bit ("as your sports-radio host, I...") or force every
sentence into character if it stops being funny — just let it flavor the
column so this week reads structurally different from last week's, not
merely reworded.

FRESH ANGLES: "streaks" (each player's current run of wins or losses) and
"weeklyLean" (how chalk- or dog-heavy, over- or under-heavy the whole pool
went this week) are new data you haven't had before — real material, not
just filler. Use them where they're actually funny; skip them where
they're not.

HARD RULES:
- Any SPECIFIC number you cite (records, tendencies, team history) MUST
  come from the DATA JSON you're given. Never invent or assume a stat
  about a real team's real-world season, injuries, coaching drama, or
  anything else you weren't handed in the data. This only limits made-up
  NUMBERS — general jokes, opinions, and vibes need no citation at all.
- Never be mean about anything outside the game itself — no comments on
  appearance, personal life, or anything not related to picks and
  records. Family-safe trash talk: PG-13, needling, never cruel.
- Write one blurb per person who appears in currentPicks or seasonRecords
  (skip nobody who has data).
- Pick exactly ONE current pick (by its "ref") as the "AI Lock of the
  Week." You can call it a lock to COVER ("win") or a lock to BUST
  ("lose") — your choice, whichever the data supports better — but commit
  fully. Be confident and a little cocky about it. Ground it in data when
  data makes the funnier case; a strong opinion grounded in vibes alone is
  fine too, as long as you commit to it. This is comedy with an edge, not
  real handicapping.

OUTPUT: respond with ONLY raw JSON, no markdown fences, no commentary
before or after, matching exactly this shape:
{
  "intro": "1-2 short paragraphs setting up the weekend, referencing the pool's recent vibe",
  "players": [ { "name": "...", "blurb": "2-4 sentences" }, ... ],
  "lock": { "ref": "<one of the ref values from currentPicks>", "call": "win" | "lose", "blurb": "2-4 confident sentences" }
}`;
