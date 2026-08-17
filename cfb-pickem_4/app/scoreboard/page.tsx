import { db, activePeriod, GridRow, Payout } from "@/lib/db";

export const dynamic = "force-dynamic";

const money = (v: number) =>
  `${v < 0 ? "−" : "+"}$${Math.abs(Math.round(v)).toLocaleString()}`;

export default async function Scoreboard() {
  let active;
  try {
    active = await activePeriod();
  } catch (e: any) {
    return <p className="sub">{e.message}</p>;
  }
  if (!active) return <p className="sub">No active season.</p>;

  const [{ data: grid }, { data: pay }] = await Promise.all([
    db().from("weekly_grid").select("*").eq("season_id", active.season.id).order("seq"),
    db().from("payouts").select("*").eq("season_id", active.season.id),
  ]);

  const rows = (grid ?? []) as GridRow[];
  const payouts = ((pay ?? []) as Payout[]).sort((a, b) => b.net_usd - a.net_usd);

  // Player columns in draft order where possible, else alphabetical.
  const names = [...new Set(rows.map((r) => r.name))].sort();
  const periods = [...new Map(rows.map((r) => [r.seq, r.period])).entries()].sort(
    (a, b) => a[0] - b[0]
  );

  const cell = (seq: number, name: string) =>
    rows.find((r) => r.seq === seq && r.name === name);

  const totals = Object.fromEntries(
    names.map((n) => {
      const w = rows.filter((r) => r.name === n).reduce((s, r) => s + r.w, 0);
      const l = rows.filter((r) => r.name === n).reduce((s, r) => s + r.l, 0);
      return [n, { w, l }];
    })
  );

  const anyPlayed = rows.some((r) => r.w + r.l > 0);

  return (
    <>
      <h1>Scoreboard</h1>
      <p className="sub">{active.season.label} · $10 per game</p>

      {!anyPlayed && (
        <div className="card">
          <div className="empty">
            Nothing graded yet — this fills in as games go final.
          </div>
        </div>
      )}

      {payouts.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>W</th>
                <th>L</th>
                <th>Win %</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.wins}</td>
                  <td>{p.losses}</td>
                  <td>
                    {p.wins + p.losses
                      ? ((p.wins / (p.wins + p.losses)) * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                  <td className={p.net_usd >= 0 ? "pos" : "neg"}>
                    {money(p.net_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Pool</td>
                <td>{payouts.reduce((s, p) => s + p.wins, 0)}</td>
                <td>{payouts.reduce((s, p) => s + p.losses, 0)}</td>
                <td>—</td>
                <td>$0</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* The spreadsheet grid, week down the side, players across the top. */}
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th></th>
              {names.map((n) => (
                <th key={n} colSpan={2} style={{ textAlign: "center" }}>
                  {n}
                </th>
              ))}
            </tr>
            <tr>
              <th></th>
              {names.map((n) => [
                <th key={n + "w"}>W</th>,
                <th key={n + "l"}>L</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {periods.map(([seq, label]) => (
              <tr key={seq}>
                <td>{label}</td>
                {names.map((n) => {
                  const c = cell(seq, n);
                  const played = c && c.w + c.l > 0;
                  return [
                    <td key={n + "w"}>{played ? c!.w : ""}</td>,
                    <td key={n + "l"}>{played ? c!.l : ""}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {names.map((n) => [
                <td key={n + "w"}>{totals[n].w}</td>,
                <td key={n + "l"}>{totals[n].l}</td>,
              ])}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
