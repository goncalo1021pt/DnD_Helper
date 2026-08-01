import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { levelUpHold, levelUpHoldReason, nextLevelXP, readyToLevel } from "./progression";

/*
The TypeScript half of the shared level-up contract (#112).

Its Go twin is backend/internal/http/shared_rules_test.go. This file already
claimed to mirror the server — "so the Level up button never lies" — and
nothing checked that it still did. Now the two answer the same fixture.

The button is the whole point: it is either enabled on a hero the server will
refuse, or disabled on one the server would happily raise. The second is worse,
because nobody reports it. The player just believes they cannot level up yet.
*/

interface GateCase {
  name: string;
  level: number;
  pendingLevels: number;
  progression: "milestone" | "xp";
  maxLevel: number | null;
  hold: "ceiling" | "milestone" | null;
}

const cases: GateCase[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/level-up-gates.json", import.meta.url), "utf8"),
).cases;

describe("the shared level-up gate fixture", () => {
  it("covers a clear road and both ways of being held", () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const hold of [null, "ceiling", "milestone"]) {
      expect(cases.filter((c) => c.hold === hold).length, `hold: ${hold}`).toBeGreaterThan(0);
    }
  });

  it("agrees with the server on what is holding a hero", () => {
    for (const c of cases) {
      expect(
        levelUpHoldReason(c.level, c.pendingLevels, c.progression, c.maxLevel),
        c.name,
      ).toBe(c.hold);
    }
  });
});

describe("levelUpHold, the sentence under the button", () => {
  const table = { progression: "milestone" as const, maxLevel: 5 };

  it("says which gate is closed, in the words the button wears", () => {
    expect(levelUpHold({ level: 5, pendingLevels: 2, campaignId: "c" }, table)).toBe(
      "at the table's ceiling — level 5",
    );
    expect(levelUpHold({ level: 2, pendingLevels: 0, campaignId: "c" }, table)).toBe(
      "waiting on the DM's milestone",
    );
    expect(levelUpHold({ level: 2, pendingLevels: 1, campaignId: "c" }, table)).toBeNull();
  });

  // The gates belong to a table, so a hero who sits at none is not held by
  // them. The server agrees by only reaching this check for a seated hero.
  it("does not hold a hero who is seated nowhere", () => {
    expect(levelUpHold({ level: 9, pendingLevels: 0, campaignId: null }, table)).toBeNull();
    expect(levelUpHold({ level: 9, pendingLevels: 0, campaignId: "c" }, undefined)).toBeNull();
  });
});

describe("XP thresholds", () => {
  it("knows what the next level costs, and that 20 is the end of the road", () => {
    expect(nextLevelXP(1)).toBe(300);
    expect(nextLevelXP(19)).toBe(355000);
    expect(nextLevelXP(20)).toBeNull();
  });

  it("is advisory: banked XP says ready, it does not itself raise anyone", () => {
    expect(readyToLevel(299, 1)).toBe(false);
    expect(readyToLevel(300, 1)).toBe(true);
    expect(readyToLevel(9_000_000, 20)).toBe(false);
  });
});
