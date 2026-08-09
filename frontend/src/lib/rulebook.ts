import type { RulesContent } from "../api/client";

/*
The Rulebook's lookup half (#199). A keyword on a card — "Versatile" on a
weapon, a "Grappled" chip in the tracker — resolves to the rule entry it
names, so the popover can open the actual text instead of sending a player
to the shelf. Matching is by name, forgiving only the forms the app itself
produces: chip case, and the two spellings below.
*/

/** Tracker vocabulary that differs from the book's entry name. */
const ALIAS: Record<string, string> = {
  concentrating: "concentration",
};

/**
 * The rule-entry name a chip or property tag should open. "Exhaustion 3"
 * sheds its level; "Concentrating" maps to the Concentration entry.
 */
export function ruleTermFor(label: string): string {
  const bare = label
    .replace(/\s+\d+$/, "")
    .trim()
    .toLowerCase();
  return ALIAS[bare] ?? bare;
}

/** Rule entries by lowercase name, for O(1) chip lookups. */
export function indexRules(entries: RulesContent[] | undefined): Map<string, RulesContent> {
  const map = new Map<string, RulesContent>();
  for (const e of entries ?? []) {
    map.set(e.name.toLowerCase(), e);
  }
  return map;
}
