/**
 * Manually sets which period is open -- the "Change week" selector on the
 * Picks page. Same passphrase model as /api/picks: there are no logins,
 * so PICK_PASSPHRASE is the whole security model here too.
 */

import { NextResponse } from "next/server";
import { setOpenPeriodById } from "@/lib/periods";

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const body = await req.json();

  const expected = process.env.PICK_PASSPHRASE;
  if (!expected) return bad("PICK_PASSPHRASE isn't set on the server.", 401);
  if (body?.passphrase !== expected) return bad("Wrong passphrase.", 401);

  if (!body?.period_id) return bad("Missing period_id.");

  const result = await setOpenPeriodById(body.period_id);
  if (!result.ok) return bad(result.reason);

  return NextResponse.json({ ok: true, label: result.label });
}
