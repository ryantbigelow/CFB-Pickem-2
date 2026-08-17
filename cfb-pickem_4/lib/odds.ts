/**
 * The Odds API client.
 *
 * BUDGET DISCIPLINE — read this before adding a call site.
 * The free tier is 500 credits/month. One call returns EVERY game at once and
 * costs 1 credit per market per region. Our plan:
 *
 *   - refreshBoard()  ~15/week  (background, only while a draft is open)
 *   - fetchLineNow()   12/week  (once per pick, to freeze the exact line)
 *
 * ~110 credits/month. If you find yourself calling this on page load, stop:
 * read the cached lines out of the database instead.
 */

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "americanfootball_ncaaf";

export type Outcome = { name: string; price: number; point?: number };
export type Bookmaker = {
  key: string;
  last_update: string;
  markets: { key: "spreads" | "totals"; outcomes: Outcome[] }[];
};
export type OddsEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
};

/** Which book is authoritative. One book, so everyone sees the same number. */
export const BOOK = "draftkings";

/** Credits left this month, read off the last response. null = never called. */
export let lastRemaining: number | null = null;

async function call(path: string, params: Record<string, string>) {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY is not set");

  const qs = new URLSearchParams({ apiKey: key, ...params });
  const res = await fetch(`${BASE}${path}?${qs}`, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Odds API ${res.status}: ${await res.text()}`);
  }

  // Every response reports the remaining monthly quota. We persist this so
  // the picker can refuse to refresh once we're near the floor.
  const remaining = res.headers.get("x-requests-remaining");
  if (remaining !== null && Number.isFinite(Number(remaining))) {
    lastRemaining = Number(remaining);
    if (lastRemaining < CREDIT_FLOOR) {
      console.warn(`[odds] LOW CREDITS: ${lastRemaining} left this month`);
    }
  }

  return res.json();
}

/**
 * Stop auto-refreshing below this many credits, keeping a reserve for the
 * manual /api/refresh you'd reach for if something looked wrong.
 */
export const CREDIT_FLOOR = 60;

/**
 * Every upcoming NCAAF game with spreads and totals. 1 credit per market,
 * so this call costs 2. Use for the periodic board refresh, not per request.
 */
export async function fetchSlate(): Promise<OddsEvent[]> {
  return call(`/sports/${SPORT}/odds`, {
    regions: "us",
    markets: "spreads,totals",
    oddsFormat: "american",
    bookmakers: BOOK,
  });
}

/**
 * The line for ONE game right now, used to freeze a pick at the moment it is
 * made. Returns null if the book isn't currently pricing that market.
 */
export async function fetchLineNow(
  eventId: string,
  market: "spread" | "total",
  side: "home" | "away" | "over" | "under",
  homeTeam: string,
  awayTeam: string
): Promise<{ line: number; price: number } | null> {
  const events: OddsEvent[] = await call(`/sports/${SPORT}/odds`, {
    regions: "us",
    markets: market === "spread" ? "spreads" : "totals",
    oddsFormat: "american",
    bookmakers: BOOK,
    eventIds: eventId,
  });

  const book = events[0]?.bookmakers?.find((b) => b.key === BOOK);
  const m = book?.markets?.find(
    (x) => x.key === (market === "spread" ? "spreads" : "totals")
  );
  if (!m) return null;

  // Spread outcomes are named by team; totals by "Over"/"Under".
  const wanted =
    market === "spread"
      ? side === "home"
        ? homeTeam
        : awayTeam
      : side === "over"
      ? "Over"
      : "Under";

  const outcome = m.outcomes.find(
    (o) => o.name.toLowerCase() === wanted.toLowerCase()
  );
  if (!outcome || outcome.point === undefined) return null;

  return { line: outcome.point, price: outcome.price };
}
