/** Shared display formatting. Small, but used by more than one page now
 * (Results and History both show dollar amounts the same way). */

/** "+$160" / "−$470" — the sign is a real minus (−), not a hyphen. */
export function money(v: number): string {
  return `${v < 0 ? "−" : "+"}$${Math.abs(Math.round(v)).toLocaleString()}`;
}

/** "52.4%" from a win/loss pair, or "—" when nobody's played yet. */
export function winPct(w: number, l: number): string {
  return w + l ? `${((w / (w + l)) * 100).toFixed(1)}%` : "—";
}
