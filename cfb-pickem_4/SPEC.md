# CFB Pickem — Game Spec

> **V1 SCOPE (Aug 17, revised).** Three pages, no accounts: a **picker** anyone
> with the URL can use, a **live dashboard** of scores for picked games, and a
> **scoreboard** in the shape of the old spreadsheet. Ryan enters everyone's
> picks; they arrive in the group text. **Picks are always editable**, with an
> audit trail. Logins come later.
>
> **Cut from earlier drafts:** the GroupMe bot, the shot clock, auto-skip, turn
> enforcement, and all notifications. Turn order still rotates and is still
> displayed, but it is managed socially in the group text — because the group
> text is the point. Sections below describing the bot or the shot clock are
> kept only as a record of what was considered and why it was dropped.


*Version 0.1 — drafted Aug 17, 2026*

This is the rulebook and the build blueprint in one document. Everything in
**Confirmed** is settled and I'll build to it. Everything in **Open** needs a
decision from you before the corresponding code gets written.

---

## The game in one paragraph

Six players. Each week, every player claims **two betting slots** from the
college football slate. Players claim in a rotating order, one at a time,
asynchronously — when your turn arrives you get notified, you pick, and the
turn passes to the next player. The line you get is the line at the exact
moment you claim it. Every slot is exclusive: once it's gone, it's gone. The
board is fully public at all times.

---

## Confirmed rules

### Players and picks

| Item | Value |
|---|---|
| Number of players | 6 |
| Picks per player per week | 2 |
| Total picks per week | 12 |
| Draft style | Asynchronous, turn-based |
| Board visibility | Fully public, live |

### What counts as a "slot"

Every game on the slate offers **four independently claimable slots**:

| Slot | Example |
|---|---|
| Home spread | Alabama −7 |
| Away spread | Auburn +7 |
| Total — over | Over 52.5 |
| Total — under | Under 52.5 |

Each of these four can be claimed by exactly **one** player per week. Two
different players may hold opposite sides of the same game — in fact that's
encouraged, it's the head-to-head hook. But no two players can hold the *same*
side.

With 12 picks a week against a slate of 50+ games, supply is never a
constraint. Scarcity is about the *good* slots, which is exactly the point of
the draft order.

### The line you get

The spread or total is captured **at the instant you submit your pick** and
frozen to you permanently. If you pick Alabama −7 on Monday and the line moves
to −10 by Saturday, you're still graded at −7.

This is the mechanical reason draft position matters, and it's why picking
early in the week is a real strategic choice rather than just an
administrative one.

### Roster and draft order — 2026-27

Week 1 order, as given:

| Slot | Player |
|---|---|
| 1 | Luke |
| 2 | Ryan |
| 3 | Nick |
| 4 | Mark |
| 5 | Steve |
| 6 | Scott |

**Straight rotation.** Whoever picks first one week picks last the next, and
everyone else moves up one slot:

```
Wk 0-1 : Luke  Ryan  Nick  Mark  Steve Scott
Wk 2   : Ryan  Nick  Mark  Steve Scott Luke
Wk 3   : Nick  Mark  Steve Scott Luke  Ryan
```

Everyone holds every slot exactly once per six periods. Round 2 uses the same
order as round 1 — it does *not* snake back.

> **Confirm the direction.** I've implemented first-picker-becomes-last. If your
> league rotates the other way (last picker jumps to first), it's a one-character
> change in `draft_position()`.

### Week 0 and Week 1 are one period

Per your call, the Aug 27 Week 0 slate and the Sept 3–7 Week 1 slate are drafted
together as a **single scoring period** with the normal 2 picks each. This also
removes the timeline crunch — one draft, opening before Aug 27, covering
everything through Sept 7. A game is claimable right up until its own kickoff,
so a Week 1 game stays on the board after the Week 0 games have played.

### Eligibility

A game can only be claimed if it **has not yet kicked off**. Once a game
starts, all four of its slots are dead for the week, claimed or not.

### Season structure

From the spreadsheet, a season is **18 scoring periods**, not 14:

`Wk 1 … Wk 14` → `Chmp` (conference championships) → `Bowl 1` → `Bowl 2` → `CFB`
(national championship)

The postseason periods behave differently — in several years players had only
one pick available rather than two, because the slate is thin. The app must
allow a **variable picks-per-period** setting rather than hardcoding 2.

### Money

**$10 per game**, settled by this formula, verified against every payout cell
in all four seasons of the workbook:

> **net $ = $10 × Σ over each opponent of [(your W−L) − (their W−L)]**

The pool is zero-sum by construction. **Pushes are voided** — no win, no loss,
no money.

---

## Open decisions

These are the ones I need from you. I've flagged my recommendation on each.

### 1. The stall rule — the most important open item

This is async, so a player who doesn't pick blocks all 12 turns behind them.
With 12 sequential turns and a Thursday-night kickoff, the math is tight: if
each player gets 12 hours and the draft opens Sunday morning, the last pick
lands Saturday. That doesn't work.

Options:

- **Shot clock with auto-skip** *(recommended)* — you get N hours; if you miss
  it, your turn is skipped and you pick at the end of the round. Keeps things
  moving without penalizing anyone too harshly.
- **Shot clock with autopick** — the system picks for you, e.g. the largest
  remaining favorite. Harsh, but the draft never stalls.
- **Hard forfeit** — miss your window, lose the pick that week. Simple, brutal,
  effective at training people to show up.

You also need to tell me **the shot clock length** and **when the draft opens**.
My suggestion: draft opens Sunday 6pm, 8-hour clock, and any pick not made by
Wednesday midnight is forfeited. That gets all 12 picks in well before Thursday
kickoffs with room to spare.

### ~~2. Scoring~~ — RESOLVED from the spreadsheet

Decoded and verified against all four seasons in `Betting Pool.xlsx`:

> **net $ = $10 × Σ over each opponent of [(your W−L) − (their W−L)]**

Equivalently `$10 × [N × your net − the pool's net]`, where N is the number of
players. This reproduces **every payout cell in all four season tabs exactly**,
so it is the real rule, not an approximation.

**Pushes are voided** — no win, no loss, no money. Confirmed by the weeks where
a player shows 1–0 or 0–1 instead of a full two picks.

### 3. Grading source

Someone or something has to decide who won. Automatic grading against final
scores is doable — CollegeFootballData's free tier covers scores fine — but
there are always weird edge cases (cancelled games, weather).

Recommended: **auto-grade, with a manual override you control.** You get an
admin button to correct anything the system gets wrong.

### ~~Notifications~~ — RESOLVED: GroupMe bot, full chatter

**Why not the alternatives** (researched Aug 2026):

| Option | Verdict |
|---|---|
| Bot in your iMessage group | **No.** No Apple API. Third-party services run Mac farms at $100–300/mo and break when Apple blocks them. |
| Bot in an RCS group chat | **No.** RCS Business Messaging defines a conversation as "a series of messages between two parties" — strictly 1:1. Agents also need partner status, brand verification, and per-carrier approval. |
| Twilio group MMS | **No.** Closed to new accounts since March 15, 2022. |
| Telnyx group MMS | Possible, but caps at 8 recipients and converts the group to green-bubble MMS permanently. |
| **GroupMe bot** | **Chosen.** Free, unlimited, real group room, and it reads messages as well as posts them. |

**Chatter level: maximum.** The bot posts everything — turns, every pick as it
lands, line moves, results, standings, and needling.

#### What the bot posts

- **On the clock** — "@Mark you're up. 6 slots gone, 8h on the clock."
- **Every pick, immediately** — "Steve takes Alabama −7 (−110). Auburn +7 still open."
- **Line moves** on games still available — "Georgia has moved −3 → −6 since the draft opened."
- **Kickoff warnings** — slots about to die because a game is starting.
- **Live results** as games go final, then a weekly recap with standings and money.
- **Needling** — season-long records, "Ryan is 0-for-his-last-6 favorites," etc.

#### Picking by message

Because GroupMe bots receive a callback on every group message, picks can be
made **in the chat** rather than in the app. Proposed flow:

1. Bot posts the numbered board when your turn opens.
2. You reply with a slot number (`7`) or plain text (`bama -7`).
3. Bot fetches the live line, writes the pick, and confirms — "Locked: Alabama
   −7 at −110."

The app stays the source of truth and the place to browse the full board; the
chat is the fast path.

**Open — needs your call:**

- **Ambiguous text.** `bama -7` is easy; `take the over` is not. Should the bot
  ask for confirmation when unsure, or only ever accept slot numbers?
- **Undo window.** Offer a 60-second `UNDO` after a pick? It's friendlier, but
  it means the frozen line isn't truly frozen until the window closes, and it
  delays the next drafter.
- **Off-turn picks.** If someone posts a pick when it isn't their turn, does the
  bot ignore it, queue it, or roast them?

#### Build notes

- Bot is created free at `dev.groupme.com/bots/new` and bound to one group.
- The callback URL is an API route in our own app.
- **Gotcha:** the callback fires on the bot's *own* messages too. It must check
  the sender and ignore itself, or it will talk to itself forever.

### 4. Who can create the week?

Recommended: **you're the commissioner.** You press a button to open each
week's draft, which also snapshots the slate. Everyone else just picks.

### ~~5. Roster~~ — RESOLVED

**Luke, Ryan, Nick, Mark, Steve, Scott.** Luke is back after sitting out 25-26.

### ~~6. The "25-26 (2)" tab~~ — RESOLVED

Scratch copy — Scott's wife picked a game for fun. Ignored entirely. "Maggie" is
not a player and does not appear in the imported history.

---

## A bug in the current spreadsheet

Worth stating plainly, because it is live right now and it costs real money.

On the **"25-26 (2)"** tab, each player's payout formula looks like:

```
=D24*40-E24*40+(G24+I24+K24+M24)*10-(F24+H24+J24+L24)*10
```

That `40` is `$10 × 4 opponents` — **hardcoded for a five-player league**. When
Maggie became the sixth player:

1. Every other player's multiplier should have become `50`, not `40`.
2. No player's formula references Maggie's columns (N/O) at all, so her results
   don't affect anyone's payout.
3. Maggie's own payout is a **typed-in `40`**, not a formula.
4. The weekly totals in columns Q/R exclude her columns too.

The sheet doesn't error — it just quietly returns wrong numbers. A database
with a real player table and a computed payout makes this class of bug
structurally impossible, which is a better reason to build the app than any
feature on the list.

---

## Technical plan

### Stack

| Layer | Choice | Why |
|---|---|---|
| App framework | Next.js | Most documentation and examples of any option, and it handles both the pages and the server logic in one project |
| Database + auth | Supabase | Postgres with magic-link email login built in; nobody has to remember a password |
| Hosting | Vercel | Made by the Next.js team, deploys straight from GitHub, free at our size |
| Odds data | The Odds API | 500 free credits/month, spreads refresh every 60 seconds |
| Scores data | CollegeFootballData | Free tier, 1,000 calls/month, plenty for grading once a week |
| Notifications | Resend | Free email tier, for "you're on the clock" messages |

Everything above has a free tier that comfortably covers six people.

### API budget

The Odds API charges 1 credit per market per region per call, and one call
returns every game at once. Our usage:

- **12 credits/week** — one fresh pull at the moment of each pick, so the
  frozen line is accurate to the second.
- **~15 credits/week** — background refresh of the browsable board every few
  minutes while a draft is actually open.

That's roughly **110 credits/month** against a 500 free allowance. Comfortable,
with headroom for a re-draft or a mistake.

### The core data model

Seven tables, roughly:

- `players` — the six of you, with an **active-per-season** flag (the roster
  changes: Luke left after 24-25, Nick joined, Maggie joined mid-25-26). This is
  exactly what broke the spreadsheet, so the schema handles it from day one.
- `weeks` — week number, draft open time, status
- `draft_order` — which player picks in which position, per week
- `games` — the slate for a week, with kickoff times
- `picks` — who claimed what, the frozen line, and the timestamp
- `results` — final scores and graded outcomes
- `standings` — computed, not stored

The critical piece is a **uniqueness constraint** on (week, game, slot). That's
one line of database configuration that makes it structurally impossible for
two people to claim the same side, even if they both hit submit at the same
instant. Enforcing that in the database rather than in the app is the
difference between a pool that works and a pool that has an argument in Week 4.

**Status: built and verified.** See `schema.sql`. It was loaded into a real
Postgres instance and tested:

| Test | Result |
|---|---|
| Schema loads clean | pass |
| Week 1 order is Luke Ryan Nick Mark Steve Scott | pass |
| Rotation produces the right order in Wks 2, 3, 7 | pass |
| Both rounds use the same order (12 turns) | pass |
| Opposite side of a claimed game is still available | pass |
| Re-claiming a taken slot is rejected by the database | pass |
| Over/under still free on a game whose spread is taken | pass |
| `next_drafter()` returns the correct player mid-draft | pass |
| Payout view reproduces all 20 historical payouts | **exact match** |
| Every season sums to $0 | pass |

---

## Timeline

Today is **Aug 17**. Week 0 kicks off **Aug 27**; Week 1 is **Sept 3–5**.

| When | What |
|---|---|
| This week | Accounts created, database built, draft engine working |
| ~Aug 24 | Full mock draft with fake picks to shake out bugs |
| Aug 27 | Week 0 live, or punt to Week 1 if we need the extra week |
| Sept 3 | Week 1 live for certain |

Week 0 is a thin slate anyway, so it's a low-stakes test run. Missing it costs
nothing. **Week 1 is the real target.**

---

## What you need to do before I can deploy anything

These require your email and your credit-card-free signups — I can't do them
for you:

1. **GitHub** account — github.com. Where the code lives.
2. **Supabase** account — supabase.com. Sign in with GitHub, create a project.
3. **Vercel** account — vercel.com. Sign in with GitHub.
4. **The Odds API** key — the-odds-api.com, free tier.
5. **CollegeFootballData** key — collegefootballdata.com/key, free tier.

Do those and send me the project names. Never paste the actual secret keys into
a chat — they go into Vercel's environment variables settings, and I'll show
you exactly where.
