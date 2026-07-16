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

export function fallbackCasting(kind: string): Casting {
  if (kind === "half") return paladin;
  if (kind === "pact") return warlock;
  return wizard;
}

/** The class-data slice the UI reads for casting. */
export interface CasterData {
  spellcaster?: string;
  spellcasting?: Partial<Casting>;
  spellList?: string[];
}

/**
 * True when a spell belongs to a class: named in the spell's classes array,
 * or claimed by the class's own data.spellList — how homebrew classes (e.g.
 * the Artificer) adopt spells that don't know about them. Mirrors the
 * backend's validateSpellPicks.
 */
export function spellOnClassList(
  spell: { name: string; data: unknown },
  klass: { name: string; data: unknown } | undefined,
): boolean {
  if (!klass) return false;
  const classes = (spell.data as { classes?: string[] }).classes ?? [];
  if (classes.some((c) => c.toLowerCase() === klass.name.toLowerCase())) return true;
  const list = (klass.data as CasterData).spellList ?? [];
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
  return Math.min(Math.ceil(l / 2), 9);
}
