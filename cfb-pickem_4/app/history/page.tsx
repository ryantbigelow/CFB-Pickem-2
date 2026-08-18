import { money, winPct } from "@/lib/format";

/**
 * The archive. Four seasons before this app existed, when the whole
 * operation ran on Ryan's spreadsheet.
 *
 * This table is the same fixture db/test.sql uses to prove the payout
 * formula reproduces the old spreadsheet exactly (see "TEST 7" there) —
 * it's real history, just at season grain. Nobody logged individual
 * games back then, so that's the finest detail available: each player's
 * win/loss record and net dollars for each season they played.
 *
 * Static on purpose. Nothing here changes, so nothing here touches the
 * database.
 */
const HISTORY: { season: string; name: string; w: number; l: number; net: number }[] = [
  { season: "22-23", name: "Luke", w: 11, l: 17, net: -140 },
  { season: "22-23", name: "Ryan", w: 14, l: 14, net: 160 },
  { season: "22-23", name: "Mark", w: 13, l: 16, net: 10 },
  { season: "22-23", name: "Steve", w: 13, l: 15, net: 60 },
  { season: "22-23", name: "Scott", w: 12, l: 17, net: -90 },

  { season: "23-24", name: "Luke", w: 15, l: 13, net: 180 },
  { season: "23-24", name: "Ryan", w: 9, l: 19, net: -420 },
  { season: "23-24", name: "Mark", w: 11, l: 18, net: -270 },
  { season: "23-24", name: "Steve", w: 18, l: 11, net: 430 },
  { season: "23-24", name: "Scott", w: 14, l: 14, net: 80 },

  { season: "24-25", name: "Luke", w: 13, l: 20, net: -270 },
  { season: "24-25", name: "Ryan", w: 17, l: 16, net: 130 },
  { season: "24-25", name: "Mark", w: 15, l: 17, net: -20 },
  { season: "24-25", name: "Steve", w: 16, l: 17, net: 30 },
  { season: "24-25", name: "Scott", w: 17, l: 16, net: 130 },

  { season: "25-26", name: "Nick", w: 16, l: 18, net: 160 },
  { season: "25-26", name: "Ryan", w: 11, l: 23, net: -340 },
  { season: "25-26", name: "Mark", w: 13, l: 20, net: -90 },
  { season: "25-26", name: "Steve", w: 18, l: 16, net: 360 },
  { season: "25-26", name: "Scott", w: 13, l: 20, net: -90 },
];

const SEASONS = [...new Set(HISTORY.map((r) => r.season))].sort();

type Career = {
  name: string;
  seasons: number;
  w: number;
  l: number;
  net: number;
  perSeason: number;
  spread: number; // this player's best season win% minus their worst
};

function careerTotals(): Career[] {
  const byName = new Map<string, typeof HISTORY>();
  for (const r of HISTORY) {
    byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  }
  return [...byName.entries()].map(([name, rows]) => {
    const w = rows.reduce((s, r) => s + r.w, 0);
    const l = rows.reduce((s, r) => s + r.l, 0);
    const net = rows.reduce((s, r) => s + r.net, 0);
    const pcts = rows.map((r) => (r.w / (r.w + r.l)) * 100);
    return {
      name,
      seasons: rows.length,
      w,
      l,
      net,
      perSeason: net / rows.length,
      spread: Math.max(...pcts) - Math.min(...pcts),
    };
  });
}

/** A horizontal bar per row, diverging from a zero line — blue for
 * positive dollars, red for a loss, sized against a shared scale so
 * multiple charts on the page stay visually comparable. */
function DivergingBars({
  rows,
  scale,
}: {
  rows: { label: string; value: number }[];
  scale: number;
}) {
  const rowH = 24;
  const height = rows.length * rowH;
  const midX = 132; // px from the left where zero sits
  const halfW = 130; // px available on each side of zero

  return (
    <svg
      viewBox={`0 0 400 ${height}`}
      style={{ width: "100%", height: "auto", overflow: "visible" }}
    >
      <line
        x1={midX} y1={0} x2={midX} y2={height}
        style={{ stroke: "var(--grid)", strokeWidth: 1 }}
      />
      {rows.map((r, i) => {
        const w = (Math.abs(r.value) / scale) * halfW;
        const y = i * rowH;
        const barX = r.value >= 0 ? midX : midX - w;
        return (
          <g key={r.label}>
            <text
              x={midX - 8} y={y + rowH / 2 + 4} textAnchor="end"
              style={{ fontSize: 11.5, fill: "var(--ink-2)" }}
            >
              {r.label}
            </text>
            <rect
              x={barX} y={y + 4} width={Math.max(w, 1.5)} height={rowH - 10}
              rx={3}
              style={{ fill: r.value >= 0 ? "var(--pos)" : "var(--neg)" }}
            />
            <text
              x={r.value >= 0 ? midX + w + 8 : midX - w - 8}
              y={y + rowH / 2 + 4}
              textAnchor={r.value >= 0 ? "start" : "end"}
              style={{ fontSize: 11.5, fill: "var(--ink)", fontWeight: 620 }}
            >
              {money(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function History() {
  const career = careerTotals().sort((a, b) => b.net - a.net);

  const totalPicks = HISTORY.reduce((s, r) => s + r.w + r.l, 0);
  const redistributed = SEASONS.reduce((sum, season) => {
    const positives = HISTORY.filter((r) => r.season === season && r.net > 0);
    return sum + positives.reduce((s, r) => s + r.net, 0);
  }, 0);

  const bestSeason = HISTORY.reduce((a, b) => (b.net > a.net ? b : a));
  const worstSeason = HISTORY.reduce((a, b) => (b.net < a.net ? b : a));

  // Both happen to also be this dataset's best/worst single-season win%,
  // so one card covers both angles instead of two redundant ones.
  const multiSeason = career.filter((c) => c.seasons > 1);
  const mostConsistent = multiSeason.reduce((a, b) => (b.spread < a.spread ? b : a));
  const leastConsistent = multiSeason.reduce((a, b) => (b.spread > a.spread ? b : a));

  const careerScale = Math.max(...career.map((c) => Math.abs(c.net)));
  const seasonScale = Math.max(...HISTORY.map((r) => Math.abs(r.net)));

  const luke = career.find((c) => c.name === "Luke");
  const nick = career.find((c) => c.name === "Nick");
  const ryan = career.find((c) => c.name === "Ryan");

  return (
    <>
      <h1>History</h1>
      <p className="sub">
        Four seasons before this app existed, back when it was all one
        spreadsheet. Records don't change. Reputations shouldn't either.
      </p>

      <div className="card">
        <div className="stats">
          <div className="stat">
            <div className="n">{SEASONS.length}</div>
            <div className="l">seasons archived</div>
          </div>
          <div className="stat">
            <div className="n">{totalPicks}</div>
            <div className="l">picks graded</div>
          </div>
          <div className="stat">
            <div className="n">${redistributed.toLocaleString()}</div>
            <div className="l">changed hands</div>
          </div>
          <div className="stat">
            <div className="n">{career[0].name}</div>
            <div className="l">only career winner</div>
          </div>
        </div>
      </div>

      {/* ---- all-time leaderboard ---- */}
      <div className="card" style={{ overflowX: "auto" }}>
        <p className="sub" style={{ marginBottom: 10 }}>
          All-time — ranked by career net, not by ego
        </p>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Seasons</th>
              <th>W</th>
              <th>L</th>
              <th>Win %</th>
              <th>Net</th>
              <th>Per season</th>
            </tr>
          </thead>
          <tbody>
            {career.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.seasons}</td>
                <td>{c.w}</td>
                <td>{c.l}</td>
                <td>{winPct(c.w, c.l)}</td>
                <td className={c.net >= 0 ? "pos" : "neg"}>{money(c.net)}</td>
                <td className={c.perSeason >= 0 ? "pos" : "neg"}>
                  {money(c.perSeason)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 10 }}>
          Luke sat out 25-26; Nick took his slot that year and hasn't left
          since. "Per season" is there so a guy with one great year
          (Nick) and a guy with four mediocre ones (almost everybody else)
          don't get compared like they played the same amount of poker.
        </p>
      </div>

      {/* ---- career net, at a glance ---- */}
      <div className="card">
        <p className="sub" style={{ marginBottom: 10 }}>
          Career net — four seasons of everyone else's money
        </p>
        <DivergingBars
          rows={career.map((c) => ({ label: c.name, value: c.net }))}
          scale={careerScale}
        />
      </div>

      {/* ---- season by season ---- */}
      <div className="card">
        <p className="sub" style={{ marginBottom: 10 }}>
          Season by season — same scale throughout, so a long bar always means
          the same thing
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 18,
          }}
        >
          {SEASONS.map((season) => {
            const rows = HISTORY.filter((r) => r.season === season).sort(
              (a, b) => b.net - a.net
            );
            return (
              <div key={season}>
                <p className="hint" style={{ marginBottom: 6, fontWeight: 620 }}>
                  {season}
                </p>
                <DivergingBars
                  rows={rows.map((r) => ({ label: r.name, value: r.net }))}
                  scale={seasonScale}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- superlatives ---- */}
      <div className="card">
        <p className="sub" style={{ marginBottom: 10 }}>
          The record book
        </p>
        <div className="supers">
          <div className="super">
            <div className="tag">The Dynasty</div>
            <h3>{career[0].name}, {money(career[0].net)} lifetime</h3>
            <p>
              The only player with a winning career record ({career[0].w}-
              {career[0].l}, {winPct(career[0].w, career[0].l)}) and the only
              one who's actually up money across all four seasons. Everyone
              else has been funding this, whether they've noticed or not.
            </p>
          </div>

          <div className="super">
            <div className="tag">The Commissioner's Curse</div>
            <h3>Ryan, {money(ryan!.perSeason)}/season average</h3>
            <p>
              The worst per-season average in the archive belongs to the guy
              who enters everyone else's picks. Also owns the two worst
              single-season win rates ever recorded — {winPct(9, 19)} in
              23-24 and {winPct(11, 23)} in 25-26. Nobody else is within five
              points of either.
            </p>
          </div>

          <div className="super">
            <div className="tag">Best Single Season</div>
            <h3>
              {bestSeason.name}, {bestSeason.season}: {money(bestSeason.net)}
            </h3>
            <p>
              {bestSeason.w}-{bestSeason.l} ({winPct(bestSeason.w, bestSeason.l)}),
              the best win rate anyone's posted in a single season too. That
              same year produced the worst season on record, below — make of
              that what you will.
            </p>
          </div>

          <div className="super">
            <div className="tag">Worst Single Season</div>
            <h3>
              {worstSeason.name}, {worstSeason.season}: {money(worstSeason.net)}
            </h3>
            <p>
              {worstSeason.w}-{worstSeason.l} ({winPct(worstSeason.w, worstSeason.l)}).
              Same season as the best one above. Zero-sum pools work like
              that — somebody's boom is always somebody's bust.
            </p>
          </div>

          <div className="super">
            <div className="tag">Mr. Consistent</div>
            <h3>{mostConsistent.name}, {mostConsistent.spread.toFixed(1)}-pt spread</h3>
            <p>
              Never won a season, never fell off a cliff either — every
              year lands between roughly 38% and 47%. The most predictable
              player in the pool, for better and worse.
            </p>
          </div>

          <div className="super">
            <div className="tag">The Coin Flip</div>
            <h3>{leastConsistent.name}, {leastConsistent.spread.toFixed(1)}-pt spread</h3>
            <p>
              The opposite of {mostConsistent.name} in every way —{" "}
              {leastConsistent.name}{"'"}s win rate has swung nearly{" "}
              {leastConsistent.spread.toFixed(0)} points season to season. No
              steady state, just heaters and slumps. (Also owns two of the
              record book{"'"}s other entries — draw your own conclusions.)
            </p>
          </div>

          <div className="super">
            <div className="tag">The Wash</div>
            <h3>Scott, {money(career.find((c) => c.name === "Scott")!.net)} lifetime</h3>
            <p>
              Four seasons, six-figure-adjacent swings from everyone else, and
              Scott nets out to almost exactly zero. Never the story, never
              the disaster.
            </p>
          </div>

          <div className="super">
            <div className="tag">The Understudy</div>
            <h3>
              Nick, {money(nick!.net)} in his only season vs. Luke's{" "}
              {money(luke!.perSeason)}/season
            </h3>
            <p>
              Nick stepped into Luke{"'"}s seat for 25-26 and immediately
              out-earned Luke{"'"}s career per-season average in his very
              first try. Small sample, loud statement.
            </p>
          </div>
        </div>
      </div>

      <p className="hint" style={{ marginTop: 4 }}>
        This is season-level history only — no per-game detail survives from
        before this app existed, so there's no play-by-play to dig through
        here, just the final tallies db/test.sql already checks the payout
        math against.
      </p>
    </>
  );
}
