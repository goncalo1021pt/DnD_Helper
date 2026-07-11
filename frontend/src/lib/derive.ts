import type { AbilityScores, InventoryItem } from "../api/client";
import { abilityMod } from "../components/ui/AbilityRow";

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

/** AC from equipped armor + shield: Light = ac+DEX, Medium = ac+min(DEX,2),
 * Heavy = ac flat; unarmored = 10+DEX. Shield adds its bonus on top. */
export function acFromEquipment(items: InventoryItem[], abilities: AbilityScores): number {
  const dex = abilityMod(abilities.dex);
  let ac = 10 + dex;
  let shield = 0;
  for (const it of items) {
    if (!it.equipped || !it.content) continue;
    const d = it.content.data as ArmorData;
    if (d.type === "armor" && typeof d.ac === "number") {
      if (d.category === "Light") ac = d.ac + dex;
      else if (d.category === "Medium") ac = d.ac + Math.min(dex, 2);
      else ac = d.ac;
    } else if (d.type === "shield") {
      shield = d.acBonus ?? 2;
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
