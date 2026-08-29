import { NextRequest, NextResponse } from "next/server";
import { APP_TIMEZONE, isSaturdayIn, todayKeyIn } from "@/lib/time";

/**
 * Saturdays only: the first page a viewer opens gets redirected to
 * /weekend-preview once, then leaves them alone for the rest of the day.
 *
 * "Once" is tracked with a cookie holding the date (in APP_TIMEZONE) they
 * were last routed there — not a boolean, so it self-resets every new
 * Saturday without any cleanup job. There are no accounts in this app, so
 * a cookie (per browser) is the same "who's asking" proxy the rest of the
 * app already uses (picker.tsx keeps the passphrase in sessionStorage the
 * same way).
 */
const SEEN_COOKIE = "wp_seen";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 2; // 2 days — just needs to outlive one Saturday

export function middleware(req: NextRequest) {
  if (!isSaturdayIn(APP_TIMEZONE)) return NextResponse.next();

  const today = todayKeyIn(APP_TIMEZONE);
  const alreadySeenToday = req.cookies.get(SEEN_COOKIE)?.value === today;
  const isPreviewPage = req.nextUrl.pathname === "/weekend-preview";

  if (alreadySeenToday || isPreviewPage) {
    // Landing on the preview page directly (bookmark, or our own redirect)
    // counts as "seen" too, so mark it even when we're not redirecting.
    const res = NextResponse.next();
    res.cookies.set(SEEN_COOKIE, today, { path: "/", maxAge: COOKIE_MAX_AGE });
    return res;
  }

  const url = req.nextUrl.clone();
  url.pathname = "/weekend-preview";
  const res = NextResponse.redirect(url);
  res.cookies.set(SEEN_COOKIE, today, { path: "/", maxAge: COOKIE_MAX_AGE });
  return res;
}

export const config = {
  // Every page route, but not API routes, Next's own assets, or the favicon.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
