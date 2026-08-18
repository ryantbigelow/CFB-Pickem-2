import { db, activePeriod, players, Slot } from "@/lib/db";
import { refreshLinesIfStale, ago, creditsSummary } from "@/lib/lines";
import Picker, { GameGroup } from "./picker";

export const dynamic = "force-dynamic";

export default async function Page() {
  let active;
  try {
    active = await activePeriod();
  } catch (e: any) {
    return (
      <>
        <h1>Not connected yet</h1>
        <p className="sub">{e.message}</p>
        <div className="card">
          <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
            Paste <code>db/schema.sql</code> then <code>db/seed.sql</code> into
            the Supabase SQL editor, then add your keys to <code>.env.local</code>{" "}
            (locally) or Vercel&apos;s environment variables (in production).
          </p>
        </div>
      </>
    );
  }

  if (!active) {
    return (
      <>
        <h1>No active season</h1>
        <p className="sub">Run db/seed.sql in Supabase to create the 26-27 season.</p>
      </>
    );
  }

  const { period } = active;

  // Refresh lines on load, at most once per hour. See lib/lines.ts for the
  // credit budget — that's the only thing that can pause it.
  const lines = await refreshLinesIfStale(period);

  const [{ data: slots }, roster, { data: order }] = await Promise.all([
    db().from("slot_board").select("*").eq("period_id", period.id).order("kickoff"),
    players(),
    db().rpc("draft_board", { p_period_id: period.id }),
  ]);

  // slot_board is one row per claimable slot; the picker wants them by game.
  const games = new Map<string, GameGroup>();
  for (const s of (slots ?? []) as Slot[]) {
    let g = games.get(s.game_id);
    if (!g) {
      g = {
        game_id: s.game_id,
        away_team: s.away_team,
        home_team: s.home_team,
        kickoff: s.kickoff,
        status: s.status,
        slots: [],
      };
      games.set(s.game_id, g);
    }
    g.slots.push(s);
  }

  const taken = (slots ?? []).filter((s: Slot) => s.pick_id).length;
  const target = roster.length * period.picks_per_player;

  return (
    <>
      <h1>{period.label}</h1>
      <p className="sub">
        {taken} of {target} picks in · lines {ago(lines.updatedAt)}
        {creditsSummary(lines.creditsLeft) &&
          ` · odds API: ${creditsSummary(lines.creditsLeft)}`}
        {lines.reason === "low-credits" && " — auto-refresh paused"}
        {order?.length ? (
          <>
            {" · order: "}
            {(order as any[])
              .filter((o) => o.round === 1)
              .map((o) => o.name)
              .join(" → ")}
          </>
        ) : null}
      </p>

      {games.size === 0 ? (
        <div className="card">
          <div className="empty">
            No games loaded yet. Hit <code>/api/refresh</code> to pull the slate.
          </div>
        </div>
      ) : (
        <Picker
          games={[...games.values()]}
          players={roster}
          periodId={period.id}
        />
      )}
    </>
  );
}
