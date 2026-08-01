import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { abilityMod, modText } from "./abilities";

/*
The TypeScript half of the shared ability-modifier contract (#112).

Its Go twin is backend/internal/http/shared_rules_test.go, reading the same
file. The numbers in it are copied from the SRD table rather than generated
from either side, so both engines are being checked against the rules instead
of against each other's habits.

The odd scores under 10 are why this is worth a fixture at all: floor and
truncate agree everywhere except there, and Go's integer division truncates.
*/

interface ModCase {
  score: number;
  mod: number;
}

const cases: ModCase[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/ability-mods.json", import.meta.url), "utf8"),
).cases;

describe("the shared ability-modifier fixture", () => {
  it("covers every legal score", () => {
    expect(cases).toHaveLength(30);
    expect(cases[0].score).toBe(1);
    expect(cases[cases.length - 1].score).toBe(30);
  });

  it("agrees with abilityMod at every score", () => {
    for (const c of cases) {
      expect(abilityMod(c.score), `score ${c.score}`).toBe(c.mod);
    }
  });

  // The half the fixture cannot state, because it is about the sheet rather
  // than the rules: a printed modifier carries a true minus sign, not a hyphen.
  it("prints a signed modifier the way a sheet does", () => {
    expect(modText(16)).toBe("+3");
    expect(modText(10)).toBe("+0");
    expect(modText(8)).toBe("−1");
    expect(modText(1)).toBe("−5");
  });
});
