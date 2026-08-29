/**
 * Generates (or, with ?force=1, regenerates) this week's Weekend Preview.
 *
 * Fired by the Saturday-morning Vercel Cron (see vercel.json), or by hand
 * with ?key=<passphrase> for testing. This is the ONLY thing that ever
 * calls the Claude API for this feature — never a page view, so loading
 * /weekend-preview can never trigger a new charge.
 */

import { NextResponse } from "next/server";
import { generateWeekendPreview } from "@/lib/preview";
import { authorizedForCron } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorizedForCron(req, url.searchParams.get("key")))
    return NextResponse.json({ error: "Wrong key." }, { status: 401 });

  try {
    const result = await generateWeekendPreview(url.searchParams.get("force") === "1");
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[generate-preview] failed:", e);
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}
