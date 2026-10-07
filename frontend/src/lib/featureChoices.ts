import type { FeatureChoice, RulesContent } from "../api/client";

/*
Feature choices on the client (#382): what a class feature asks the player to
pick, and what each pick may be.

The server is the authority — the sheet's `featureChoices` lists every choice a
hero has reached, made and owed, and PUT /characters/{id}/choices validates
every answer. This module only does two things the server cannot do for a
screen: preview the choices a level is ABOUT to bring (the Forge's level 1, a
level-up's next level, before the hero has them), and build the list of things
a pick may be from the libraries the page already holds.

The count rule mirrors countAt in feature_choices.go: `choose` is a number or
twenty values by class level, or `chooseTable` names a featuresTable column.
*/

interface ChoiceDecl {
  id: string;
  name?: string;
  type: FeatureChoice["type"];
  choose?: number | number[];
  chooseTable?: string;
  from?: string;
  options?: FeatureChoice["options"];
  swap?: FeatureChoice["swap"];
}

interface ChoiceSource {
  features?: Array<{ level?: number; name?: string; choice?: ChoiceDecl }>;
  featuresTable?: Array<{ name?: string; values?: string[] }>;
}

function countAt(d: ChoiceDecl, level: number, tables: ChoiceSource["featuresTable"][]): number {
  const at = Math.min(Math.max(level, 1), 20) - 1;
  if (d.chooseTable) {
    for (const table of tables) {
      const col = table?.find((c) => c.name === d.chooseTable);
      if (col) return parseInt(col.values?.[at] ?? "", 10) || 0;
    }
    return 0;
  }
  if (d.choose === undefined) return 1;
  if (typeof d.choose === "number") return d.choose;
  return d.choose[at] ?? 0;
}

/**
 * The choices one class or subclass entry asks of a hero at this level in it,
 * shaped like the sheet's own. `onlyAt` narrows to features arriving at exactly
 * that level — what a level-up brings, rather than everything reached.
 */
export function choicesOf(
  entry: RulesContent | undefined,
  level: number,
  opts: { onlyAt?: number; parent?: RulesContent } = {},
): FeatureChoice[] {
  if (!entry) return [];
  const data = entry.data as ChoiceSource;
  const parentTable = (opts.parent?.data as ChoiceSource | undefined)?.featuresTable;
  const out: FeatureChoice[] = [];
  for (const f of data.features ?? []) {
    const at = f.level ?? 1;
    const d = f.choice;
    if (!d || at > level || (opts.onlyAt !== undefined && at !== opts.onlyAt)) continue;
    const count = countAt(d, level, [data.featuresTable, parentTable]);
    if (count < 1) continue;
    out.push({
      key: `${entry.id}:${d.id}`,
      source: entry.name,
      feature: f.name ?? "",
      name: d.name ?? f.name ?? "",
      level: at,
      type: d.type,
      count,
      from: d.from,
      swap: d.swap,
      options: d.options ?? [],
      picked: [],
    });
  }
  return out;
}

/** What a level brings that grows a choice already made (Weapon Mastery 3 → 4)
 * or opens a new one — the ones a level-up should ask about. */
export function choicesGrowingAt(
  entry: RulesContent | undefined,
  level: number,
  made: FeatureChoice[],
  parent?: RulesContent,
): FeatureChoice[] {
  return choicesOf(entry, level, { parent })
    .map((c) => ({ ...c, picked: made.find((m) => m.key === c.key)?.picked ?? [] }))
    .filter((c) => c.picked.length < c.count);
}

export interface PoolEntry {
  name: string;
  summary?: string;
  /** Why it is offered but cannot be taken — already held, say. */
  disabled?: string;
}

/**
 * Everything a pick may be. `skills` are the hero's proficiencies (expertise
 * needs one), `expertise` what other choices already doubled, `feats` the
 * hero's feats (a style already held is not offered twice).
 */
export function poolFor(
  choice: FeatureChoice,
  libs: {
    feats?: RulesContent[];
    items?: RulesContent[];
    skills?: string[];
    heldFeats?: string[];
    expertise?: string[];
  },
): PoolEntry[] {
  const own: PoolEntry[] = choice.options.map((o) => ({ name: o.name, summary: o.summary }));
  switch (choice.type) {
    case "option":
      return own;
    case "feat": {
      const held = new Set((libs.heldFeats ?? []).filter((f) => !choice.picked.includes(f)));
      const feats = (libs.feats ?? [])
        .filter((f) => (f.data as { category?: string }).category === choice.from)
        .map((f) => ({
          name: f.name,
          summary: f.summary,
          disabled: held.has(f.name) ? "already taken" : undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [...feats, ...own];
    }
    case "expertise": {
      const narrowed = new Set(choice.options.map((o) => o.name));
      const elsewhere = new Set((libs.expertise ?? []).filter((s) => !choice.picked.includes(s)));
      const skills = [...(libs.skills ?? [])].sort();
      return skills
        .filter((s) => narrowed.size === 0 || narrowed.has(s))
        .map((s) => ({ name: s, disabled: elsewhere.has(s) ? "already expert" : undefined }));
    }
    case "mastery":
      return (libs.items ?? [])
        .filter((i) => {
          const d = i.data as { type?: string; rarity?: string };
          return d.type === "weapon" && !d.rarity;
        })
        .map((i) => ({ name: i.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
  }
  return own;
}

/** The weapon training a hero's picked options grant — a Protector Cleric's
 * Martial weapons — as sources weaponProficiencies reads (#379). */
export function trainingFromChoices(choices: FeatureChoice[] | undefined): Array<{ data: { weapons: string[] } }> {
  const out: Array<{ data: { weapons: string[] } }> = [];
  for (const c of choices ?? []) {
    for (const o of c.options) {
      if (c.picked.includes(o.name) && o.weapons?.length) out.push({ data: { weapons: o.weapons } });
    }
  }
  return out;
}

/** The choices still waiting on the hero. */
export function owed(choices: FeatureChoice[] | undefined): FeatureChoice[] {
  return (choices ?? []).filter((c) => c.picked.length < c.count);
}
