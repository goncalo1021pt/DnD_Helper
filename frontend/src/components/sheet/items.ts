/*
What a piece of gear is, and what is worth saying about it.

Lifted out of HeroSheetPage (#108). All four read the same place — an inventory
row's linked library content — and answer a different question about it.

slotsFor is the one with teeth: it decides what the rig offers for a slot, so a
row that answers wrongly is a shield that cannot be held or a sword that can be
worn as armour. e2e/sheet.spec.ts equips real Chain Mail through it and watches
the AC move from 12 to 16.
*/
import type { InventoryItem } from "../../api/client";

export type EquipSlot = "armor" | "mainhand" | "offhand";
export const SLOT_LABEL: Record<EquipSlot, string> = {
  armor: "Armor",
  mainhand: "Main Hand",
  offhand: "Off Hand",
};

export function itemTypeOf(it: InventoryItem): string {
  return ((it.content?.data ?? {}) as { type?: string }).type ?? "";
}

/** Which slots an inventory row can occupy. */
export function slotsFor(it: InventoryItem): EquipSlot[] {
  switch (itemTypeOf(it)) {
    case "armor":
      return ["armor"];
    case "shield":
      return ["offhand"];
    case "weapon":
      return ["mainhand", "offhand"];
    default:
      return [];
  }
}

/** The one number worth printing on a tile. */
export function keyStat(it: InventoryItem): string {
  const d = (it.content?.data ?? {}) as {
    ac?: number; acBonus?: number; damage?: string; damageType?: string;
  };
  switch (itemTypeOf(it)) {
    case "armor":
      return `AC ${d.ac ?? "?"}`;
    case "shield":
      return `+${d.acBonus ?? 2} AC`;
    case "weapon":
      return `${d.damage ?? ""} ${d.damageType ?? ""}`.trim();
    default:
      return "";
  }
}
