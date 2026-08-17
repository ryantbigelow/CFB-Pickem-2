/**
 * Live scores, from ESPN's public scoreboard endpoint.
 *
 * Free and unlimited, which is why we're using it instead of burning
 * CollegeFootballData's 1,000-call monthly budget on Saturday polling.
 *
 * The tradeoff: it's undocumented. ESPN can change the shape without warning.
 * So everything below is defensive — if a field is missing we return null for
 * that game rather than throwing, and the dashboard shows a stale score instead
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
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
  clock: string | null; // '3rd 04:12'
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

    return [
      {
        espnId: String(ev.id),
        kickoff: ev.date,
        homeTeam: home.team?.displayName ?? "",
        awayTeam: away.team?.displayName ?? "",
        homeScore: toScore(home.score),
        awayScore: toScore(away.score),
        status: toStatus(comp.status),
        clock: toClock(comp.status),
      },
    ];
  });
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
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(university|state university|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when both teams and the kickoff day line up. */
export function sameGame(
  a: { homeTeam: string; awayTeam: string; kickoff: string },
  b: { homeTeam: string; awayTeam: string; kickoff: string }
): boolean {
  const day = (d: string) => new Date(d).toISOString().slice(0, 10);
  if (day(a.kickoff) !== day(b.kickoff)) return false;

  const [ah, aa] = [normalizeTeam(a.homeTeam), normalizeTeam(a.awayTeam)];
  const [bh, ba] = [normalizeTeam(b.homeTeam), normalizeTeam(b.awayTeam)];

  const hit = (x: string, y: string) =>
    x === y || x.includes(y) || y.includes(x);

  return hit(ah, bh) && hit(aa, ba);
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
