"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Slot } from "@/lib/db";

export type GameGroup = {
  game_id: string;
  away_team: string;
  home_team: string;
  kickoff: string;
  status: string;
  slots: Slot[];
};

const ORDER: Array<[Slot["market"], Slot["side"]]> = [
  ["spread", "away"],
  ["spread", "home"],
  ["total", "over"],
  ["total", "under"],
];

const fmt = (n: number | null) =>
  n === null ? "—" : n === 0 ? "PK" : n > 0 ? `+${n}` : `${n}`;

function slotLabel(g: GameGroup, s: Slot) {
  if (s.market === "spread")
    return `${s.side === "home" ? g.home_team : g.away_team}`;
  return s.side === "over" ? "Over" : "Under";
}

/** The number shown for this slot: what's locked if taken, else the live line. */
function slotNumber(s: Slot) {
  const v = s.pick_id ? s.locked_line : s.current_line;
  if (v === null || v === undefined) return "—";
  return s.market === "total" ? `${v}` : fmt(v);
}

export default function Picker({
  games,
  players,
  periodId,
}: {
  games: GameGroup[];
  players: { id: string; name: string }[];
  periodId: string;
}) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [sel, setSel] = useState<{ g: GameGroup; s: Slot } | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [line, setLine] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function open(g: GameGroup, s: Slot) {
    if (!s.available && !s.pick_id) return; // kicked off, nothing to do
    setSel({ g, s });
    setErr("");
    setPlayerId(players.find((p) => p.name === s.owner)?.id ?? "");
    // Pre-fill with the locked line if editing, otherwise today's live number.
    setLine(String(s.pick_id ? s.locked_line ?? "" : s.current_line ?? ""));
    setPass(sessionStorage.getItem("pp") ?? "");
    dlg.current?.showModal();
  }

  async function send(method: "POST" | "PATCH" | "DELETE") {
    if (!sel) return;
    setBusy(true);
    setErr("");
    sessionStorage.setItem("pp", pass);

    const res = await fetch("/api/picks", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passphrase: pass,
        pick_id: sel.s.pick_id,
        period_id: periodId,
        game_id: sel.g.game_id,
        market: sel.s.market,
        side: sel.s.side,
        player_id: playerId,
        line: Number(line),
      }),
    });

    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setErr(b.error ?? `Something went wrong (${res.status})`);
      return;
    }
    dlg.current?.close();
    router.refresh();
  }

  return (
    <>
      <div className="card">
        {games.map((g) => {
          const dead = new Date(g.kickoff) <= new Date() || g.status !== "scheduled";
          return (
            <div className="game" key={g.game_id}>
              <div className="matchup">
                <span className="teams">
                  {g.away_team} @ {g.home_team}
                </span>
                <span className="when">
                  {dead
                    ? g.status === "final"
                      ? "final"
                      : "started"
                    : new Date(g.kickoff).toLocaleString(undefined, {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                </span>
              </div>
              <div className="slots">
                {ORDER.map(([market, side]) => {
                  const s = g.slots.find(
                    (x) => x.market === market && x.side === side
                  );
                  if (!s) return null;
                  const cls = s.pick_id ? "taken" : dead ? "dead" : "";
                  return (
                    <button
                      key={`${market}-${side}`}
                      className={`slot ${cls}`}
                      disabled={dead && !s.pick_id}
                      onClick={() => open(g, s)}
                    >
                      <span>
                        {slotLabel(g, s)}{" "}
                        <span className="num">{slotNumber(s)}</span>
                      </span>
                      {s.owner ? <span className="who">{s.owner}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <dialog ref={dlg} onClose={() => setSel(null)}>
        {sel && (
          <>
            <h3>
              {slotLabel(sel.g, sel.s)}{" "}
              {sel.s.market === "total" ? "" : ""}
            </h3>
            <p className="ctx">
              {sel.g.away_team} @ {sel.g.home_team}
              {sel.s.owner ? ` · currently ${sel.s.owner}` : ""}
            </p>

            <div className="row">
              <div>
                <label>PLAYER</label>
                <select
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ maxWidth: 110 }}>
                <label>LINE</label>
                <input
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>

            <p className="hint">
              Pre-filled with the current line. Change it to whatever was
              actually agreed in the group text — that&apos;s the number this
              pick is graded against.
            </p>

            <div style={{ marginTop: 14 }}>
              <label>PASSPHRASE</label>
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </div>

            {err && <div className="err">{err}</div>}

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 18,
                justifyContent: "flex-end",
              }}
            >
              {sel.s.pick_id && (
                <button
                  className="ghost danger"
                  disabled={busy}
                  onClick={() => send("DELETE")}
                >
                  Remove
                </button>
              )}
              <button className="ghost" onClick={() => dlg.current?.close()}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !playerId || line === ""}
                onClick={() => send(sel.s.pick_id ? "PATCH" : "POST")}
              >
                {busy ? "Saving…" : sel.s.pick_id ? "Update" : "Claim"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
