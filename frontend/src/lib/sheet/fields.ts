/**
 * The shape of the official 2024 character sheet, as far as the exporter
 * cares about it.
 *
 * These are the constants the layout and the value builder agree on: which
 * abilities exist, which skills sit under each of them, and how many rows the
 * sheet gives weapons and spells. The layout turns them into positions and the
 * value builder turns a hero into strings; the two meet on the field ids
 * spelled out here.
 *
 * Nothing here reproduces the sheet — it only describes the shape of one.
 */

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = (typeof ABILITIES)[number];

export const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

/**
 * The eighteen skills, filed under the ability that governs them and in the
 * order the sheet prints them — Strength's one, Dexterity's three, and so on
 * down the two columns.
 */
export const SKILLS_BY_ABILITY: Record<AbilityKey, string[]> = {
  str: ["Athletics"],
  dex: ["Acrobatics", "Sleight of Hand", "Stealth"],
  con: [],
  int: ["Arcana", "History", "Investigation", "Nature", "Religion"],
  wis: ["Animal Handling", "Insight", "Medicine", "Perception", "Survival"],
  cha: ["Deception", "Intimidation", "Performance", "Persuasion"],
};

export const SKILLS: Array<{ name: string; ability: AbilityKey }> = ABILITIES.flatMap((a) =>
  SKILLS_BY_ABILITY[a].map((name) => ({ name, ability: a })),
);

/** Rows on the sheet's Weapons & Damage Cantrips table. */
export const ATTACK_ROWS = 6;

/** Rows in the Cantrips & Prepared Spells table. */
export const SPELL_ROWS = 30;

/** A stable key for a skill's boxes: "Sleight of Hand" -> "sleightOfHand". */
export function skillKey(name: string): string {
  const [first, ...rest] = name.split(/[^A-Za-z]+/).filter(Boolean);
  return first.toLowerCase() + rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

/**
 * Every value the exporter can print, keyed by field id. A string is written
 * as text; `true` ticks the box it names.
 */
export type SheetValues = Record<string, string | boolean | undefined>;
