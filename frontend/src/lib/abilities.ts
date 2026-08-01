/*
The one arithmetic every other rule is built on.

This lived in components/ui/AbilityRow.tsx, which meant lib/derive.ts and
lib/sheet/values.ts — the two rule modules — imported it *from a React
component*. That is backwards, and it also put the most-reused rule in the app
somewhere a node test cannot reach without dragging React along.

It is mirrored in Go (backend/internal/http/forge.go), and the two are held
together by fixtures/rules/ability-mods.json.
*/

/**
 * The 2024 ability modifier: floor((score − 10) / 2).
 *
 * The floor matters and is the reason this is pinned by a fixture. Go's `/` on
 * ints truncates toward zero, so the obvious transcription gives 0 for a score
 * of 9 where the rules — and this line — give −1. Every odd score below 10 is
 * wrong in a way that reads as a rounding preference rather than a bug.
 */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** The modifier as a sheet prints it, with a true minus sign rather than a hyphen. */
export function modText(score: number): string {
  const m = abilityMod(score);
  return m >= 0 ? `+${m}` : `−${Math.abs(m)}`;
}
