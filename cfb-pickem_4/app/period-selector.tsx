"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type PeriodOption = { id: string; label: string; status: string };

/** "Change week" — lets anyone with the passphrase override which period
 * is open, for the weeks the Sunday-noon-Central auto-advance (see
 * vercel.json + lib/periods.ts) doesn't get right on its own: skipping
 * ahead, going back, or landing on a bowl period that isn't one-per-week
 * like the regular season is. */
export default function PeriodSelector({ periods }: { periods: PeriodOption[] }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [periodId, setPeriodId] = useState(
    periods.find((p) => p.status === "open")?.id ?? periods[0]?.id ?? ""
  );
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function open() {
    setPeriodId(periods.find((p) => p.status === "open")?.id ?? periods[0]?.id ?? "");
    setErr("");
    setPass(sessionStorage.getItem("pp") ?? "");
    dlg.current?.showModal();
  }

  async function send() {
    setBusy(true);
    setErr("");
    sessionStorage.setItem("pp", pass);

    const res = await fetch("/api/set-period", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: pass, period_id: periodId }),
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
      <button
        className="ghost"
        style={{ padding: "3px 10px", fontSize: 12 }}
        onClick={open}
      >
        Change week
      </button>

      <dialog ref={dlg}>
        <h3>Change week</h3>
        <p className="ctx">
          Normally this moves on its own — every Sunday at noon Central.
          Use this to override it: jump ahead, go back, or pick a bowl
          period out of order.
        </p>

        <div>
          <label>WEEK</label>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.status === "open" ? " — currently open" : ""}
                {p.status === "locked" ? " — locked" : ""}
                {p.status === "final" ? " — final" : ""}
              </option>
            ))}
          </select>
        </div>

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
          <button className="ghost" onClick={() => dlg.current?.close()}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !periodId} onClick={send}>
            {busy ? "Saving…" : "Set as current week"}
          </button>
        </div>
      </dialog>
    </>
  );
}
