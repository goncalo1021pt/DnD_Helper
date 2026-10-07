import type { AbilityScores, InventoryItem } from "../api/client";
import { abilityMod } from "./abilities";

/** Proficiency bonus by character level (2024: +2 at 1, +6 at 17). */
export function profBonus(level: number): number {
  return 2 + Math.floor((Math.min(Math.max(level, 1), 20) - 1) / 4);
}

interface ArmorData {
  type?: string;
  category?: string;
  ac?: number;
  acBonus?: number;
  bonus?: number;
  attunement?: boolean;
  wear?: string;
}

/** The +N an item actually contributes: its declared bonus, gated behind
 * attunement when the item demands it. An unattuned Frost Brand is a
 * well-made sword and nothing more. Mirrors effectiveBonus in armor.go. */
function effBonus(d: { bonus?: number; attunement?: boolean }, attuned: boolean): number {
  if (typeof d.bonus !== "number" || (d.attunement && !attuned)) return 0;
  return d.bonus;
}

/**
 * A feature that replaces the unarmoured base AC formula.
 *
 * Barbarian's Unarmored Defense is `10 + DEX + CON`, Monk's is `10 + DEX + WIS`,
 * Draconic Sorcery's scales are `10 + DEX + CHA` — three different answers to
 * the same sentence, so the sentence is the thing to declare rather than the
 * classes. `abilities` are the modifiers summed onto `base`; `shield: false`
 * means the benefit is lost the moment a Shield is taken up (the Monk's is; the
 * Barbarian's explicitly is not).
 *
 * Declarative on purpose: it is a field a homebrew class or a pack can ship
 * (content packs are additive), not a list of class names in this file.
 */
export interface UnarmoredDefense {
  base?: number;
  abilities?: string[];
  shield?: boolean;
}

/**
 * The Monk's Martial Arts (#379), as a sentence content can say: `table` names
 * the column of the class's featuresTable that holds the die, and featuresOf
 * resolves it into `die` at the hero's level in that class. A pack's own
 * unarmed fighter declares the same thing and fights the same way.
 */
export interface MartialArts {
  table?: string;
  die?: string;
}

/**
 * A flat bonus to some weapons' attacks or damage — a Fighting Style feat's
 * whole mechanic, declared on the feat: Archery is `{ranged, attack: 2}`,
 * Dueling `{melee, oneHanded, damage: 2}`. Every filter given must hold.
 */
export interface WeaponBonus {
  ranged?: boolean;
  melee?: boolean;
  oneHanded?: boolean;
  attack?: number;
  damage?: number;
}

export interface Feature {
  level?: number;
  name?: string;
  summary?: string;
  unarmoredDefense?: UnarmoredDefense;
  martialArts?: MartialArts;
  /** +N AC while wearing armor — the Defense fighting style. */
  armoredAC?: number;
  weaponBonus?: WeaponBonus;
}

interface FeatureTableColumn {
  name?: string;
  values?: string[];
}

/** The features one content entry grants a hero who has reached this level. */
export function featuresOf(source: { data?: unknown } | undefined, level: number): Feature[] {
  const data = source?.data as
    | { features?: Feature[]; traits?: Feature[]; featuresTable?: FeatureTableColumn[] }
    | undefined;
  // Classes and backgrounds call them features; a species calls them traits.
  return [...(data?.features ?? []), ...(data?.traits ?? [])]
    .filter((f) => (f.level ?? 1) <= level)
    .map((f) => {
      const table = f.martialArts?.table;
      if (!table) return f;
      // The die is read at the level in THIS class — the caller passes it.
      const column = data?.featuresTable?.find((c) => c.name === table);
      const die = column?.values?.[Math.min(Math.max(level, 1), 20) - 1];
      return { ...f, martialArts: { ...f.martialArts, die } };
    });
}

/** A taken feat as a sheet feature: its words, and whatever it declares that
 * changes a number — Defense's AC, Archery's aim. */
export function featAsFeature(
  name: string,
  entry: { summary?: string; data?: unknown } | undefined,
  from = "Feat",
): Feature & { from: string } {
  const d = (entry?.data ?? {}) as {
    description?: string;
    armoredAC?: number;
    weaponBonus?: WeaponBonus;
  };
  return {
    name,
    summary: d.description ?? entry?.summary,
    from,
    armoredAC: d.armoredAC,
    weaponBonus: d.weaponBonus,
  };
}

/** AC from equipped armor + shield: Light = ac+DEX, Medium = ac+min(DEX,2),
 * Heavy = ac flat; unarmored = 10+DEX. Shield adds its bonus on top.
 *
 * `features` are the hero's earned features — any that declare an
 * `unarmoredDefense` replace the unarmoured base when it is better and nothing
 * is worn. Without them a raging Barbarian reads as a commoner in a shirt,
 * which is the quiet kind of wrong: a hit lands that should have missed and
 * nobody at the table ever finds out (#132). */
export function acFromEquipment(
  items: InventoryItem[],
  abilities: AbilityScores,
  features: Feature[] = [],
): number {
  const mod = (key: string) =>
    abilityMod((abilities as unknown as Record<string, number>)[key.toLowerCase()] ?? 10);
  const dex = mod("dex");
  let ac = 10 + dex;
  let armored = false;
  let shield = 0;
  let worn = 0;
  for (const it of items) {
    if (!it.equipped || !it.content) continue;
    const d = it.content.data as ArmorData;
    const eff = effBonus(d, it.attuned);
    if (d.type === "armor" && typeof d.ac === "number") {
      armored = true;
      if (d.category === "Light") ac = d.ac + dex;
      else if (d.category === "Medium") ac = d.ac + Math.min(dex, 2);
      else ac = d.ac;
      ac += eff;
    } else if (d.type === "shield") {
      shield = (d.acBonus ?? 2) + eff;
    } else if (d.type === "gear" && d.wear) {
      // A Ring or Cloak of Protection: worn, stacking on anything — its
      // bonus is to the wearer, not to a suit of armor.
      worn += eff;
    }
  }
  if (!armored) {
    for (const f of features) {
      const ud = f.unarmoredDefense;
      if (!ud?.abilities?.length) continue;
      // A Monk with a Shield is just a Monk in a shirt.
      if (shield > 0 && ud.shield === false) continue;
      const base = (ud.base ?? 10) + ud.abilities.reduce((sum, a) => sum + mod(a), 0);
      // Better, never worse: a feature is a benefit, not a cap.
      if (base > ac) ac = base;
    }
  } else {
    // The Defense fighting style: a better use of the armour, so only in it.
    for (const f of features) ac += f.armoredAC ?? 0;
  }
  return ac + shield + worn;
}

interface WeaponData {
  type?: string;
  category?: string; // Simple | Martial
  damage?: string;
  damage2?: string; // the Versatile two-handed die
  damageType?: string;
  properties?: string[];
  ranged?: boolean;
  bonus?: number;
  attunement?: boolean;
}

export interface WeaponAttack {
  name: string;
  bonus: number;
  damage: string;
  damageType: string;
}

/**
 * The weapon proficiencies a hero holds, as the lines content writes them
 * (#379): the starting class's `weapons` in full, the multiclass grants of
 * every other class (PHB 2024, p.44 — a second class does not hand over its
 * whole kit), and any `weapons` list another source declares. Undefined when
 * no class is known at all, which proficientWith reads as "assume proficient":
 * a quick-add with no sheet should not lose its bonus to a missing row.
 */
export function weaponProficiencies(
  starting: { data?: unknown } | undefined,
  others: Array<{ data?: unknown } | undefined>,
  extra: Array<{ data?: unknown } | undefined> = [],
): string[] | undefined {
  if (!starting && others.every((o) => !o)) return undefined;
  const weaponsOf = (src: { data?: unknown } | undefined) =>
    ((src?.data as { weapons?: string[] } | undefined)?.weapons ?? []);
  const out = [...weaponsOf(starting), ...extra.flatMap(weaponsOf)];
  for (const o of others) {
    const mc = (o?.data as { multiclass?: { proficiencies?: string[] } } | undefined)?.multiclass;
    out.push(...(mc?.proficiencies ?? []));
  }
  return out;
}

/**
 * Whether a proficiency line covers this weapon. A line naming the weapon's
 * category covers it whole ("Simple", "Martial weapons") unless it narrows by
 * property in parentheses ("Martial (light)", "Martial (finesse/light)"); any
 * other line is read as a weapon's own name ("Longswords", "Hand Crossbow"),
 * which also matches its magic forms. A weapon with no category is assumed
 * known — a pack that never said cannot be held against the hero.
 */
export function proficientWith(name: string, d: WeaponData, profs: string[] | undefined): boolean {
  if (!profs) return true;
  const category = d.category?.toLowerCase();
  if (!category) return true;
  const props = (d.properties ?? []).map((p) => p.toLowerCase());
  const own = name.toLowerCase();
  for (const raw of profs) {
    const line = raw.toLowerCase().trim();
    if (!line) continue;
    if (line.startsWith(category)) {
      const narrowed = line.match(/\(([^)]*)\)/);
      if (!narrowed) return true;
      const wants = narrowed[1].split(/\s*(?:\/|,|\bor\b)\s*/).filter(Boolean);
      if (wants.some((w) => props.includes(w))) return true;
      continue;
    }
    if (line.startsWith("simple") || line.startsWith("martial")) continue;
    const named = line.replace(/s$/, "");
    if (named.length > 2 && own.includes(named)) return true;
  }
  return false;
}

/** A Monk weapon (PHB 2024): a Simple melee weapon, or a Martial melee weapon
 * with the Light property. */
function isMonkWeapon(d: WeaponData): boolean {
  if (d.ranged) return false;
  if (d.category === "Simple") return true;
  return d.category === "Martial" && (d.properties?.includes("Light") ?? false);
}

/** The average of a die expression like "1d8" — enough to tell which die is
 * bigger, which is all the Martial Arts die needs. */
function dieAverage(die: string | undefined): number {
  const m = die?.match(/^(\d+)d(\d+)$/);
  return m ? (Number(m[1]) * (Number(m[2]) + 1)) / 2 : 0;
}

export interface AttackOptions {
  /** The hero's earned features — Martial Arts and the Fighting Style feats. */
  features?: Feature[];
  /** From weaponProficiencies; absent = proficient with everything. */
  proficiencies?: string[];
}

/** Attack lines for equipped weapons: DEX for ranged/finesse (when better),
 * STR otherwise; damage shows the ability mod folded in. Proficiency is added
 * only for a weapon the hero is proficient with (#379), Martial Arts lets a
 * Monk weapon use the better of STR and DEX and roll the Martial Arts die, and
 * a fighting style's weaponBonus lands where its filters say. */
export function weaponAttacks(
  items: InventoryItem[],
  abilities: AbilityScores,
  level: number,
  { features = [], proficiencies }: AttackOptions = {},
): WeaponAttack[] {
  const prof = profBonus(level);
  const str = abilityMod(abilities.str);
  const dex = abilityMod(abilities.dex);
  const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  const out: WeaponAttack[] = [];

  const held = items.filter((it) => it.equipped && it.content);
  const dataOf = (it: InventoryItem) => (it.content?.data ?? {}) as WeaponData & { type?: string };
  const weapons = held.filter((it) => dataOf(it).type === "weapon" && dataOf(it).damage);
  const armored = held.some((it) => dataOf(it).type === "armor");
  const shielded = held.some((it) => dataOf(it).type === "shield");

  // Martial Arts holds while unarmed or wielding only Monk weapons, and never
  // in armour or behind a shield. More than one source keeps the biggest die.
  const maDie = features
    .map((f) => f.martialArts?.die)
    .filter((die): die is string => !!die)
    .sort((a, b) => dieAverage(b) - dieAverage(a))[0];
  const martialArts =
    !!maDie && !armored && !shielded && weapons.every((it) => isMonkWeapon(dataOf(it)));
  const bonuses = features.map((f) => f.weaponBonus).filter((b): b is WeaponBonus => !!b);

  for (const it of weapons) {
    const d = dataOf(it);
    const monk = martialArts && isMonkWeapon(d);
    const finesse = d.properties?.includes("Finesse") ?? false;
    const useDex = d.ranged || (finesse && dex >= str);
    const mod = monk ? Math.max(str, dex) : useDex ? dex : str;
    // A versatile weapon held in both hands rolls its bigger die.
    let die = it.slot === "bothhands" && d.damage2 ? d.damage2 : d.damage!;
    if (monk && dieAverage(maDie) > dieAverage(die)) die = maDie!;

    const twoHanded = it.slot === "bothhands" || (d.properties?.includes("Two-Handed") ?? false);
    let toHit = 0;
    let toDamage = 0;
    for (const b of bonuses) {
      if (b.ranged && !d.ranged) continue;
      if (b.melee && d.ranged) continue;
      if (b.oneHanded && (twoHanded || weapons.length > 1)) continue;
      toHit += b.attack ?? 0;
      toDamage += b.damage ?? 0;
    }

    // The magic rides in both numbers: +1 to swing, +1 to what lands.
    const magic = effBonus(d, it.attuned);
    const dmg = mod + magic + toDamage;
    const trained = proficientWith(it.name, d, proficiencies);
    out.push({
      name: it.name,
      bonus: mod + magic + toHit + (trained ? prof : 0),
      damage: dmg !== 0 ? `${die}${signed(dmg)}` : die,
      damageType: d.damageType ?? "",
    });
  }

  // The fist is a Monk weapon too, and the one a Monk always has. Only listed
  // for a Martial Arts hero: everyone else's 1 + STR is not worth a line.
  if (martialArts) {
    const mod = Math.max(str, dex);
    out.push({
      name: "Unarmed Strike",
      bonus: mod + prof,
      damage: mod !== 0 ? `${maDie}${signed(mod)}` : maDie!,
      damageType: "bludgeoning",
    });
  }
  return out;
}
