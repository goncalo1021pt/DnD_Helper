/**
 * Spellcasting pick tables and slot math for the UI. Mirrors the backend's
 * rules engine (backend/internal/rules/spellslots.go) — the server remains
 * the authority; these power counters and previews only.
 */

export interface Casting {
  ability: string;
  cantrips: number[]; // by character level, index 0 = level 1
  prepared: number[];
}

const wizard: Casting = {
  ability: "INT",
  cantrips: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  prepared: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 18, 19, 21, 22, 24, 25],
};
const paladin: Casting = {
  ability: "CHA",
  cantrips: new Array(20).fill(0),
  prepared: [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15],
};
const warlock: Casting = {
  ability: "CHA",
  cantrips: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  prepared: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
};
// The Eldritch Knight's table, indexed by level in the parent class; empty
// until the subclass exists at 3 (#220).
const eldritch: Casting = {
  ability: "INT",
  cantrips: [0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  prepared: [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13],
};

export function fallbackCasting(kind: string): Casting {
  if (kind === "half") return paladin;
  if (kind === "third") return eldritch;
  if (kind === "pact") return warlock;
  return wizard;
}

/**
 * When a caster may trade one spell for another. Mirrors the backend's
 * spellChangeRule (backend/internal/http/spells.go) — the server decides what
 * is legal; this only decides what the sheet offers.
 */
export interface SpellChangeRule {
  when: "long-rest" | "level-up";
  count: number | "any";
}

export interface SpellChanges {
  prepared?: SpellChangeRule;
  cantrips?: SpellChangeRule;
}

/** Unlimited, as returned by swapAllowance for a "re-prepare freely" rule. */
export const ANY_SWAPS = -1;

/** The content-data slice the UI reads for casting — off a class, or off a
 * subclass when the casting rides there (#220). spellListClass names another
 * class whose whole spell list this caster reads, which is how an Eldritch
 * Knight — a Fighter — casts Wizard spells. */
export interface CasterData {
  spellcaster?: string;
  spellcasting?: Partial<Casting>;
  spellList?: string[];
  spellListClass?: string;
  spellChanges?: SpellChanges;
}

/** The name + data slice the casting checks need — any RulesContent fits. */
export interface CasterSource {
  name: string;
  data: unknown;
}

/**
 * The entry a hero-class's casting is declared on: the class itself when it
 * sets data.spellcaster, else the given subclass when that does — an Eldritch
 * Knight is a Fighter whose casting rides on the subclass (#220). The result
 * keeps the CLASS's name (spell lists and error copy are class-shaped) with
 * the subclass's data. Undefined when neither casts.
 */
export function casterSourceFor(
  klass: CasterSource | undefined,
  subclass: { data: unknown } | undefined,
): CasterSource | undefined {
  if ((klass?.data as CasterData | undefined)?.spellcaster) return klass;
  if (klass && subclass && (subclass.data as CasterData | undefined)?.spellcaster)
    return { name: klass.name, data: subclass.data };
  return undefined;
}

/**
 * A caster whose data predates the field re-prepares freely on a Long Rest —
 * the commonest 2024 shape, and the same fallback the server applies, so an
 * imported pack's Artificer still works.
 */
export function spellChangesFor(data: CasterData | undefined): SpellChanges {
  if (!data?.spellcaster) return {};
  return data.spellChanges ?? { prepared: { when: "long-rest", count: "any" } };
}

/** How many swaps a rule permits on a trigger. 0 = none, ANY_SWAPS = unlimited. */
export function swapAllowance(
  rule: SpellChangeRule | undefined,
  trigger: "long-rest" | "level-up",
): number {
  if (!rule || rule.when !== trigger) return 0;
  if (rule.count === "any") return ANY_SWAPS;
  return typeof rule.count === "number" ? rule.count : 0;
}

/**
 * True when a spell belongs to a caster: named in the spell's classes array —
 * under the class's name, or the class whose whole list the caster reads
 * (data.spellListClass, #220) — or claimed by the caster's own data.spellList,
 * how homebrew classes (e.g. the Artificer) adopt spells that don't know
 * about them. Mirrors the backend's spellOnList.
 */
export function spellOnClassList(
  spell: { name: string; data: unknown },
  klass: CasterSource | undefined,
): boolean {
  if (!klass) return false;
  const data = klass.data as CasterData;
  const classes = (spell.data as { classes?: string[] }).classes ?? [];
  const names = [klass.name, data.spellListClass ?? ""].filter(Boolean);
  if (classes.some((c) => names.some((n) => n.toLowerCase() === c.toLowerCase()))) return true;
  const list = data.spellList ?? [];
  return list.some((n) => n.toLowerCase() === spell.name.toLowerCase());
}

export function castingFor(data: CasterData | undefined): Casting | null {
  if (!data?.spellcaster) return null;
  const fb = fallbackCasting(data.spellcaster);
  return {
    ability: data.spellcasting?.ability ?? fb.ability,
    cantrips: data.spellcasting?.cantrips ?? fb.cantrips,
    prepared: data.spellcasting?.prepared ?? fb.prepared,
  };
}

/** Highest spell level with a slot at a character level (matches the Go tables). */
export function maxSpellLevel(kind: string, level: number): number {
  const l = Math.min(Math.max(level, 1), 20);
  if (kind === "pact") return [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5][l - 1];
  if (kind === "half") return Math.min(Math.ceil(l / 4), 5);
  // A third-caster's own table is the full-caster's read at ceil(l / 3), and
  // empty before the subclass exists at level 3 (#220).
  if (kind === "third") return l < 3 ? 0 : Math.ceil(Math.ceil(l / 3) / 2);
  return Math.min(Math.ceil(l / 2), 9);
}
