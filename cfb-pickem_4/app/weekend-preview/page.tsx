import { db, activePeriod } from "@/lib/db";

export const dynamic = "force-dynamic";

type PreviewPlayer = { name: string; blurb: string };

type PreviewRow = {
  period_id: string;
  generated_at: string;
  intro: string;
  players: PreviewPlayer[];
};

type LockRow = {
  player: string;
  bet: string;
  lock_call: "win" | "lose";
  call_correct: boolean | null;
  lock_blurb: string;
};

export default async function WeekendPreview() {
  let active;
  try {
    active = await activePeriod();
  } catch (e: any) {
    return <p className="sub">{e.message}</p>;
  }
  if (!active) return <p className="sub">No active season.</p>;

  const [{ data: preview }, { data: lock }] = await Promise.all([
    db()
      .from("weekend_previews")
      .select("*")
      .eq("period_id", active.period.id)
      .maybeSingle(),
    db()
      .from("weekend_preview_locks")
      .select("*")
      .eq("period_id", active.period.id)
      .maybeSingle(),
  ]);

  if (!preview) {
    return (
      <>
        <h1>Weekend Preview</h1>
        <p className="sub">{active.period.label}</p>
        <div className="card">
          <div className="empty">
            Nothing here yet — this fills in Saturday morning once the
            week&apos;s picks are in.
          </div>
        </div>
      </>
    );
  }

  const row = preview as PreviewRow;
  const lockRow = lock as LockRow | null;
  const players = row.players ?? [];

  return (
    <>
      <h1>Weekend Preview</h1>
      <p className="sub">{active.period.label}</p>

      <div className="card">
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65 }}>{row.intro}</p>
      </div>

      {lockRow && (
        <div className="card">
          <p className="sub" style={{ marginBottom: 10 }}>
            The AI Lock of the Week
          </p>
          <div className="super">
            <div className="tag">
              {lockRow.lock_call === "win" ? "Calling it: covers" : "Calling it: busts"}
            </div>
            <h3>
              {lockRow.player} — {lockRow.bet}
            </h3>
            <p>{lockRow.lock_blurb}</p>
            {lockRow.call_correct !== null && (
              <p
                className={lockRow.call_correct ? "pos" : "neg"}
                style={{ marginTop: 8, fontWeight: 620 }}
              >
                {lockRow.call_correct ? "✓ Nailed it." : "✗ Whiffed."}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <p className="sub" style={{ marginBottom: 10 }}>
          The Field
        </p>
        <div className="supers">
          {players.map((p) => (
            <div className="super" key={p.name}>
              <div className="tag">{p.name}</div>
              <p>{p.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
