/*
 * The Forge's fixed quantities: the six abilities, the 2024 score methods, and
 * the step order. Shared by the wizard and its panels, so they live apart from
 * both rather than in whichever one happened to declare them.
 */

import type { AbilityScores } from "../../api/client";

export type AbilityKey = keyof AbilityScores;
export const ABILITIES: Array<[AbilityKey, string]> = [
  ["str", "Strength"],
  ["dex", "Dexterity"],
  ["con", "Constitution"],
  ["int", "Intelligence"],
  ["wis", "Wisdom"],
  ["cha", "Charisma"],
];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_BUDGET = 27;
export const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export type Method = "array" | "points" | "manual";
export type BonusMode = "2/1" | "1/1/1";

export const BASE_STEPS = ["Class", "Background", "Species", "Abilities", "Name"] as const;
export type StepName = (typeof BASE_STEPS)[number] | "Spells" | "Gear";

// What the option steps are browsing, for the sieve's placeholder and tally.
export const STEP_NOUN: Partial<Record<StepName, string>> = {
  Class: "classes",
  Background: "backgrounds",
  Species: "species",
  Spells: "spells",
};

export interface GearOption {
  label: string;
  items?: Array<{ name: string; qty?: number }>;
  gold?: number;
}

export function gearLine(o: GearOption) {
  const parts = (o.items ?? []).map((i) => (i.qty && i.qty > 1 ? `${i.qty}× ${i.name}` : i.name));
  if (o.gold) parts.push(`${o.gold} GP`);
  return parts.join(", ");
}
