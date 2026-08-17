/**
 * The write path. Everything that changes a pick goes through here.
 *
 * There are no logins in v1, so PICK_PASSPHRASE is the entire security model.
 * It's checked on every method. Don't add a route that skips it.
 *
 * Note what this route does NOT do: it never checks whether a slot is free
 * before writing. The database's unique constraint decides, and we translate
 * its error into English. Checking first would leave a race between the check
 * and the insert.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

function authed(body: any) {
  const expected = process.env.PICK_PASSPHRASE;
  if (!expected) return "PICK_PASSPHRASE isn't set on the server.";
  if (body?.passphrase !== expected) return "Wrong passphrase.";
  return null;
}

/** Turn a Postgres error into something a person can act on. */
function explain(e: { code?: string; message?: string } | null): string {
  if (!e) return "Unknown error";
  if (e.code === "23505") {
    if (e.message?.includes("slot_taken_once"))
      return "Someone already has that side. Refresh to see who.";
    if (e.message?.includes("one_pick_per_slot"))
      return "That draft slot number is already used this week.";
    return "That's already taken.";
  }
  if (e.code === "23514") return "That combination isn't a valid bet.";
  return e.message ?? "Database error";
}

export async function POST(req: Request) {
  const body = await req.json();
  const err = authed(body);
  if (err) return bad(err, 401);

  const { period_id, game_id, market, side, player_id, line } = body;
  if (!period_id || !game_id || !market || !side || !player_id)
    return bad("Missing fields.");
  if (!Number.isFinite(Number(line))) return bad("Line must be a number.");

  // Refuse a pick on a game that has already started.
  const { data: game } = await db()
    .from("games").select("kickoff,status").eq("id", game_id).single();
  if (!game) return bad("Game not found.");
  if (new Date(game.kickoff) <= new Date() || game.status !== "scheduled")
    return bad("That game has already kicked off.");

  const { error } = await db().from("picks").insert({
    period_id, game_id, market, side, player_id,
    line: Number(line),
    line_source: "manual", // Ryan typed it, even if it matched the live number
  });
  if (error) return bad(explain(error), error.code === "23505" ? 409 : 400);

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const err = authed(body);
  if (err) return bad(err, 401);

  const { pick_id, game_id, market, side, player_id, line } = body;
  if (!pick_id) return bad("Missing pick_id.");
  if (!Number.isFinite(Number(line))) return bad("Line must be a number.");

  // The audit trigger logs this automatically — nothing to do here.
  const { error } = await db()
    .from("picks")
    .update({
      game_id, market, side, player_id,
      line: Number(line),
      line_source: "manual",
    })
    .eq("id", pick_id);

  if (error) return bad(explain(error), error.code === "23505" ? 409 : 400);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = await req.json();
  const err = authed(body);
  if (err) return bad(err, 401);
  if (!body.pick_id) return bad("Missing pick_id.");

  const { error } = await db().from("picks").delete().eq("id", body.pick_id);
  if (error) return bad(explain(error));
  return NextResponse.json({ ok: true });
}
