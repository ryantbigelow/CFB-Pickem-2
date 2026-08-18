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

---

## V1 scope — three pages, no accounts

1. **Picks** (`/`) — the whole slate, four slots per game, taken ones showing who
   owns them. Open to anyone with the URL; no login.
2. **Scoreboard** (`/scoreboard`) — live scores for picked games, updating, with
   each pick showing whether it's currently covering.
3. **Results** (`/results`) — the spreadsheet grid: W/L per player per week,
   season totals, money owed.

(These pages used to be called Picker / Live / Scoreboard, in that order —
renamed August 2026. If you see those old names elsewhere in this repo's docs
or comments, they mean the same pages.)

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
current. `vercel.json` has ONE daily cron, and it only refreshes lines.

Do not reintroduce a frequent cron; it will fail the Hobby plan check at deploy
time and Ryan sees a red build.

## Open questions — ask Ryan, don't guess

- Nothing blocking.

## Verification

`db/schema.sql` has been loaded into real Postgres and tested: the Picks board,
pick entry, editing with audit trail, slot release on edit, collision rejection,
manual line override, live cover margins, the weekly grid, and the payout view
reproducing all 20 historical payouts exactly. Re-run those if you touch the
payout view, `draft_position()`, or the audit triggers.
