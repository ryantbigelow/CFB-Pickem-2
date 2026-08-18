import { db, activePeriod, LivePick } from "@/lib/db";
import { syncScores } from "@/lib/sync";
import { readCredits, creditsSummary } from "@/lib/lines";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Scoreboard() {
  let active;
  try {
    active = await activePeriod();
  } catch (e: any) {
    return <p className="sub">{e.message}</p>;
  }
  if (!active) return <p className="sub">No active season.</p>;

  // Pull fresh scores before rendering. Throttled to once every 25s and a
  // no-op when nothing has kicked off, so an idle tab costs nothing. This is
  // what replaces the cron Vercel's free plan won't run.
  await syncScores(active.period.id);

  // Read-only — this page never calls the odds API itself, it just shows
  // the count the Picks page last saw.
  const credits = await readCredits();

  const { data } = await db()
    .from("live_picks")
    .select("*")
    .eq("period_id", active.period.id)
    .order("kickoff");

  const picks = (data ?? []) as LivePick[];
  const live = picks.filter((p) => p.status === "in_progress");
  const done = picks.filter((p) => p.status === "final");
  const soon = picks.filter((p) => p.status === "scheduled");

  return (
    <>
      {/* The page refreshes itself so it can be left open on a laptop
          during the games. 30s is well inside ESPN's update cadence. */}
      <meta httpEquiv="refresh" content="30" />

      <h1>Scoreboard</h1>
      <p className="sub">
        {live.length} in progress · {done.length} final · {soon.length} to come
        · refreshes every 30s
        {creditsSummary(credits) && ` · odds API: ${creditsSummary(credits)}`}
      </p>

      {picks.length === 0 && (
        <div className="card">
          <div className="empty">No picks in for this week yet.</div>
        </div>
      )}

      {[
        ["In progress", live],
        ["Final", done],
        ["Upcoming", soon],
      ].map(([title, rows]) => {
        const list = rows as LivePick[];
        if (!list.length) return null;
        return (
          <section key={title as string} style={{ marginBottom: 22 }}>
            <p className="sub" style={{ marginBottom: 10 }}>
              {title as string}
            </p>
            <div className="live">
              {list.map((p) => (
                <Card key={p.pick_id} p={p} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Card({ p }: { p: LivePick }) {
  const started = p.home_score !== null;
  const state =
    p.margin === null ? null : p.margin > 0 ? "cover" : p.margin < 0 ? "lose" : "push";
  const word =
    p.status === "final"
      ? state === "cover" ? "WON" : state === "lose" ? "LOST" : "PUSH"
      : state === "cover" ? "COVERING" : state === "lose" ? "LOSING" : "PUSH";

  // Once a game is final, tint the whole card so a graded pick reads at a
  // glance — green for a correct pick, red for a wrong one. Pushes stay
  // neutral; they're neither.
  const graded =
    p.status === "final"
      ? state === "cover" ? "graded-win" : state === "lose" ? "graded-loss" : ""
      : "";

  return (
    <div className={`lg ${graded}`}>
      <div className="top">
        <span>{p.player}</span>
        <span>
          {p.status === "final"
            ? "Final"
            : p.period_clock ??
              new Date(p.kickoff).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
        </span>
      </div>

      <div className="score">
        <span>{p.away_team}</span>
        <span>{p.away_score ?? "–"}</span>
      </div>
      <div className="score">
        <span>{p.home_team}</span>
        <span>{p.home_score ?? "–"}</span>
      </div>

      <div className="bet" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{p.bet}</span>
        {started && state && <span className={`pill ${state}`}>{word}</span>}
      </div>
    </div>
  );
}
