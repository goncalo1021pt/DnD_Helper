import type { RulesContent } from "../api/client";

/**
 * Shared monster-filtering vocabulary — the Den's browser and the encounter
 * builder both slice the same menagerie, so the bands, types, and labels live
 * here rather than being copied into each page.
 */

/** CR filter bands (label + predicate over the numeric CR). */
export const CR_BANDS: Array<[string, (v: number) => boolean]> = [
  ["Any CR", () => true],
  ["CR 0–1", (v) => v <= 1],
  ["CR 2–4", (v) => v >= 2 && v <= 4],
  ["CR 5–10", (v) => v >= 5 && v <= 10],
  ["CR 11–16", (v) => v >= 11 && v <= 16],
  ["CR 17+", (v) => v >= 17],
];

/** The 14 creature types of the 2024 rules, for the type filter. */
export const BASE_TYPES = [
  "Aberration", "Beast", "Celestial", "Construct", "Dragon", "Elemental",
  "Fey", "Fiend", "Giant", "Humanoid", "Monstrosity", "Ooze", "Plant",
  "Undead",
];

/** "Swarm of Tiny Beasts" → Beast, "Fiend (Demon)" → Fiend, "Swarm of Tiny
 * Monstrosities" → Monstrosity (y→ies plural). */
export function baseTypeOf(type: string): string {
  for (const t of BASE_TYPES) {
    const plural = t.endsWith("y") ? t.slice(0, -1) + "ies" : t + "s";
    if (type.includes(t) || type.includes(plural)) return t;
  }
  return type;
}

/** A monster's numeric CR for sorting/filtering (0 if unknown). */
export function crValueOf(m: RulesContent): number {
  return (m.data as { crValue?: number }).crValue ?? 0;
}

/**
 * The numeric CR behind a written one — 0.25 out of "1/4 (XP 50; PB +2)".
 *
 * `cr` is prose and `crValue` is what the Den sorts and filters on, what the CR
 * band picker reads, and what the difficulty meter falls back to when a
 * creature states no XP. A homebrew monster whose written CR says 5 while its
 * crValue still says 0.25 sorts among the rats and weighs a fight as 50 XP, so
 * anything editing one has to derive the other rather than trust a DM to keep
 * two fields in step.
 */
export function crValueOfLabel(cr: string): number {
  const head = (cr ?? "").trim().split(/\s+/)[0] ?? "";
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(head);
  if (fraction) {
    const bottom = Number(fraction[2]);
    return bottom === 0 ? 0 : Number(fraction[1]) / bottom;
  }
  const n = Number(head);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** The short CR label — "1/4" out of "1/4 (XP 50, PB +2)". */
export function crLabel(m: RulesContent): string {
  const cr = (m.data as { cr?: string }).cr;
  return cr && cr.trim() ? cr.split(" ")[0] : "?";
}

export type MonsterSort = "cr-asc" | "cr-desc" | "name";

export const MONSTER_SORTS: Array<[MonsterSort, string]> = [
  ["cr-asc", "CR: low → high"],
  ["cr-desc", "CR: high → low"],
  ["name", "Name: A → Z"],
];
