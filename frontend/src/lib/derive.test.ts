import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AbilityScores, InventoryItem } from "../api/client";
import {
  acFromEquipment,
  featAsFeature,
  featuresOf,
  profBonus,
  proficientWith,
  weaponAttacks,
  weaponProficiencies,
  type Feature,
} from "./derive";

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
  feats?: Array<Record<string, unknown>>;
  items: Array<{ equipped: boolean; attuned?: boolean; data: Record<string, unknown> }>;
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
    // The magic (#189): a bonus case, a worn case, and attunement both ways —
    // so nobody can quietly delete the cases that keep the +N honest.
    expect(cases.some((c) => c.items.some((i) => typeof i.data.bonus === "number"))).toBe(true);
    expect(cases.some((c) => c.items.some((i) => typeof i.data.wear === "string"))).toBe(true);
    expect(cases.some((c) => c.items.some((i) => i.data.attunement === true && i.attuned))).toBe(true);
    expect(cases.some((c) => c.items.some((i) => i.data.attunement === true && !i.attuned))).toBe(true);
  });

  it("agrees with acFromEquipment on every case", () => {
    for (const c of cases) {
      // Features are gathered the way a sheet gathers them: every source the
      // hero carries, filtered to what they have actually reached.
      const features: Feature[] = [
        ...c.sources.flatMap((data) => featuresOf({ data }, c.level)),
        ...(c.feats ?? []).map((data) => featAsFeature("feat", { data })),
      ];
      const items = c.items.map(
        (i) =>
          ({
            equipped: i.equipped,
            attuned: i.attuned ?? false,
            content: { data: i.data },
          }) as unknown as InventoryItem,
      );
      expect(acFromEquipment(items, c.abilities, features), c.name).toBe(c.ac);
    }
  });
});

/*
Weapon attacks are the client's alone — the server never computes an attack
roll (combatant snapshots carry AC only) — so the +N rule is pinned here
rather than in a shared fixture.
*/
describe("weapon attacks", () => {
  const item = (data: Record<string, unknown>, attuned = false) =>
    ({ equipped: true, attuned, name: "Blade", content: { data } }) as unknown as InventoryItem;
  const strHero = { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } as AbilityScores;

  it("swings a mundane sword at mod + prof", () => {
    const [atk] = weaponAttacks([item({ type: "weapon", damage: "1d8", damageType: "slashing" })], strHero, 1);
    expect(atk.bonus).toBe(5); // +3 STR, +2 prof
    expect(atk.damage).toBe("1d8+3");
  });

  it("folds a +1 into both the swing and what lands", () => {
    const [atk] = weaponAttacks(
      [item({ type: "weapon", damage: "1d8", damageType: "slashing", bonus: 1 })],
      strHero,
      1,
    );
    expect(atk.bonus).toBe(6);
    expect(atk.damage).toBe("1d8+4");
  });

  it("an unattuned attunement blade swings mundane; the bond wakes it", () => {
    const data = { type: "weapon", damage: "1d6", damageType: "slashing", bonus: 2, attunement: true };
    const [cold] = weaponAttacks([item(data)], strHero, 1);
    expect(cold.bonus).toBe(5);
    expect(cold.damage).toBe("1d6+3");
    const [bonded] = weaponAttacks([item(data, true)], strHero, 1);
    expect(bonded.bonus).toBe(7);
    expect(bonded.damage).toBe("1d6+5");
  });

  it("keeps the damage string bare when the whole modifier cancels out", () => {
    const frail = { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } as AbilityScores;
    const [atk] = weaponAttacks(
      [item({ type: "weapon", damage: "1d8", damageType: "bludgeoning", bonus: 1 })],
      frail,
      1,
    );
    expect(atk.bonus).toBe(2); // -1 STR +1 magic + 2 prof
    expect(atk.damage).toBe("1d8");
  });

  it("a versatile weapon rolls its bigger die when gripped in both hands", () => {
    const longsword = { type: "weapon", damage: "1d8", damage2: "1d10", damageType: "slashing", properties: ["Versatile"] };
    const oneHand = { ...item(longsword), slot: "mainhand" } as unknown as InventoryItem;
    const twoHands = { ...item(longsword), slot: "bothhands" } as unknown as InventoryItem;
    expect(weaponAttacks([oneHand], strHero, 1)[0].damage).toBe("1d8+3");
    expect(weaponAttacks([twoHands], strHero, 1)[0].damage).toBe("1d10+3");
    // The grip changes the die, never the to-hit.
    expect(weaponAttacks([twoHands], strHero, 1)[0].bonus).toBe(5);
  });

  it("finesse still picks the better hand, magic riding along", () => {
    const nimble = { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } as AbilityScores;
    const [atk] = weaponAttacks(
      [item({ type: "weapon", damage: "1d4", damageType: "piercing", properties: ["Finesse"], bonus: 1 })],
      nimble,
      1,
    );
    expect(atk.bonus).toBe(6); // +3 DEX +1 magic +2 prof
    expect(atk.damage).toBe("1d4+4");
  });
});

/*
The Monk, the untrained, and the fighting styles (#379). At the table a Monk 1
with DEX 16 read +2 to hit with a quarterstaff (STR, and nothing of Martial
Arts) and a Wizard read +4 with a longsword nobody taught them.
*/
describe("weapon attacks: training and Martial Arts", () => {
  const named = (name: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ equipped: true, attuned: false, name, content: { data }, ...extra }) as unknown as InventoryItem;
  const quarterstaff = named("Quarterstaff", {
    type: "weapon", category: "Simple", damage: "1d6", damage2: "1d8", damageType: "bludgeoning", properties: ["Versatile"],
  });
  const longsword = named("Longsword", {
    type: "weapon", category: "Martial", damage: "1d8", damage2: "1d10", damageType: "slashing", properties: ["Versatile"],
  });
  const shortsword = named("Shortsword", {
    type: "weapon", category: "Martial", damage: "1d6", damageType: "piercing", properties: ["Finesse", "Light"],
  });
  const longbow = named("Longbow", {
    type: "weapon", category: "Martial", damage: "1d8", damageType: "piercing", ranged: true, properties: ["Heavy", "Two-Handed"],
  });
  const monkClass = {
    data: {
      weapons: ["Simple", "Martial (light)"],
      features: [{ level: 1, name: "Martial Arts", martialArts: { table: "Martial Arts" } }],
      featuresTable: [{ name: "Martial Arts", values: ["1d6", "1d6", "1d6", "1d6", "1d8", "1d8", "1d8", "1d8", "1d8", "1d8", "1d10", "1d10", "1d10", "1d10", "1d10", "1d10", "1d12", "1d12", "1d12", "1d12"] }],
    },
  };
  const monk = { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 10 } as AbilityScores;

  it("reads the Martial Arts die at the level in the class", () => {
    expect(featuresOf(monkClass, 1)[0].martialArts?.die).toBe("1d6");
    expect(featuresOf(monkClass, 5)[0].martialArts?.die).toBe("1d8");
    expect(featuresOf(monkClass, 17)[0].martialArts?.die).toBe("1d12");
  });

  it("a Monk swings a quarterstaff with DEX and adds an Unarmed Strike", () => {
    const features = featuresOf(monkClass, 1);
    const proficiencies = weaponProficiencies(monkClass, []);
    const [staff, fist] = weaponAttacks([quarterstaff], monk, 1, { features, proficiencies });
    expect(staff).toMatchObject({ name: "Quarterstaff", bonus: 5, damage: "1d6+3" });
    expect(fist).toMatchObject({ name: "Unarmed Strike", bonus: 5, damage: "1d6+3", damageType: "bludgeoning" });
  });

  it("the Martial Arts die replaces a smaller weapon die, never a bigger one", () => {
    const features = featuresOf(monkClass, 5); // 1d8
    const dagger = named("Dagger", { type: "weapon", category: "Simple", damage: "1d4", damageType: "piercing", properties: ["Finesse", "Light"] });
    expect(weaponAttacks([dagger], monk, 5, { features })[0].damage).toBe("1d8+3");
    const twoHands = { ...quarterstaff, slot: "bothhands" } as InventoryItem;
    expect(weaponAttacks([twoHands], monk, 5, { features })[0].damage).toBe("1d8+3");
    expect(weaponAttacks([shortsword], monk, 17, { features: featuresOf(monkClass, 17) })[0].damage).toBe("1d12+3");
  });

  it("armour, a shield or a non-Monk weapon puts Martial Arts away", () => {
    const features = featuresOf(monkClass, 1);
    const leather = named("Leather Armor", { type: "armor", category: "Light", ac: 11 });
    const inArmor = weaponAttacks([quarterstaff, leather], monk, 1, { features });
    expect(inArmor).toHaveLength(1);
    expect(inArmor[0]).toMatchObject({ bonus: 2, damage: "1d6" }); // STR 10, no Unarmed Strike line
    const withLongsword = weaponAttacks([longsword], monk, 1, { features });
    expect(withLongsword.map((a) => a.name)).toEqual(["Longsword"]);
    // A bow is not a Monk weapon either; it still shoots with DEX.
    expect(weaponAttacks([longbow], monk, 1, { features })[0]).toMatchObject({ bonus: 5, damage: "1d8+3" });
  });

  it("adds proficiency only for weapons the hero was taught", () => {
    const wizard = { data: { weapons: ["Simple"] } };
    const strong = { str: 14, dex: 10, con: 14, int: 16, wis: 12, cha: 8 } as AbilityScores;
    const proficiencies = weaponProficiencies(wizard, []);
    expect(weaponAttacks([longsword], strong, 1, { proficiencies })[0].bonus).toBe(2);
    expect(weaponAttacks([quarterstaff], strong, 1, { proficiencies })[0].bonus).toBe(4);
  });

  it("reads the narrowed and the named proficiency lines", () => {
    const rogue = ["Simple", "Martial (finesse/light)"];
    expect(proficientWith("Rapier", { category: "Martial", properties: ["Finesse"] }, rogue)).toBe(true);
    expect(proficientWith("Hand Crossbow", { category: "Martial", properties: ["Light", "Loading"] }, rogue)).toBe(true);
    expect(proficientWith("Longsword", { category: "Martial", properties: ["Versatile"] }, rogue)).toBe(false);
    expect(proficientWith("+1 Longsword", { category: "Martial" }, ["Simple", "Longswords"])).toBe(true);
    // A second class hands over only its multiclass line (PHB 2024, p.44).
    const fighter = { data: { weapons: ["Simple", "Martial"], multiclass: { proficiencies: ["Martial weapons"] } } };
    const wizard = { data: { weapons: ["Simple"] } };
    expect(proficientWith("Longsword", { category: "Martial" }, weaponProficiencies(wizard, [fighter]))).toBe(true);
    expect(proficientWith("Longsword", { category: "Martial" }, weaponProficiencies(wizard, [wizard]))).toBe(false);
    // No class known at all: a quick-add keeps its bonus.
    expect(weaponProficiencies(undefined, [])).toBeUndefined();
    expect(proficientWith("Longsword", { category: "Martial" }, undefined)).toBe(true);
  });

  it("Archery aims ranged weapons only; Dueling lands one-handed blows only", () => {
    const archery = featAsFeature("Archery", { data: { weaponBonus: { ranged: true, attack: 2 } } });
    const dueling = featAsFeature("Dueling", { data: { weaponBonus: { melee: true, oneHanded: true, damage: 2 } } });
    const archer = { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } as AbilityScores;
    expect(weaponAttacks([longbow], archer, 1, { features: [archery] })[0].bonus).toBe(7);
    expect(weaponAttacks([shortsword], archer, 1, { features: [archery] })[0].bonus).toBe(5);
    const strong = { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } as AbilityScores;
    expect(weaponAttacks([longsword], strong, 1, { features: [dueling] })[0].damage).toBe("1d8+5");
    const gripped = { ...longsword, slot: "bothhands" } as InventoryItem;
    expect(weaponAttacks([gripped], strong, 1, { features: [dueling] })[0].damage).toBe("1d10+3");
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
