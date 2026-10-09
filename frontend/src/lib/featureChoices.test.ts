import { describe, expect, it } from "vitest";
import type { FeatureChoice, RulesContent } from "../api/client";
import { readFileSync } from "node:fs";
import {
  choicesGrowingAt,
  choicesOf,
  owed,
  poolFor,
  prereqUnmet,
  trainingFromChoices,
} from "./featureChoices";

/*
The client's half of feature choices (#382): previewing what a level brings,
and what a pick may be. The count rule mirrors countAt in feature_choices.go —
a number, twenty values by class level, or a featuresTable column.
*/

const entry = (data: unknown, name = "Fighter", id = "c1") =>
  ({ id, name, data, summary: "", source: "srd", kind: "class" }) as unknown as RulesContent;

const fighter = entry({
  featuresTable: [{ name: "Weapon Mastery", values: ["3", "3", "3", "4", "4", "4", "4", "4", "4", "5", "5", "5", "5", "5", "5", "6", "6", "6", "6", "6"] }],
  features: [
    { level: 1, name: "Fighting Style", choice: { id: "fighting-style", type: "feat", from: "fighting-style", swap: "levelup" } },
    { level: 1, name: "Weapon Mastery", choice: { id: "weapon-mastery", type: "mastery", chooseTable: "Weapon Mastery", swap: "rest" } },
    { level: 2, name: "Action Surge" },
  ],
});

describe("feature choices", () => {
  it("reads counts off a number, a level table and a table column", () => {
    const rogue = entry({
      features: [{ level: 1, name: "Expertise", choice: { id: "expertise", type: "expertise", choose: [2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] } }],
    }, "Rogue");
    expect(choicesOf(rogue, 5)[0].count).toBe(2);
    expect(choicesOf(rogue, 6)[0].count).toBe(4);
    const [style, mastery] = choicesOf(fighter, 4);
    expect(style).toMatchObject({ key: "c1:fighting-style", count: 1, type: "feat", from: "fighting-style" });
    expect(mastery.count).toBe(4);
  });

  it("a level-up asks what grows and what is still owed, not what is settled", () => {
    const made = [
      { key: "c1:fighting-style", picked: ["Defense"] },
      { key: "c1:weapon-mastery", picked: ["Longsword", "Handaxe", "Javelin"] },
    ] as FeatureChoice[];
    expect(choicesGrowingAt(fighter, 3, made)).toEqual([]);
    const at4 = choicesGrowingAt(fighter, 4, made);
    expect(at4.map((c) => c.key)).toEqual(["c1:weapon-mastery"]);
    expect(at4[0].picked).toEqual(["Longsword", "Handaxe", "Javelin"]);
    expect(owed(at4)).toHaveLength(1);
  });

  it("offers feats of the category, its own options, and greys out what is held", () => {
    const [style] = choicesOf(fighter, 1);
    const feats = [
      { name: "Defense", data: { category: "fighting-style" } },
      { name: "Archery", data: { category: "fighting-style" } },
      { name: "Alert", data: { category: "origin" } },
    ] as unknown as RulesContent[];
    const pool = poolFor({ ...style, options: [{ name: "Blessed Warrior" }] }, { feats, claimed: ["Archery"] });
    expect(pool.map((p) => p.name)).toEqual(["Archery", "Defense", "Blessed Warrior"]);
    expect(pool[0].disabled).toBe("already taken");
  });

  it("expertise draws on proficient skills, narrowed by options", () => {
    const scholar = {
      key: "w:scholar", type: "expertise", count: 1, picked: [], options: [{ name: "Arcana" }, { name: "History" }],
    } as unknown as FeatureChoice;
    expect(poolFor(scholar, { skills: ["Arcana", "Insight"] }).map((p) => p.name)).toEqual(["Arcana"]);
  });

  it("a picked option's weapon training reaches the attack lines", () => {
    const order = {
      key: "cl:divine-order", type: "option", count: 1, picked: ["Protector"],
      options: [{ name: "Protector", weapons: ["Martial"] }, { name: "Thaumaturge" }],
    } as unknown as FeatureChoice;
    expect(trainingFromChoices([order])).toEqual([{ data: { weapons: ["Martial"] } }]);
    expect(trainingFromChoices([{ ...order, picked: ["Thaumaturge"] }])).toEqual([]);
  });
});

describe("feat prerequisites", () => {
  const cases: Array<{
    name: string;
    prerequisite: string;
    levels: Record<string, number>;
    total: number;
    has: string[];
    unmet: string;
  }> = JSON.parse(
    readFileSync(new URL("../../../fixtures/rules/feat-prerequisites.json", import.meta.url), "utf8"),
  ).cases;

  it("agrees with feat_prereqs.go on every case", () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const has = (f: string) => c.has.some((h) => h.toLowerCase() === f.toLowerCase());
      expect(prereqUnmet(c.prerequisite, c.levels, c.total, has), c.name).toBe(c.unmet);
    }
  });

  it("an invocation's level blocks it now; a needed invocation travels to the picker", () => {
    const choice = {
      key: "w:eldritch-invocations", type: "feat", from: "invocation", count: 3, picked: [], options: [],
    } as unknown as FeatureChoice;
    const feats = [
      { name: "Pact of the Blade", data: { category: "invocation" } },
      { name: "Thirsting Blade", data: { category: "invocation", prerequisite: "Level 5+ Warlock, Pact of the Blade Invocation" } },
      { name: "Agonizing Blast", data: { category: "invocation", prerequisite: "Level 2+ Warlock, a Warlock Cantrip That Deals Damage", repeatable: true } },
    ] as unknown as RulesContent[];
    const at = (level: number) => poolFor(choice, { feats, levels: { warlock: level }, total: level, owned: [] });
    const thirsting = (level: number) => at(level).find((p) => p.name === "Thirsting Blade")!;
    expect(thirsting(4).disabled).toBe("needs Warlock level 5");
    expect(thirsting(5).disabled).toBeUndefined();
    expect(thirsting(5).needs).toEqual(["Pact of the Blade"]);
    expect(at(2).find((p) => p.name === "Agonizing Blast")).toMatchObject({ repeatable: true, disabled: undefined });
  });
});
