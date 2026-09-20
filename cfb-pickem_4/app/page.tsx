import { db, activePeriod, players, nextPicker, Slot } from "@/lib/db";
import { refreshLinesIfStale, ago, creditsSummary } from "@/lib/lines";
import { syncScores } from "@/lib/sync";
import { APP_TIMEZONE, todayKeyIn } from "@/lib/time";
import Picker, { GameGroup } from "./picker";
import PeriodSelector from "./period-selector";

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

  // Also sync scores/espn_id here, not just on the Scoreboard page — this is
  // what lets a game's team names link out to ESPN (below) before it's even
  // kicked off, not just once it's live. Free and throttled the same way
  // (lib/sync.ts), so this costs nothing extra.
  await syncScores(period.id);

  const [{ data: slots }, roster, { data: order }, upNext] = await Promise.all([
    db().from("slot_board").select("*").eq("period_id", period.id).order("kickoff"),
    players(),
    db().rpc("draft_board", { p_period_id: period.id }),
    nextPicker(period.id),
  ]);

  // Belt-and-suspenders against the "every remaining game on the schedule"
  // import bug (see lib/lines.ts): even if a stray row from another week
  // ever ends up tagged with this period_id, it's filtered out here too, by
  // the period's own real calendar window. A period with no window set (the
  // postseason) shows everything, same as before.
  const windowed = (slots ?? []).filter((s: Slot) => {
    if (!period.window_start || !period.window_end) return true;
    const day = todayKeyIn(APP_TIMEZONE, new Date(s.kickoff));
    return day >= period.window_start && day <= period.window_end;
  });

  // slot_board is one row per claimable slot; the picker wants them by game.
  const games = new Map<string, GameGroup>();
  for (const s of windowed as Slot[]) {
    let g = games.get(s.game_id);
    if (!g) {
      g = {
        game_id: s.game_id,
        away_team: s.away_team,
        home_team: s.home_team,
        kickoff: s.kickoff,
        status: s.status,
        espn_id: s.espn_id,
        slots: [],
      };
      games.set(s.game_id, g);
    }
    g.slots.push(s);
  }

  const taken = windowed.filter((s: Slot) => s.pick_id).length;
  const target = roster.length * period.picks_per_player;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h1>{period.label}</h1>
        <PeriodSelector
          periods={active.periods.map((p: any) => ({
            id: p.id,
            label: p.label,
            status: p.status,
          }))}
        />
      </div>

      {/* Whose turn it is, per the announced order -- never enforced, just
          reported. See next_picker() in db/schema.sql for how this stays
          right even when someone picks out of turn. */}
      <p className="upnext">
        {upNext ? (
          <>
            Up next: <strong>{upNext.name}</strong>
          </>
        ) : (
          "Everyone's picked for the week"
        )}
      </p>

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
          nextPicker={upNext}
        />
      )}
    </>
  );
}
