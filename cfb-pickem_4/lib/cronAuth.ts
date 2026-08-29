/**
 * Authorizes a request as either a human hitting the URL with the shared
 * passphrase (?key=...), or Vercel's own Cron trigger.
 *
 * Vercel signs its Cron requests with `Authorization: Bearer $CRON_SECRET`
 * automatically -- but ONLY once a CRON_SECRET env var exists on the
 * project. Without it, a scheduled cron request carries no credential at
 * all, and a route that only ever checked ?key= (as /api/refresh used to)
 * rejects every single automatic firing with a 401. The daily lines cron
 * in vercel.json has almost certainly been failing silently because of
 * this since it was added -- this fixes that route too, not just the new
 * one that needed it.
 */
export function authorizedForCron(req: Request, key: string | null): boolean {
  if (key && process.env.PICK_PASSPHRASE && key === process.env.PICK_PASSPHRASE) {
    return true;
  }
  const auth = req.headers.get("authorization");
  if (auth && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  return false;
}
