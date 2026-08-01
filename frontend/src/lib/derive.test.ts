import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AbilityScores, InventoryItem } from "../api/client";
import { acFromEquipment, featuresOf, profBonus, type Feature } from "./derive";

/*
The TypeScript half of the shared armour-class contract (#153).

Its Go twin is backend/internal/http/shared_rules_test.go. This rule was the
client's alone until now — the server answered AC with 10 + DEX whenever a hero
was summoned into a fight, because raw scores and an inventory were all it could
see. So a Barbarian reading 15 on their sheet was seated at 12, and the DM spent
the fight rolling against a number nobody had agreed to.

Now both sides derive it, which means both sides can drift. Hence the fixture.
*/

interface ACCase {
  name: string;
  level: number;
  abilities: AbilityScores;
  sources: Array<Record<string, unknown>>;
  items: Array<{ equipped: boolean; data: Record<string, unknown> }>;
  ac: number;
}

const cases: ACCase[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/armor-class.json", import.meta.url), "utf8"),
).cases;

describe("the shared armour-class fixture", () => {
  it("covers armour, shields, and the features that replace both", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((c) => c.items.some((i) => i.data.type === "armor"))).toBe(true);
    expect(cases.some((c) => c.items.some((i) => i.data.type === "shield"))).toBe(true);
    expect(cases.some((c) => c.sources.length > 0)).toBe(true);
  });

  it("agrees with acFromEquipment on every case", () => {
    for (const c of cases) {
      // Features are gathered the way a sheet gathers them: every source the
      // hero carries, filtered to what they have actually reached.
      const features: Feature[] = c.sources.flatMap((data) => featuresOf({ data }, c.level));
      const items = c.items.map(
        (i) => ({ equipped: i.equipped, content: { data: i.data } }) as unknown as InventoryItem,
      );
      expect(acFromEquipment(items, c.abilities, features), c.name).toBe(c.ac);
    }
  });
});

describe("proficiency bonus", () => {
  // Not doubled in Go — the server has no use for it — so it is pinned here
  // alone, at the four levels where it steps.
  it("steps at 5, 9, 13 and 17", () => {
    expect([1, 4].map(profBonus)).toEqual([2, 2]);
    expect([5, 8].map(profBonus)).toEqual([3, 3]);
    expect([9, 12].map(profBonus)).toEqual([4, 4]);
    expect([13, 16].map(profBonus)).toEqual([5, 5]);
    expect([17, 20].map(profBonus)).toEqual([6, 6]);
  });

  it("clamps a level off the end of the table rather than extrapolating", () => {
    expect(profBonus(0)).toBe(2);
    expect(profBonus(99)).toBe(6);
  });
});
