# CFB Pickem

A weekly draft-style college football pool for six people.

Each week everyone claims two betting slots off the slate, picking in a
rotating order. The line you get is the line at the second you claim it. Once a
slot is taken it's gone — but the opposite side stays open, so you can end up
head-to-head with your uncle on the same game.

---

## Do this next

Your Supabase project already exists. Four steps to a live site:

1. **Create the tables.** Supabase → SQL Editor → paste all of `db/schema.sql`
   → Run. Then do the same with `db/seed.sql` (players, season, 18 weeks).
2. **Grab two keys.** Supabase → Project Settings → API. Copy the `anon` key and
   the `service_role` key. The service_role key is a password — it goes in
   environment variables only, never in a file you commit or a message you send.
3. **Deploy.** Push this folder to GitHub, import it in Vercel, and add the
   **six** environment variables from `.env.example` (see below). Invent your
   own `PICK_PASSPHRASE` — it's what stops a stranger with the URL from editing
   your season.
4. **Load the slate.** Visit `https://<your-site>/api/refresh?key=<passphrase>`
   once. That pulls the games and lines. After that a daily cron keeps them
   current, and you can always hit that URL again yourself.

**If you already ran `schema.sql` before Aug 17**, also run `db/migrate-001.sql`
— one line, safe to run twice. **If you're adding the Weekend Preview feature
to an already-deployed site**, also run `db/migrate-003.sql` the same way.

### Adding the environment variables in Vercel

In Vercel: **your project → Settings → Environment Variables.**

Add these six, one at a time. For each, paste the name in **Key**, the value in
**Value**, leave all three environments (Production / Preview / Development)
checked, and Save.

| Key | Where the value comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://fesqewmvibkeinvvktkf.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → the `service_role` key (click to reveal) |
| `ODDS_API_KEY` | the-odds-api.com — emailed to you at signup |
| `PICK_PASSPHRASE` | invent one; share it only with the six of you |
| `ANTHROPIC_API_KEY` | console.anthropic.com → sign up → **API Keys** → **Create Key**. Powers the Saturday "Weekend Preview" — a few cents a week, billed to whatever card you put on that account |
| `CRON_SECRET` | invent any random string (it's never shared with anyone) — this is how Vercel proves *to your own site* that a scheduled job, not a stranger, is calling it |

**Then redeploy.** This is the step everyone misses: environment variables are
read at build time, so a deployment that already exists will not pick them up.
Go to **Deployments**, find the most recent one, click the **⋯** menu, and
choose **Redeploy**.

To check it worked, open your site. If the Picks page still says "Not connected
yet," a variable is missing or misspelled — the page names which one.

### About scores and Vercel's free plan

Vercel's Hobby plan only allows **daily** cron jobs, so there is no scores cron.
Instead the Scoreboard page fetches scores itself when you open it, throttled to
once every 25 seconds, and does nothing at all when no game has kicked off. Since
the page reloads every 30 seconds, an open tab stays current on its own.

This is better than a cron anyway: scores update when somebody is actually
watching, and cost nothing when nobody is. **You do not need to upgrade to Pro.**

### About the Weekend Preview

Every Saturday morning, a second cron job (also in `vercel.json`) hits
`/api/generate-preview`, which reads that week's picks and this pool's own
history out of the database and asks Claude to write a sassy, funny recap
plus one confident "AI Lock of the Week" pick. That's the only time the
Anthropic API ever gets called for this feature — never when someone just
opens the page — so there's no way for a burst of visitors to run up a
surprise bill.

The first time anyone opens the site on a Saturday, they land on that page
automatically; after that (or if they visit it directly) it leaves them
alone for the rest of the day, and the "Weekend Preview" tab disappears
from the nav again once Saturday's over. "Saturday" is judged in Central
time (`lib/time.ts`) — change `APP_TIMEZONE` there if the pool isn't a
Central-time crowd.

If Saturday morning arrives and `ANTHROPIC_API_KEY` isn't set yet, the cron
just fails quietly and the page says "check back soon" instead of
crashing — add the key and it picks up the very next Saturday.

Then open the site and start entering picks.

---

## Setup

Everything below is free. Pick **one** of the two paths — they end up in the
same place.

### First: the five accounts (both paths need these)

| # | Service | Where | What it's for |
|---|---|---|---|
| 1 | GitHub | github.com | where the code lives |
| 2 | Supabase | supabase.com | the database and email login |
| 3 | Vercel | vercel.com | hosting the site |
| 4 | The Odds API | the-odds-api.com | live spreads and totals |
| 5 | CollegeFootballData | collegefootballdata.com/key | final scores for grading |

Sign in to Supabase and Vercel **with GitHub** — it saves a step later.

> **Never paste a key into a chat, a file, or a commit.** Keys go in Vercel's
> Settings → Environment Variables, and nowhere else. `.env.example` lists which
> ones you need; copy it to `.env.local`, which is git-ignored.

---

### Path A — the browser (no terminal at all)

Slower to iterate on, but you never type a command.

1. **Make the repo.** On github.com click **New repository**, name it
   `cfb-pickem`, then **uploading an existing file** and drag this whole folder
   in.
2. **Make the database.** In Supabase create a project. Open **SQL Editor**,
   paste the entire contents of `db/schema.sql`, and hit Run. That's your
   database — every table, constraint, and view.
3. **Deploy.** In Vercel click **Add New → Project**, pick the `cfb-pickem`
   repo, and add the environment variables from `.env.example`. Deploy.
4. **Done.** Vercel gives you a URL. Every time you change a file on GitHub, the
   site redeploys itself.

### Path B — the terminal (Claude Code)

Better once you're changing things often, because you can run it locally and
see errors immediately. Costs you an afternoon of setup the first time.

```bash
# 1. Install Node (which includes npm) from nodejs.org, then check it worked:
node --version

# 2. Get the code onto your machine and install its dependencies
cd cfb-pickem
npm install

# 3. Copy the example env file and fill in your keys
cp .env.example .env.local

# 4. Run it locally — open http://localhost:3000
npm run dev
```

Load `db/schema.sql` into Supabase the same way as Path A step 2 (the SQL
editor is the easiest route either way), then deploy with Vercel's GitHub
integration.

---

## What v1 is

No accounts. The always-there pages:

- **Picks** — the whole slate, four slots per game, taken ones showing who owns
  them. Anyone with the URL can use it.
- **Scoreboard** — live scores for picked games, and whether each pick is covering.
- **Results** — the spreadsheet grid: W/L by week, season totals, money.
- **History** — the four archived pre-app seasons: an all-time leaderboard,
  charts, a "record book" of superlatives, and the AI Lock of the Week's track
  record.

Plus one that only shows up on Saturdays:

- **Weekend Preview** — a sassy, AI-written recap of the week's picks and one
  confident "Lock of the Week" call, regenerated automatically every Saturday
  morning. The first page anyone opens on a Saturday redirects here once; the
  tab itself disappears from the nav again once Saturday's over.

Ryan enters everyone's picks; they arrive in the group text. Picks can always be
changed, and every change is logged. Logins come later.

---

## How the code is organized

```
db/schema.sql                    the database: tables, constraints, payout views
db/test.sql                      the test suite that proves the schema works
lib/odds.ts                      fetches lines from The Odds API (credit-budgeted)
lib/scores.ts                    live scores from ESPN, plus win/loss grading
lib/preview.ts                   builds the Weekend Preview prompt, calls Claude, stores it
lib/legacy-history.ts            the four archived pre-app seasons (History + Preview share it)
lib/time.ts                      timezone-explicit "is it Saturday" helpers
lib/cronAuth.ts                  authorizes Vercel Cron requests and manual ?key= hits
lib/db.ts                        server-only database access
middleware.ts                    the once-a-Saturday redirect to Weekend Preview
app/page.tsx                     the picks board
app/scoreboard/page.tsx          live scores
app/results/page.tsx             the spreadsheet grid
app/history/page.tsx             the archive + the AI Lock's track record
app/weekend-preview/page.tsx     Saturday's AI-written recap (only linked in nav on Saturdays)
app/api/picks/route.ts           the only path that writes picks
app/api/refresh/route.ts         pulls lines + scores, grades finished games
app/api/generate-preview/route.ts   writes the week's Weekend Preview (Saturday cron only)
db/seed.sql                      players, season, and the 18 weeks
db/migrate-003.sql               adds the Weekend Preview tables to an existing database
SPEC.md                          every rule, and why
CLAUDE.md                        context for Claude Code — read it before changing things
```

## Season timeline

| Date | What |
|---|---|
| Aug 27 | Week 0 kickoff — first period opens |
| Sept 3–7 | Week 1, drafted together with Week 0 |
| Jan | Bowls, then the national championship |
