/**
 * The archive. Four seasons before this app existed, when the whole
 * operation ran on Ryan's spreadsheet.
 *
 * This table is the same fixture db/test.sql uses to prove the payout
 * formula reproduces the old spreadsheet exactly (see "TEST 7" there) —
 * it's real history, just at season grain. Nobody logged individual games
 * back then, so that's the finest detail available: each player's
 * win/loss record and net dollars for each season they played.
 *
 * Shared by the History page and the Weekend Preview generator (which
 * uses `mostRecentSeasonFor` for "last season" flavor on a new season's
 * very first week, when there's no prior period yet to look back at).
 */
export type LegacyRow = { season: string; name: string; w: number; l: number; net: number };

export const HISTORY: LegacyRow[] = [
  { season: "22-23", name: "Luke", w: 11, l: 17, net: -140 },
  { season: "22-23", name: "Ryan", w: 14, l: 14, net: 160 },
  { season: "22-23", name: "Mark", w: 13, l: 16, net: 10 },
  { season: "22-23", name: "Steve", w: 13, l: 15, net: 60 },
  { season: "22-23", name: "Scott", w: 12, l: 17, net: -90 },

  { season: "23-24", name: "Luke", w: 15, l: 13, net: 180 },
  { season: "23-24", name: "Ryan", w: 9, l: 19, net: -420 },
  { season: "23-24", name: "Mark", w: 11, l: 18, net: -270 },
  { season: "23-24", name: "Steve", w: 18, l: 11, net: 430 },
  { season: "23-24", name: "Scott", w: 14, l: 14, net: 80 },

  { season: "24-25", name: "Luke", w: 13, l: 20, net: -270 },
  { season: "24-25", name: "Ryan", w: 17, l: 16, net: 130 },
  { season: "24-25", name: "Mark", w: 15, l: 17, net: -20 },
  { season: "24-25", name: "Steve", w: 16, l: 17, net: 30 },
  { season: "24-25", name: "Scott", w: 17, l: 16, net: 130 },

  { season: "25-26", name: "Nick", w: 16, l: 18, net: 160 },
  { season: "25-26", name: "Ryan", w: 11, l: 23, net: -340 },
  { season: "25-26", name: "Mark", w: 13, l: 20, net: -90 },
  { season: "25-26", name: "Steve", w: 18, l: 16, net: 360 },
  { season: "25-26", name: "Scott", w: 13, l: 20, net: -90 },
];

export const LEGACY_SEASONS = [...new Set(HISTORY.map((r) => r.season))].sort();

export type Career = {
  name: string;
  seasons: number;
  w: number;
  l: number;
  net: number;
  perSeason: number;
  spread: number; // this player's best season win% minus their worst
};

export function careerTotals(): Career[] {
  const byName = new Map<string, LegacyRow[]>();
  for (const r of HISTORY) {
    byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  }
  return [...byName.entries()].map(([name, rows]) => {
    const w = rows.reduce((s, r) => s + r.w, 0);
    const l = rows.reduce((s, r) => s + r.l, 0);
    const net = rows.reduce((s, r) => s + r.net, 0);
    const pcts = rows.map((r) => (r.w / (r.w + r.l)) * 100);
    return {
      name,
      seasons: rows.length,
      w,
      l,
      net,
      perSeason: net / rows.length,
      spread: Math.max(...pcts) - Math.min(...pcts),
    };
  });
}

/** A player's most recent archived season, e.g. for "last season Luke went
 * 13-20" flavor when there's no prior PERIOD yet to look back at (the
 * season's first week). Seasons sort correctly as plain strings here
 * ("22-23" < "23-24" < ...). Returns null for a player with no archived
 * history at all (nobody currently in the roster, but a safe fallback). */
export function mostRecentSeasonFor(name: string): LegacyRow | null {
  const rows = HISTORY.filter((r) => r.name === name).sort((a, b) =>
    a.season < b.season ? -1 : a.season > b.season ? 1 : 0
  );
  return rows.length ? rows[rows.length - 1] : null;
}
