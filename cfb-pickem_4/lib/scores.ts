/**
 * Live scores, from ESPN's public scoreboard endpoint.
 *
 * Free and unlimited, which is why we're using it instead of burning
 * CollegeFootballData's 1,000-call monthly budget on Saturday polling.
 *
 * The tradeoff: it's undocumented. ESPN can change the shape without warning.
 * So everything below is defensive — if a field is missing we return null for
 * that game rather than throwing, and the Scoreboard page shows a stale score instead
 * of a broken page. If scores ever stop updating, check this file first.
 */

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

export type GameStatus = "scheduled" | "in_progress" | "final" | "cancelled";

export type ScoreUpdate = {
  espnId: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  // Every name ESPN has for each team -- full ("Appalachian State
  // Mountaineers"), short ("App State"), location ("Appalachian State").
  // Matching tries all of them, so the two feeds' naming habits don't
  // have to agree (see findEspnMatch).
  homeNames: string[];
  awayNames: string[];
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
  clock: string | null; // '3rd 04:12'
  tv: string | null; // 'ABC', 'ESPN / ESPN2'; null until ESPN publishes it
};

/**
 * @param date optional YYYYMMDD. Omit for today's slate.
 *             ESPN also accepts a range: '20260827-20260907'.
 */
export async function fetchScores(date?: string): Promise<ScoreUpdate[]> {
  const qs = new URLSearchParams({ groups: "80", limit: "400" }); // 80 = FBS
  if (date) qs.set("dates", date);

  const res = await fetch(`${SCOREBOARD}?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    console.error("[scores] ESPN returned", res.status);
    return [];
  }

  const data = await res.json();
  const events: any[] = Array.isArray(data?.events) ? data.events : [];

  return events.flatMap((ev) => {
    const comp = ev?.competitions?.[0];
    if (!comp) return [];

    const home = comp.competitors?.find((c: any) => c.homeAway === "home");
    const away = comp.competitors?.find((c: any) => c.homeAway === "away");
    if (!home || !away) return [];

    const status = toStatus(comp.status);
    // ESPN reports the literal string "0" for both teams before kickoff --
    // a placeholder, not a real score. toScore() alone can't tell that
    // apart from an actual 0-0 game in progress, so a scheduled game was
    // showing (and grading logic aside, *displaying*) a fake 0-0 that
    // then evaluated as covering/losing against the pick's line before a
    // single snap had been played. Only trust the number once the game
    // has actually started.
    const started = status !== "scheduled";

    return [
      {
        espnId: String(ev.id),
        kickoff: ev.date,
        homeTeam: home.team?.displayName ?? "",
        awayTeam: away.team?.displayName ?? "",
        homeNames: teamNames(home.team),
        awayNames: teamNames(away.team),
        homeScore: started ? toScore(home.score) : null,
        awayScore: started ? toScore(away.score) : null,
        status,
        clock: toClock(comp.status),
        tv: toTv(comp),
      },
    ];
  });
}

/**
 * 'ABC', 'ESPN / ESPN2', or null. ESPN lists the national broadcast under
 * `broadcasts[].names`; `geoBroadcasts` is the fuller list (TV, web,
 * radio) and is the fallback when the first is empty. Radio is skipped --
 * nobody's looking for the game on the radio from a scoreboard. Null
 * until ESPN publishes an assignment, which for college football is
 * usually a week or so out; every sync re-reads it, so it fills itself in.
 */
function toTv(comp: any): string | null {
  const names: string[] = [];
  for (const b of comp?.broadcasts ?? [])
    for (const n of b?.names ?? []) if (typeof n === "string" && n) names.push(n);
  if (!names.length) {
    for (const g of comp?.geoBroadcasts ?? []) {
      const n = g?.media?.shortName;
      if (typeof n === "string" && n && g?.type?.shortName !== "Radio") names.push(n);
    }
  }
  const uniq = [...new Set(names)];
  return uniq.length ? uniq.slice(0, 2).join(" / ") : null;
}

/**
 * Every name ESPN has for a team, de-duplicated: "Appalachian State
 * Mountaineers" / "App State" / "Appalachian State". The two feeds don't
 * share naming habits (The Odds API said "App State"; ESPN's full name is
 * "Appalachian State Mountaineers" -- not a substring either way), but
 * ESPN publishes its own aliases, so there's no list to hand-maintain.
 * The mascot alone ("Mountaineers") and the 3-letter abbreviation are
 * deliberately left out -- too short and too shared to match on.
 */
function teamNames(team: any): string[] {
  const out: string[] = [];
  for (const n of [team?.displayName, team?.shortDisplayName, team?.location]) {
    if (typeof n === "string" && n.trim() && !out.includes(n)) out.push(n);
  }
  return out;
}

const toScore = (s: unknown): number | null => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function toStatus(status: any): GameStatus {
  const name: string = status?.type?.name ?? "";
  if (name.includes("CANCELED") || name.includes("POSTPONED")) return "cancelled";

  switch (status?.type?.state) {
    case "in":
      return "in_progress";
    case "post":
      return status?.type?.completed ? "final" : "cancelled";
    default:
      return "scheduled";
  }
}

/** '3rd 04:12', 'HALF', 'OT 01:30', or null before kickoff. */
function toClock(status: any): string | null {
  if (status?.type?.state !== "in") return null;

  const period: number = status.period ?? 0;
  const clock: string = status.displayClock ?? "";

  if (status?.type?.name === "STATUS_HALFTIME") return "HALF";
  if (period > 4) return `OT${period > 5 ? period - 4 : ""} ${clock}`.trim();

  const label = ["", "1st", "2nd", "3rd", "4th"][period] ?? `Q${period}`;
  return `${label} ${clock}`.trim();
}

/* ------------------------------------------------------------------ *
 * MATCHING ESPN GAMES TO OUR GAMES
 *
 * This is the part that will break, so read before changing it.
 *
 * Our `games` rows come from The Odds API; scores come from ESPN. The two
 * services do not use identical team names ("Miami" vs "Miami Hurricanes"
 * vs "Miami (FL)"), and college football has several genuinely ambiguous
 * names. Match on normalized name AND kickoff day — never on name alone.
 *
 * Store the resolved espnId on the game the first time a match succeeds, so
 * later refreshes are an exact id lookup instead of re-guessing.
 * ------------------------------------------------------------------ */

export function normalizeTeam(name: string): string {
  return name
    // NFD splits an accented letter into the plain letter + a separate
    // combining-mark codepoint (U+0300-U+036F) -- strip just the mark, so
    // "José" normalizes to "jose", not "jos". Without this, the very next
    // line (which strips anything outside [a-z0-9 ]) deleted the accented
    // character whole, silently eating a letter out of the school's name
    // and breaking every match against it -- exactly what happened to
    // San José State.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Apostrophes and periods vanish ("Hawai'i" -> "hawaii", "St." -> "st");
    // every other punctuation mark becomes a SPACE, so "Louisiana-Monroe"
    // is "louisiana monroe", not "louisianamonroe" -- deleting the hyphen
    // used to glue the words together and break the match against "UL
    // Monroe" / "Louisiana Monroe".
    .replace(/['’ʻʼ.]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(university|state university|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type GameRef = { homeTeam: string; awayTeam: string; kickoff: string };

export type MatchResult =
  | { kind: "matched"; event: ScoreUpdate }
  | { kind: "ambiguous"; candidates: ScoreUpdate[] }
  | { kind: "none" };

/**
 * Find the one ESPN event for a game of ours. Built to never guess, never
 * miss a game just because the two feeds spell it differently, and fail
 * loudly when it can't tell -- each of those has cost a real grade once
 * (a wrong match: Virginia / West Virginia; a missed one: "App State" vs
 * "Appalachian State Mountaineers", not a substring either way).
 *
 * Every tier compares our two names against EVERY name ESPN has for a
 * team (homeNames/awayNames: full, short, location), and a tier only wins
 * when it identifies exactly one event. Two or more candidates at a tier
 * is "ambiguous": stop there, don't fall through to a looser tier, let a
 * human pin games.espn_id. A loose match that isn't unique is a wrong
 * score, not a near miss.
 *
 *  1. EXACT, both teams, same day.
 *  2. EXACT, either team, same day -- checked against both of the event's
 *     sides, so swapped home/away (neutral sites) can't break it. A team
 *     plays once a day, so one exact team on the right day identifies the
 *     game by itself. This is the tier that catches "App State": the
 *     other team, Old Dominion, is spelled the same in both feeds.
 *  3-4. The same two, widened to the adjacent days -- the feeds can
 *     disagree on the date (The Odds API lists a TBD kickoff at a
 *     placeholder time; a late game straddles midnight UTC).
 *  5. FUZZY (substring either way), both teams, same day.
 *  6. FUZZY, either team, same day.
 *
 * The fuzzy tiers never widen past the day. Loose AND wide is how you get
 * the wrong game.
 */
export function findEspnMatch(ours: GameRef, events: ScoreUpdate[]): MatchResult {
  const dayOf = (d: string) => Math.floor(new Date(d).getTime() / 86_400_000);
  const ourDay = dayOf(ours.kickoff);
  const sameDay = events.filter((e) => dayOf(e.kickoff) === ourDay);
  const nearDay = events.filter((e) => Math.abs(dayOf(e.kickoff) - ourDay) <= 1);

  const [oh, oa] = [normalizeTeam(ours.homeTeam), normalizeTeam(ours.awayTeam)];
  const norm = (names: string[]) => names.map(normalizeTeam);
  const exactIn = (x: string, names: string[]) => norm(names).includes(x);
  const fuzzyIn = (x: string, names: string[]) =>
    norm(names).some((n) => n === x || n.includes(x) || x.includes(n));
  const all = (e: ScoreUpdate) => [...e.homeNames, ...e.awayNames];

  const bothExact = (e: ScoreUpdate) => exactIn(oh, e.homeNames) && exactIn(oa, e.awayNames);
  const eitherExact = (e: ScoreUpdate) => exactIn(oh, all(e)) || exactIn(oa, all(e));
  const bothFuzzy = (e: ScoreUpdate) => fuzzyIn(oh, e.homeNames) && fuzzyIn(oa, e.awayNames);
  const eitherFuzzy = (e: ScoreUpdate) => fuzzyIn(oh, all(e)) || fuzzyIn(oa, all(e));

  const tiers: [ScoreUpdate[], (e: ScoreUpdate) => boolean][] = [
    [sameDay, bothExact],
    [sameDay, eitherExact],
    [nearDay, bothExact],
    [nearDay, eitherExact],
    [sameDay, bothFuzzy],
    [sameDay, eitherFuzzy],
  ];
  for (const [pool, test] of tiers) {
    const hits = pool.filter(test);
    if (hits.length === 1) return { kind: "matched", event: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  }
  return { kind: "none" };
}

/**
 * Grade a finished pick. Returns null while the game is unfinished.
 * Mirrors the `margin` logic in the live_picks view — keep them in sync.
 */
export function grade(
  market: "spread" | "total",
  side: "home" | "away" | "over" | "under",
  line: number,
  homeScore: number,
  awayScore: number
): "win" | "loss" | "push" {
  let margin: number;
  if (market === "spread") {
    margin =
      side === "home"
        ? homeScore - awayScore + line
        : awayScore - homeScore + line;
  } else {
    const total = homeScore + awayScore;
    margin = side === "over" ? total - line : line - total;
  }
  return margin > 0 ? "win" : margin < 0 ? "loss" : "push";
}
