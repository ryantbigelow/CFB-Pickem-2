# CFB Pickem — context for Claude

Read this before touching anything. It captures decisions already made, so you
don't re-litigate them or ask Ryan again. `SPEC.md` has the long form.

**Ryan has no programming experience.** Explain what you're doing in plain
language as you go. Don't assume he knows what a migration, an env var, or a
foreign key is. Never leave him with a step that's just "configure your
environment."

---

## The guiding principle

This pool has run for four seasons in a spreadsheet, over a group text, between
six family members. **The group text is the product.** The app exists to kill
the spreadsheet's arithmetic, not to replace the conversation.

Ryan's words: *"I want to preserve the feel of our group."*

So: no bot, no shot clock, no nagging, no automated trash talk. When you're
tempted to add automation that "improves engagement," don't. Anything that moves
banter out of the group text and into software is a regression, even if it works.

**The one deliberate exception is the Weekend Preview** (see below) — Ryan
asked for that automation explicitly, by name, with real specifics about
tone and content. It's a carve-out, not a precedent: it doesn't license
adding more automated content elsewhere on your own initiative.

---

## V1 scope — no accounts

1. **Picks** (`/`) — the whole slate, four slots per game, taken ones showing who
   owns them. Open to anyone with the URL; no login.
2. **Scoreboard** (`/scoreboard`) — live scores for picked games, updating, with
   each pick showing whether it's currently covering.
3. **Results** (`/results`) — the spreadsheet grid: W/L per player per week,
   season totals, money owed.
4. **History** (`/history`) — the four archived pre-app seasons: an all-time
   leaderboard, charts, a "record book" of superlatives, and the AI Lock of the
   Week's track record.
5. **Weekend Preview** (`/weekend-preview`) — Saturdays only. See its own
   section below; it's the one deliberate exception to "no bot."

(Picks/Scoreboard/Results used to be called Picker / Live / Scoreboard, in that
order — renamed August 2026. If you see those old names elsewhere in this
repo's docs or comments, they mean the same pages.)

**One person (Ryan) enters everyone's picks.** Picks arrive in the group text;
he types them in. Later: logins so each player manages their own. Not now.

**Explicitly out of scope for v1:** logins, GroupMe/SMS/any bot, shot clocks,
turn enforcement, notifications.

---

## The game

- **Roster & Week 1 order:** Luke, Ryan, Nick, Mark, Steve, Scott
- **Rotation:** first picker one week picks last the next; everyone else moves up
  one. Both rounds use the same order — it does NOT snake. The app **displays**
  the order; it never enforces it. Sequencing happens in the group text.
- **Four claimable slots per game:** spread/home, spread/away, total/over,
  total/under. Each claimed once league-wide per period. Two players may hold
  opposite sides of the same game.
- **Two picks per player per week**, except postseason rounds — hence
  `picks_per_player` on `periods`.
- **A game is claimable until its own kickoff.**
- **Week 0 and Week 1 are ONE period** (Aug 27 – Sep 7, 2026).
- **18 periods/season:** Wk 0-1, Wk 2..Wk 14, Chmp, Bowl 1, Bowl 2, CFB.

## Picks are editable — this is a requirement, not an edge case

*"People will inevitably want to change their pick and we allow it sometimes.
Make sure that's possible."*

- Any pick can be changed or deleted at any time. Never build a flow that
  refuses an edit.
- Every change is logged automatically to `pick_edits` by a database trigger.
  Allowing edits is easy; **remembering what changed is what prevents the
  argument in November.** Show that history in the UI.
- Editing off a slot frees it for everyone else. Editing *onto* a slot someone
  already owns fails on the unique constraint — catch it and say "Steve has that
  one," don't crash.

## Lines can be entered by hand

`picks.line_source` is `'api'` or `'manual'`.

This matters more than it looks. A pick arrives by text — "I'll take Bama −7" —
and gets typed in hours later, when the live line says −9. **The pool honors what
was agreed in the text.** So the Picks page pre-fills the live number but always lets
Ryan override it. Never silently overwrite a manual line with an API value.

## Money

$10 per game. Verified against four seasons of Ryan's spreadsheet:

```
net $ = stake × Σ over each opponent of [ (your W−L) − (their W−L) ]
      = stake × [ n × (your W−L) − (pool's total W−L) ]
```

**Pushes are voided** — no win, no loss, no money. Zero-sum by construction.

`n` must always come from counting `season_players` rows. Ryan's spreadsheet
broke precisely because it hardcoded the opponent count; adding a sixth player
silently mis-paid everyone. Never hardcode it.

## Non-negotiables

1. **Never store computed totals.** No wins/losses/money columns. Records and
   payouts are views over `picks`.
2. **Slot exclusivity is enforced by the database.** Never "check then insert" —
   catch the unique violation.
3. **Never let an API refresh overwrite `picks.line`.** Live numbers live on
   `games.current_spread` / `current_total`. They are different things.
4. **No bot. No shot clock.** See the guiding principle.

## Stack

Next.js (App Router) · Supabase (Postgres) · Vercel · The Odds API (lines) ·
scores API (see open question).

**No auth in v1**, which means the write path must not be a public Supabase
anon-key insert or anyone with the URL can vandalize the season. Put writes
behind a server-side route with a single shared passphrase in an env var. Crude,
but right-sized for six family members.

## Resolved: editing and scores

**Line on edit — the commissioner types it, pre-filled with the current line.**
The Picks page suggests today's number and Ryan overwrites it with whatever was
actually agreed in the group text. This applies to new picks and edits alike.
Never auto-apply a line change to an existing pick.

**Live scores — ESPN's public scoreboard endpoint** (`lib/scores.ts`). Free and
unlimited, so we can poll through a Saturday. It's undocumented, so the client
is written defensively: a missing field yields a stale score, never a crash. If
scores stop updating, look there first. CollegeFootballData stays as the
fallback and its key is still in `.env.example`.

**Team-name matching is the known fragile point.** Games come from The Odds API,
scores from ESPN, and the two don't name teams identically. `sameGame()` matches
on normalized name AND kickoff day, never name alone. Persist the resolved
`espnId` on first match so later refreshes are an exact lookup.

## Scores sync on page load, NOT on a cron

Vercel Hobby allows daily crons only, so a frequent score cron isn't available —
and isn't wanted. `lib/sync.ts` pulls scores when the Scoreboard page renders,
throttled by `games.scores_updated` to once per 25s, and skips entirely when
nothing has kicked off. The page auto-reloads every 30s, so an open tab stays
current. `vercel.json` has two crons: the daily lines refresh, and the weekly
Weekend Preview generation (below) — both fire at most once a day on the days
they fire at all, which is what Hobby actually requires (not "one cron total").

Do not reintroduce a *frequent* cron; it will fail the Hobby plan check at
deploy time and Ryan sees a red build.

## Cron requests need CRON_SECRET, not just ?key=

Both `/api/refresh` and `/api/generate-preview` accept a human hitting the URL
with `?key=<PICK_PASSPHRASE>`, **or** Vercel's own Cron trigger, checked via
`lib/cronAuth.ts`. Vercel signs its cron requests with
`Authorization: Bearer $CRON_SECRET` automatically, but only once a
`CRON_SECRET` env var exists on the project — without it, a scheduled request
carries no credential at all and gets the same 401 a wrong passphrase would.
`/api/refresh`'s cron almost certainly ran into exactly this for a while before
`CRON_SECRET` was added — if lines ever look stale for a day found long after
this fix shipped, check that `CRON_SECRET` is actually still set in Vercel
before assuming something else broke.

## Weekend Preview — the one deliberate automation

Every Saturday morning (`vercel.json`'s second cron → `/api/generate-preview`
→ `lib/preview.ts`), the app hands Claude this pool's own data — this week's
picks, season records, last period's (or last *season's*, on a season's first
period — `lib/legacy-history.ts`) results, and each player's betting tendencies
— and asks for a sassy recap plus one confident "AI Lock of the Week" call.
The result is stored once in `weekend_previews`; the page only ever reads it.

**Never let a page view trigger generation.** This mirrors the odds-credit
leak fixed earlier: `/api/generate-preview` is the only caller of the Claude
API for this feature, gated behind cron/passphrase auth, and it's a no-op if a
preview already exists for the period (unless `?force=1`). If you're ever
tempted to add a "generate on demand if missing" fallback on the page itself,
don't — that's exactly the failure mode that already cost real money once.

**Grounding, not real handicapping.** The system prompt in `lib/preview.ts`
explicitly forbids inventing stats about real teams — every number it's
allowed to use comes from this pool's own database (which we can verify),
never from the model's outside "knowledge" of actual college football (which
we can't). The "Lock of the Week" is comedy with real numbers behind it, not
a real prediction.

**"Is it Saturday" is timezone-explicit** (`lib/time.ts`, `APP_TIMEZONE =
"America/Chicago"`) — computed the same way regardless of what timezone the
server process happens to run in, the same ambiguity that caused the
kickoff-time bug this app used to have. This is a *shared* fact (same answer
for every viewer), unlike a kickoff time, so it's fine to compute server-side
without a client component.

**The once-a-Saturday redirect lives in `middleware.ts`**, using a cookie
holding the date (not a plain boolean) so it self-resets every new Saturday
with no cleanup job needed. No accounts exist in this app, so a cookie (per
browser) is the same "who's asking" proxy the rest of the app already uses.

## Open questions — ask Ryan, don't guess

- Nothing blocking.

## Verification

`db/schema.sql` has been loaded into real Postgres and tested: the Picks board,
pick entry, editing with audit trail, slot release on edit, collision rejection,
manual line override, live cover margins, the weekly grid, and the payout view
reproducing all 20 historical payouts exactly. Re-run those if you touch the
payout view, `draft_position()`, or the audit triggers.

**TEST 9** covers `weekend_preview_locks`: a Lock call matching its pick's
result (both directions), missing it, an ungraded pick, and a push — all
graded correctly against a fresh load of `schema.sql`. **Not yet covered:** an
actual call to `lib/preview.ts` against a real Anthropic key (nothing in this
repo can safely fabricate an API key to test that end-to-end) — if the stored
JSON from a real generation ever looks wrong, that's the untested seam to
check first.
