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
  /** Feats that must be picked alongside it (Pact of the Blade before
   * Thirsting Blade) when the hero does not hold them yet (#384). */
  needs?: string[];
  /** May be taken more than once (Agonizing Blast, a cantrip at a time). */
  repeatable?: boolean;
  /** The prerequisite as written, for what the app does not judge. */
  prerequisite?: string;
}

/*
A feat's prerequisite (#384), mirroring feat_prereqs.go and held to it by
fixtures/rules/feat-prerequisites.json. "Level N+ <Class>" is the level in that
class ("Level N+" alone, the total); "<Name> Invocation" is a feat held or
picked alongside. Anything else is shown and not judged.
*/
export function parsePrereq(text: string | undefined): { cls: string; level: number; feats: string[] } {
  const out = { cls: "", level: 0, feats: [] as string[] };
  for (const raw of (text ?? "").split(",")) {
    const part = raw.trim();
    const lvl = part.match(/^level\s+(\d+)\+(?:\s+(.+))?$/i);
    if (lvl) {
      out.level = Number(lvl[1]);
      out.cls = (lvl[2] ?? "").trim();
      continue;
    }
    const feat = part.match(/^(.+?)\s+invocation$/i);
    if (feat) out.feats.push(feat[1].trim());
  }
  return out;
}

export function prereqUnmet(
  text: string | undefined,
  levels: Record<string, number>,
  total: number,
  has: (feat: string) => boolean,
): string {
  const p = parsePrereq(text);
  if (p.level > 0) {
    const at = p.cls ? (levels[p.cls.toLowerCase()] ?? 0) : total;
    if (at < p.level) return p.cls ? `needs ${p.cls} level ${p.level}` : `needs level ${p.level}`;
  }
  for (const f of p.feats) if (!has(f)) return `needs ${f}`;
  return "";
}

/** A hero's levels by lowercased class name, what a prerequisite reads. */
export function levelsByClass(classes: Array<{ className: string; level: number }> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of classes ?? []) out[k.className.toLowerCase()] = k.level;
  return out;
}

/** The feats other feature choices have picked — taken, where a feat on the
 * sheet no choice claims (an invocation taken at an ASI before) is free to be
 * adopted by this one. */
export function claimedElsewhere(choices: FeatureChoice[] | undefined, key: string): string[] {
  return (choices ?? []).filter((c) => c.key !== key && c.type === "feat").flatMap((c) => c.picked);
}

/**
 * Everything a pick may be. `skills` are the hero's proficiencies (expertise
 * needs one), `expertise` what other choices already doubled, `claimed` the
 * feats other choices hold (a style already taken is not offered twice).
 * For a feat, `levels` (by lowercased class) and `total` read its
 * prerequisite, and `owned` are the hero's feats that satisfy one.
 */
export function poolFor(
  choice: FeatureChoice,
  libs: {
    feats?: RulesContent[];
    items?: RulesContent[];
    skills?: string[];
    claimed?: string[];
    expertise?: string[];
    levels?: Record<string, number>;
    total?: number;
    owned?: string[];
  },
): PoolEntry[] {
  const own: PoolEntry[] = choice.options.map((o) => ({ name: o.name, summary: o.summary }));
  switch (choice.type) {
    case "option":
      return own;
    case "feat": {
      const claimed = new Set(libs.claimed ?? []);
      const owned = new Set(libs.owned ?? []);
      const feats = (libs.feats ?? [])
        .filter((f) => (f.data as { category?: string }).category === choice.from)
        .map((f) => {
          const d = f.data as { prerequisite?: string; repeatable?: boolean };
          // The level is read now; a needed invocation may still be picked
          // alongside, so it travels to the picker rather than blocking here.
          const short = libs.levels
            ? prereqUnmet(d.prerequisite, libs.levels, libs.total ?? 0, () => true)
            : "";
          const needs = parsePrereq(d.prerequisite).feats.filter((n) => !owned.has(n));
          return {
            name: f.name,
            summary: f.summary,
            prerequisite: d.prerequisite,
            repeatable: !!d.repeatable,
            needs: needs.length ? needs : undefined,
            disabled: claimed.has(f.name) && !d.repeatable ? "already taken" : short || undefined,
          };
        })
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
