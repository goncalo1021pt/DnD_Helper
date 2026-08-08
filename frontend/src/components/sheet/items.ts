/*
What a piece of gear is, and what is worth saying about it.

Lifted out of HeroSheetPage (#108). All four read the same place — an inventory
row's linked library content — and answer a different question about it.

slotsFor is the one with teeth: it decides what the rig offers for a slot, so a
row that answers wrongly is a shield that cannot be held or a sword that can be
worn as armour. e2e/sheet.spec.ts equips real Chain Mail through it and watches
the AC move from 12 to 16. Since #189 it also answers for the worn slots — a
cloak hangs on the shoulders, rings get the classic two — mirroring wearSlots
in backend/internal/http/inventory.go.
*/
import type { InventoryItem, RulesContent } from "../../api/client";

export type EquipSlot =
  | "armor" | "mainhand" | "offhand" | "bothhands"
  | "cloak" | "amulet" | "helm" | "belt" | "boots" | "gloves" | "bracers"
  | "ring1" | "ring2";

/** The three battle slots, always drawn as tiles on the rig. A two-handed
 * grip (`bothhands`) replaces the two hand tiles with one wide card. */
export const BATTLE_SLOTS: EquipSlot[] = ["armor", "mainhand", "offhand"];

export const SLOT_LABEL: Record<EquipSlot, string> = {
  armor: "Armor",
  mainhand: "Main Hand",
  offhand: "Off Hand",
  bothhands: "Both Hands",
  cloak: "Cloak",
  amulet: "Amulet",
  helm: "Helm",
  belt: "Belt",
  boots: "Boots",
  gloves: "Gloves",
  bracers: "Bracers",
  ring1: "Ring",
  ring2: "Ring",
};

/** Which slots each worn kind may occupy — the client mirror of wearSlots. */
const WEAR_SLOTS: Record<string, EquipSlot[]> = {
  cloak: ["cloak"], amulet: ["amulet"], helm: ["helm"], belt: ["belt"],
  boots: ["boots"], gloves: ["gloves"], bracers: ["bracers"],
  ring: ["ring1", "ring2"],
};

export function itemTypeOf(it: InventoryItem): string {
  return ((it.content?.data ?? {}) as { type?: string }).type ?? "";
}

export function wearOf(it: InventoryItem): string {
  return ((it.content?.data ?? {}) as { wear?: string }).wear ?? "";
}

/** Whether this row's content asks for attunement. */
export function needsAttunement(it: InventoryItem): boolean {
  return ((it.content?.data ?? {}) as { attunement?: boolean }).attunement === true;
}

/** Which slots an inventory row can occupy. A Two-Handed weapon knows only
 * the two-handed grip; a Versatile one may take it for its bigger die. */
export function slotsFor(it: InventoryItem): EquipSlot[] {
  const props = ((it.content?.data ?? {}) as { properties?: string[] }).properties ?? [];
  switch (itemTypeOf(it)) {
    case "armor":
      return ["armor"];
    case "shield":
      return ["offhand"];
    case "weapon":
      if (props.includes("Two-Handed")) return ["bothhands"];
      if (props.includes("Versatile")) return ["mainhand", "offhand", "bothhands"];
      return ["mainhand", "offhand"];
    case "gear":
      return WEAR_SLOTS[wearOf(it)] ?? [];
    default:
      return [];
  }
}

/** The armory select's shelves (#189): mundane gear by type, magic by rarity
 * in the books' order. One flat list served 55 items; the SRD's magic chapter
 * does not fit in one. */
export function armoryGroups(library: RulesContent[]): Array<[string, RulesContent[]]> {
  const typeLabel: Record<string, string> = {
    armor: "Armor", shield: "Shields", weapon: "Weapons", gear: "Gear",
  };
  const rarityOrder = ["common", "uncommon", "rare", "very rare", "legendary", "artifact"];
  const groups = new Map<string, RulesContent[]>();
  for (const entry of library) {
    const d = (entry.data ?? {}) as { type?: string; rarity?: string };
    const rarity = (d.rarity ?? "").trim().toLowerCase();
    const label = rarity
      ? rarity.charAt(0).toUpperCase() + rarity.slice(1)
      : (typeLabel[d.type ?? "gear"] ?? "Gear");
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  const order = [...Object.values(typeLabel), ...rarityOrder.map((r) => r.charAt(0).toUpperCase() + r.slice(1))];
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    })
    .map(([label, entries]) => [label, entries.sort((x, y) => x.name.localeCompare(y.name))]);
}

/** The one number worth printing on a tile. The magic shows beside it — an
 * "AC 15 +1" reads as the armor and its enchantment, which is what it is. */
export function keyStat(it: InventoryItem): string {
  const d = (it.content?.data ?? {}) as {
    ac?: number; acBonus?: number; damage?: string; damage2?: string;
    damageType?: string; bonus?: number; wear?: string;
  };
  const plus = typeof d.bonus === "number" ? ` +${d.bonus}` : "";
  switch (itemTypeOf(it)) {
    case "armor":
      return `AC ${d.ac ?? "?"}${plus}`;
    case "shield":
      return `+${(d.acBonus ?? 2) + (d.bonus ?? 0)} AC`;
    case "weapon": {
      // Held in both hands, a versatile weapon shows the die it would roll.
      const die = it.slot === "bothhands" && d.damage2 ? d.damage2 : d.damage;
      return `${die ?? ""}${plus} ${d.damageType ?? ""}`.trim();
    }
    case "gear":
      return d.wear && typeof d.bonus === "number" ? `+${d.bonus} AC` : "";
    default:
      return "";
  }
}
