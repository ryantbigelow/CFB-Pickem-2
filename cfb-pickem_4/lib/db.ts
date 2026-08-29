/**
 * Database access. SERVER ONLY.
 *
 * Every query in this app runs on the server with the service-role key. The
 * browser never talks to Supabase directly, which is why we can skip row-level
 * security entirely in v1 — there is no public database surface to attack.
 *
 * The one thing that stands between a stranger with the URL and your season is
 * PICK_PASSPHRASE, checked in app/api/picks/route.ts.
 *
 * If you ever add real logins, this is the file that changes.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Copy .env.example to .env.local and fill them in."
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
    // When no custom fetch is given, supabase-js falls back to the bare
    // global `fetch` and never sets a `cache` option on its requests
    // (checked directly in node_modules/@supabase/postgrest-js). In the
    // Next.js App Router, that global fetch is Next's own instrumented
    // version, which can cache a GET with no explicit cache option in its
    // Data Cache -- independent of the actual database, and independent
    // of a page's own `dynamic = "force-dynamic"`, since that instruments
    // fetch() calls written in route files, not ones several layers deep
    // inside a third-party client library. This is what silently froze
    // the Weekend Preview page on the first-ever (pre-generation, empty)
    // response to that exact query, forever, regardless of what the
    // database actually held afterward. Forcing no-store here, once, at
    // the client itself, is airtight against that for every query this
    // app makes, not just the one that happened to surface it.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return client;
}

/* ---------------- shapes returned by the views ---------------- */

export type Slot = {
  period_id: string;
  game_id: string;
  away_team: string;
  home_team: string;
  kickoff: string;
  status: string;
  market: "spread" | "total";
  side: "home" | "away" | "over" | "under";
  current_line: number | null;
  pick_id: string | null;
  owner: string | null;
  locked_line: number | null;
  result: string | null;
  available: boolean;
};

export type LivePick = {
  pick_id: string;
  player: string;
  away_team: string;
  home_team: string;
  away_score: number | null;
  home_score: number | null;
  status: string;
  period_clock: string | null;
  kickoff: string;
  market: "spread" | "total";
  side: "home" | "away" | "over" | "under";
  bet: string;
  line: number;
  result: string | null;
  margin: number | null;
};

export type GridRow = { seq: number; period: string; name: string; w: number; l: number };
export type Payout = { name: string; wins: number; losses: number; net_usd: number };

/** The period we're currently drafting, else the next one up. */
export async function activePeriod() {
  const s = db();
  const { data: season } = await s
    .from("seasons").select("id,label").eq("is_active", true).single();
  if (!season) return null;

  const { data: periods } = await s
    .from("periods").select("*").eq("season_id", season.id).order("seq");
  if (!periods?.length) return null;

  const open = periods.find((p) => p.status === "open");
  return { season, period: open ?? periods[0], periods };
}

export async function players() {
  const { data } = await db().from("players").select("id,name").order("name");
  return data ?? [];
}
