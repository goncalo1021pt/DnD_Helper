import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RulesContent } from "../api/client";
import {
  bandFor,
  encounterDifficulty,
  monsterXP,
  partyBudget,
} from "./encounterDifficulty";

/*
The difficulty maths (#110).

The interesting half is checked against the real Den rather than against
examples I chose: every one of the 330 shipped creatures goes through
monsterXP, so a parser that quietly returned 0 for some format cannot pass.
That matters because 0 is a plausible-looking answer — the meter would simply
read lighter than the fight is, which is the failure a DM finds out about at
the table.
*/

const srd = JSON.parse(
  readFileSync(
    new URL("../../../backend/internal/rules/srd/monsters.json", import.meta.url),
    "utf8",
  ),
) as Array<{ name: string; data: Record<string, unknown> }>;

const den = (name: string): RulesContent => {
  const hit = srd.find((m) => m.name === name);
  expect(hit, `${name} should be in the Den`).toBeTruthy();
  return hit as unknown as RulesContent;
};

const fake = (data: Record<string, unknown>): RulesContent => ({ data }) as RulesContent;

describe("what a creature is worth", () => {
  it("reads an XP off every creature the Den ships", () => {
    expect(srd.length).toBeGreaterThan(300);
    const worthless = srd.filter(
      (m) => monsterXP(m as unknown as RulesContent) === 0 && m.data.crValue !== 0,
    );
    expect(worthless.map((m) => m.name)).toEqual([]);
  });

  it("reads both orderings the SRD actually uses", () => {
    expect(monsterXP(den("Goblin Warrior"))).toBe(50); // "1/4 (XP 50; PB +2)"
    expect(monsterXP(den("Werewolf"))).toBe(700); // "3 (700 XP; PB +2)" — the other way round
  });

  it("takes the base value from a creature with a lair", () => {
    // "17 (XP 18,000, or 20,000 in lair; PB +6)" — the lair bonus is the DM's
    // choice about where the fight happens, not a property of the dragon.
    expect(monsterXP(den("Adult Red Dragon"))).toBe(18000);
  });

  // Both of these are why the creature's own line is read instead of a CR table.
  it("believes the creature over the CR table", () => {
    // The Archmage is CR 12 and says 8,000; the CR 12 row says 8,400.
    expect(monsterXP(den("Archmage"))).toBe(8000);
    // CR 0 splits: a Seahorse is worth nothing, a Rat is worth 10, and both are
    // CR 0. A table keyed on CR has to pick one and be wrong about the other.
    expect(monsterXP(den("Seahorse"))).toBe(0);
    expect(monsterXP(den("Rat"))).toBe(10);
  });

  it("falls back to the CR table for homebrew that states no XP", () => {
    expect(monsterXP(fake({ cr: "5", crValue: 5 }))).toBe(1800);
    expect(monsterXP(fake({ crValue: 0.25 }))).toBe(50);
  });

  it("gives a creature with nothing to go on a weight of zero", () => {
    expect(monsterXP(fake({}))).toBe(0);
    expect(monsterXP(undefined)).toBe(0);
  });
});

describe("the party's budget", () => {
  it("is the sum over everyone turning up, not a party-size lookup", () => {
    // Four level 5s: 4 × the level-5 row.
    expect(partyBudget([5, 5, 5, 5])).toEqual({ low: 2000, moderate: 3000, high: 4400 });
    // A mixed party is genuinely mixed — this is why levels are carried around
    // rather than a count and an average.
    expect(partyBudget([1, 5])).toEqual({ low: 550, moderate: 825, high: 1200 });
  });

  it("is nothing at all when nobody is coming", () => {
    expect(partyBudget([])).toEqual({ low: 0, moderate: 0, high: 0 });
  });

  it("clamps a level off the end of the table rather than reading past it", () => {
    expect(partyBudget([0])).toEqual(partyBudget([1]));
    expect(partyBudget([99])).toEqual(partyBudget([20]));
  });
});

describe("which band a fight lands in", () => {
  const budget = partyBudget([5, 5, 5, 5]); // low 2000, moderate 3000, high 4400

  it("reads the bands as floors, so an enormous fight is still 'high'", () => {
    expect(bandFor(1999, budget)).toBe("trivial");
    expect(bandFor(2000, budget)).toBe("low");
    expect(bandFor(2999, budget)).toBe("low");
    expect(bandFor(3000, budget)).toBe("moderate");
    expect(bandFor(4400, budget)).toBe("high");
    expect(bandFor(999999, budget)).toBe("high");
  });

  it("says trivial rather than guessing when there is no party", () => {
    expect(bandFor(5000, partyBudget([]))).toBe("trivial");
  });
});

describe("a whole encounter", () => {
  it("counts a mob as the mob it is", () => {
    // The thing a DM most often gets wrong by eye: eight skeletons at 50 XP
    // each is 400, not 50. Against four level-1 heroes (high budget 400) that
    // is the difference between "low" and a fight at the top of the band.
    const one = encounterDifficulty([{ monster: den("Skeleton"), count: 1 }], [1, 1, 1, 1]);
    const mob = encounterDifficulty([{ monster: den("Skeleton"), count: 8 }], [1, 1, 1, 1]);

    expect(one.totalXP).toBe(50);
    expect(one.band).toBe("trivial");
    expect(mob.totalXP).toBe(400);
    expect(mob.band).toBe("high");
  });

  it("adds different creatures together", () => {
    const d = encounterDifficulty(
      [
        { monster: den("Goblin Warrior"), count: 4 }, // 4 × 50
        { monster: den("Skeleton"), count: 2 }, // 2 × 50
      ],
      [3, 3, 3],
    );
    expect(d.totalXP).toBe(300);
    expect(d.budget).toEqual({ low: 450, moderate: 675, high: 1200 });
    expect(d.band).toBe("trivial");
  });

  it("reports a fraction the meter can draw, clamped at the top", () => {
    const party = [5, 5, 5, 5]; // high 4400
    expect(encounterDifficulty([], party).fraction).toBe(0);
    expect(
      encounterDifficulty([{ monster: fake({ cr: "XP 2200" }), count: 1 }], party).fraction,
    ).toBeCloseTo(0.5);
    expect(
      encounterDifficulty([{ monster: fake({ cr: "XP 999999" }), count: 1 }], party).fraction,
    ).toBe(1);
  });

  it("does not divide by an absent party", () => {
    const d = encounterDifficulty([{ monster: den("Skeleton"), count: 3 }], []);
    expect(d.totalXP).toBe(150);
    expect(d.fraction).toBe(0);
    expect(d.band).toBe("trivial");
  });
});
