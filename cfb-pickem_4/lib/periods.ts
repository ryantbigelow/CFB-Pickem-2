/**
 * Which period is "open" for picks. Still fundamentally manual by design —
 * nothing here infers it from game dates or scores — but two paths now
 * change it instead of a hand-written SQL UPDATE:
 *
 *   1. A Sunday-noon-Central cron (vercel.json -> /api/advance-period)
 *      moves the pool forward exactly one period, every week, all season.
 *   2. The "Change week" selector on the Picks page, for anyone who needs
 *      to override that -- jump ahead, back, or skip a period (bowls
 *      don't line up one-per-week the way the regular season does).
 *
 * Both funnel through setOpenPeriod() below, so there's exactly one place
 * that ever writes periods.status.
 */

import { db, activePeriod } from "./db";

export type AdvanceResult =
  | { advanced: true; from: string; to: string }
  | { advanced: false; reason: string };

/** Close whatever period is open, open the next one by seq. If nothing is
 * currently open, opens the earliest 'upcoming' period instead of
 * guessing which one "next" means. */
export async function advanceToNextPeriod(): Promise<AdvanceResult> {
  const active = await activePeriod();
  if (!active) return { advanced: false, reason: "no active season" };
  const { period, periods } = active;

  const currentlyOpen = periods.find((p: any) => p.status === "open");
  if (!currentlyOpen) {
    const first = periods.find((p: any) => p.status === "upcoming");
    if (!first) return { advanced: false, reason: "no upcoming period to open" };
    await setOpenPeriod(null, first.id);
    return { advanced: true, from: "(none open)", to: first.label };
  }

  const next = periods.find((p: any) => p.seq === currentlyOpen.seq + 1);
  if (!next) {
    return {
      advanced: false,
      reason: `no period after "${currentlyOpen.label}" (seq ${currentlyOpen.seq}) -- season's over`,
    };
  }

  await setOpenPeriod(currentlyOpen.id, next.id);
  return { advanced: true, from: currentlyOpen.label, to: next.label };
}

export type SetPeriodResult =
  | { ok: true; label: string }
  | { ok: false; reason: string };

/** Set a specific period 'open' by id, e.g. from the Picks-page selector.
 * Locks whichever period was open before, if any and if different. */
export async function setOpenPeriodById(periodId: string): Promise<SetPeriodResult> {
  const active = await activePeriod();
  if (!active) return { ok: false, reason: "No active season." };

  const target = active.periods.find((p: any) => p.id === periodId);
  if (!target) return { ok: false, reason: "That period doesn't exist." };

  const currentlyOpen = active.periods.find((p: any) => p.status === "open");
  await setOpenPeriod(currentlyOpen?.id ?? null, target.id);
  return { ok: true, label: target.label };
}

async function setOpenPeriod(fromPeriodId: string | null, toPeriodId: string) {
  const s = db();
  // 'locked', not 'final': games in the outgoing period may not all be
  // graded yet (the auto-advance in particular doesn't wait to check) --
  // 'locked' means "no new picks," not "fully settled." gradeFinished()
  // (lib/sync.ts) is what actually grades picks, independent of this.
  if (fromPeriodId && fromPeriodId !== toPeriodId) {
    await s.from("periods").update({ status: "locked" }).eq("id", fromPeriodId);
  }
  await s.from("periods").update({ status: "open" }).eq("id", toPeriodId);
}
