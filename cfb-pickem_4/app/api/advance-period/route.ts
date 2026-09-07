/**
 * Advances to the next period (Sunday-noon-Central cron, see vercel.json),
 * or by hand with ?key=<passphrase>. Same cron/passphrase auth as
 * /api/refresh and /api/generate-preview -- see lib/cronAuth.ts.
 *
 * Unconditional: whatever's open when this fires gets locked, and the next
 * one by seq gets opened. There's no "did this already run this week"
 * check, on purpose -- it's a pure function of current database state, so
 * a manual override via the Picks-page selector earlier in the week just
 * becomes the new starting point next Sunday, nothing to reconcile.
 */

import { NextResponse } from "next/server";
import { advanceToNextPeriod } from "@/lib/periods";
import { authorizedForCron } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorizedForCron(req, url.searchParams.get("key")))
    return NextResponse.json({ error: "Wrong key." }, { status: 401 });

  try {
    const result = await advanceToNextPeriod();
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[advance-period] failed:", e);
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}
