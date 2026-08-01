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

export interface Feature {
  level?: number;
  name?: string;
  summary?: string;
  unarmoredDefense?: UnarmoredDefense;
}

/** The features one content entry grants a hero who has reached this level. */
export function featuresOf(source: { data?: unknown } | undefined, level: number): Feature[] {
  const data = source?.data as { features?: Feature[]; traits?: Feature[] } | undefined;
  // Classes and backgrounds call them features; a species calls them traits.
  return [...(data?.features ?? []), ...(data?.traits ?? [])].filter((f) => (f.level ?? 1) <= level);
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
  for (const it of items) {
    if (!it.equipped || !it.content) continue;
    const d = it.content.data as ArmorData;
    if (d.type === "armor" && typeof d.ac === "number") {
      armored = true;
      if (d.category === "Light") ac = d.ac + dex;
      else if (d.category === "Medium") ac = d.ac + Math.min(dex, 2);
      else ac = d.ac;
    } else if (d.type === "shield") {
      shield = d.acBonus ?? 2;
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
  }
  return ac + shield;
}

interface WeaponData {
  type?: string;
  damage?: string;
  damageType?: string;
  properties?: string[];
  ranged?: boolean;
}

export interface WeaponAttack {
  name: string;
  bonus: number;
  damage: string;
  damageType: string;
}

/** Attack lines for equipped weapons: DEX for ranged/finesse (when better),
 * STR otherwise; damage shows the ability mod folded in. */
export function weaponAttacks(
  items: InventoryItem[],
  abilities: AbilityScores,
  level: number,
): WeaponAttack[] {
  const prof = profBonus(level);
  const str = abilityMod(abilities.str);
  const dex = abilityMod(abilities.dex);
  const out: WeaponAttack[] = [];
  for (const it of items) {
    if (!it.equipped || !it.content) continue;
    const d = it.content.data as WeaponData;
    if (d.type !== "weapon" || !d.damage) continue;
    const finesse = d.properties?.includes("Finesse") ?? false;
    const useDex = d.ranged || (finesse && dex >= str);
    const mod = useDex ? dex : str;
    const sign = mod >= 0 ? `+${mod}` : `${mod}`;
    out.push({
      name: it.name,
      bonus: mod + prof,
      damage: mod !== 0 ? `${d.damage}${sign}` : d.damage,
      damageType: d.damageType ?? "",
    });
  }
  return out;
}
