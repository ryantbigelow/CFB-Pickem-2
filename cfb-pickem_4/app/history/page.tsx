import { money, winPct } from "@/lib/format";
import { HISTORY, LEGACY_SEASONS as SEASONS, careerTotals } from "@/lib/legacy-history";
import { db } from "@/lib/db";

/** A horizontal bar per row, diverging from a zero line — blue for
 * positive dollars, red for a loss, sized against a shared scale so
 * multiple charts on the page stay visually comparable.
 *
 * Names are a plain HTML column, not SVG text laid out next to the bars.
 * They used to live inside the same SVG as the bars, right next to the
 * zero line — which meant a long enough bar (anyone's worst season) was
 * drawn right on top of that same player's own name and hid it. A real
 * DOM column can't be painted over by a sibling's rectangle. */
function DivergingBars({
  rows,
  scale,
}: {
  rows: { label: string; value: number }[];
  scale: number;
}) {
  const svgW = 320;
  const midX = 160; // px from the left where zero sits
  const halfW = 108; // px available on each side of zero, leaving room
                      // at both outer edges for the $ label past the bar

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {rows.map((r) => {
        const w = (Math.abs(r.value) / scale) * halfW;
        const barX = r.value >= 0 ? midX : midX - w;
        return (
          <div
            key={r.label}
            style={{
              display: "grid",
              gridTemplateColumns: "56px 1fr",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                textAlign: "right", fontSize: 11.5, color: "var(--ink-2)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
              title={r.label}
            >
              {r.label}
            </div>
            <svg
              viewBox={`0 0 ${svgW} 22`}
              style={{ width: "100%", height: 20, display: "block", overflow: "visible" }}
            >
              <line
                x1={midX} y1={0} x2={midX} y2={22}
                style={{ stroke: "var(--grid)", strokeWidth: 1 }}
              />
              <rect
                x={barX} y={3} width={Math.max(w, 1.5)} height={16}
                rx={3}
                style={{ fill: r.value >= 0 ? "var(--pos)" : "var(--neg)" }}
              />
              <text
                x={r.value >= 0 ? midX + w + 6 : midX - w - 6}
                y={15}
                textAnchor={r.value >= 0 ? "start" : "end"}
                style={{ fontSize: 11, fill: "var(--ink)", fontWeight: 620 }}
              >
                {money(r.value)}
              </text>
            </svg>
          </div>
        );
      })}
    </div>
  );
}

type LockRow = {
  id: string;
  season: string;
  period: string;
  player: string;
  bet: string;
  lock_call: "win" | "lose";
  call_correct: boolean | null;
};

export const dynamic = "force-dynamic";

export default async function History() {
  // Best-effort: the archived seasons below need no database at all, so
  // this page should still render them even if Supabase isn't configured
  // yet, or migrate-003.sql (which adds weekend_preview_locks) hasn't been
  // run. A missing AI-lock section beats a broken History page.
  let locks: LockRow[] = [];
  try {
    const { data } = await db().from("weekend_preview_locks").select("*");
    locks = (data ?? []) as LockRow[];
  } catch {
    locks = [];
  }
  const gradedLocks = locks.filter((l) => l.call_correct !== null);
  const locksRight = gradedLocks.filter((l) => l.call_correct).length;

  const career = careerTotals().sort((a, b) => b.net - a.net);

  const totalW = career.reduce((s, c) => s + c.w, 0);
  const totalL = career.reduce((s, c) => s + c.l, 0);
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
      <p className="sub" style={{ fontSize: 14, lineHeight: 1.65 }}>
        The pool has gone {totalW}–{totalL} against the spread since 2022. A
        coin flip would have done better. Nobody has to be good at this for
        the game to be fun — but it does mean the money is decided by who is
        least bad, not who is good.
      </p>

      <div className="card">
        <div className="stats">
          <div className="stat">
            <div className="n">{totalW}–{totalL}</div>
            <div className="l">record vs. the spread</div>
          </div>
          <div className="stat">
            <div className="n">{winPct(totalW, totalL)}</div>
            <div className="l">overall win rate</div>
          </div>
          <div className="stat">
            <div className="n">{SEASONS.length}</div>
            <div className="l">seasons archived</div>
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

      {/* ---- the AI's track record ---- */}
      {locks.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <p className="sub" style={{ marginBottom: 10 }}>
            The AI Lock of the Week — the tape doesn&apos;t lie
          </p>
          <p style={{ margin: "0 0 14px", fontSize: 14 }}>
            {gradedLocks.length > 0 ? (
              <>
                <strong>
                  {locksRight}-{gradedLocks.length - locksRight}
                </strong>{" "}
                ({winPct(locksRight, gradedLocks.length - locksRight)}) calling its
                own confident Lock of the Week — {locksRight >= gradedLocks.length - locksRight
                  ? "so far, better than it has any right to be."
                  : "so, about that confidence."}
              </>
            ) : (
              "No locks graded yet this season — check back once games go final."
            )}
          </p>
          <table>
            <thead>
              <tr>
                <th>Season</th>
                <th>Week</th>
                <th>Player</th>
                <th>The Call</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {[...locks].reverse().map((l) => (
                <tr key={l.id}>
                  <td>{l.season}</td>
                  <td>{l.period}</td>
                  <td>{l.player}</td>
                  <td>
                    {l.bet} — {l.lock_call === "win" ? "covers" : "busts"}
                  </td>
                  <td
                    className={
                      l.call_correct === null ? undefined : l.call_correct ? "pos" : "neg"
                    }
                  >
                    {l.call_correct === null ? "pending" : l.call_correct ? "✓ right" : "✗ wrong"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ marginTop: 4 }}>
        This is season-level history only — no per-game detail survives from
        before this app existed, so there's no play-by-play to dig through
        here, just the final tallies db/test.sql already checks the payout
        math against.
      </p>
    </>
  );
}
