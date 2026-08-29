import { db, activePeriod, GridRow, Payout } from "@/lib/db";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Results() {
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

  // net_usd per player, keyed by name, for the money row under Total —
  // same layout as Ryan's old spreadsheet: one cell, spanning both of a
  // player's W/L columns, centered directly beneath their season total.
  const netByName = Object.fromEntries(
    (payouts as Payout[]).map((p) => [p.name, p.net_usd])
  );

  const anyPlayed = rows.some((r) => r.w + r.l > 0);

  return (
    <>
      <h1>Results</h1>
      <p className="sub">{active.season.label} · $10 per game</p>

      {!anyPlayed && (
        <div className="card">
          <div className="empty">
            Nothing graded yet — this fills in as games go final.
          </div>
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
            {payouts.length > 0 && (
              <tr>
                <td>Money</td>
                {names.map((n) => {
                  const net = netByName[n];
                  return (
                    <td
                      key={n}
                      colSpan={2}
                      className={net === undefined ? undefined : net >= 0 ? "pos" : "neg"}
                      style={{ textAlign: "center" }}
                    >
                      {net === undefined ? "" : money(net)}
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </>
  );
}
