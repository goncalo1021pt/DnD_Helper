import { describe, expect, it } from "vitest";
import type { FeatureChoice, RulesContent } from "../api/client";
import { choicesGrowingAt, choicesOf, owed, poolFor, trainingFromChoices } from "./featureChoices";

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
    const pool = poolFor({ ...style, options: [{ name: "Blessed Warrior" }] }, { feats, heldFeats: ["Archery"] });
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
