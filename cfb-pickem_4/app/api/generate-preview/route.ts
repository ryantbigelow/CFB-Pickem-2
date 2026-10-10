/**
 * Generates (or, with ?force=1, regenerates) this week's Weekend Preview.
 *
 * Fired by the Saturday-morning Vercel Cron (see vercel.json), or by hand
 * with ?key=<passphrase> for testing. This is the ONLY thing that ever
 * calls the Claude API for this feature — never a page view, so loading
 * /weekend-preview can never trigger a new charge.
 *
 * Every outcome -- generated, skipped, failed, or rejected at the door --
 * is written to app_state via recordPreviewAttempt(), so the Weekend
 * Preview page can say what actually happened on a morning it's empty
 * instead of "nothing here yet." See lib/preview.ts for why.
 */

import { NextResponse } from "next/server";
import { generateWeekendPreview, recordPreviewAttempt } from "@/lib/preview";
import { authorizedForCron } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!authorizedForCron(req, url.searchParams.get("key"))) {
    // A 401 here on a Saturday at 7am Central is the Vercel cron itself
    // getting turned away -- which only happens if CRON_SECRET is missing
    // or mismatched in the project's environment variables. Say so where
    // it'll be seen.
    await recordPreviewAttempt(
      false,
      "Request rejected: wrong or missing credential. If this was the Saturday " +
        "cron, CRON_SECRET is missing or doesn't match in Vercel's environment variables."
    );
    return NextResponse.json({ error: "Wrong key." }, { status: 401 });
  }

  try {
    const result = await generateWeekendPreview(url.searchParams.get("force") === "1");
    await recordPreviewAttempt(
      true,
      result.skipped ? `Skipped: ${result.reason}.` : `Generated for ${result.periodLabel}.`
    );
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[generate-preview] failed:", e);
    const message = e?.message ?? "Unknown error";
    await recordPreviewAttempt(false, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
