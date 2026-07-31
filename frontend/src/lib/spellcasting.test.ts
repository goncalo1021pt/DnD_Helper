import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fallbackCasting, maxSpellLevel } from "./spellcasting";

/*
The TypeScript half of the shared rules contract (#112).

Its Go twin is backend/internal/rules/spellslots_test.go, and both read the same
fixture. That is the whole mechanism: the two engines cannot drift without one
of them going red.

They are not written the same way, which is exactly why this matters. Go
transcribes the SRD slot tables and derives the highest level from them;
TypeScript re-derives it with formulas — `ceil(level / 2)` for full casters,
`ceil(level / 4)` for half. Two roads to the same number, and nothing until now
checked they still arrive together.
*/

interface SlotCase {
  kind: string;
  level: number;
  slots: number[];
  maxSpellLevel: number;
}

const cases: SlotCase[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/spell-slots.json", import.meta.url), "utf8"),
).cases;

describe("the shared spell-slot fixture", () => {
  it("is loaded, and covers every caster kind at every level", () => {
    expect(cases.length).toBe(80);
    for (const kind of ["full", "half", "pact", "none"]) {
      expect(cases.filter((c) => c.kind === kind)).toHaveLength(20);
    }
  });

  it("agrees with maxSpellLevel, formula for table", () => {
    for (const c of cases) {
      // `none` is not a caster kind the client models — it falls through to the
      // full-caster branch, so the fixture's 0 is not its answer to give.
      if (c.kind === "none") continue;
      expect(
        maxSpellLevel(c.kind, c.level),
        `${c.kind} level ${c.level}`,
      ).toBe(c.maxSpellLevel);
    }
  });

  it("clamps a level outside the table rather than reading past it", () => {
    expect(maxSpellLevel("full", 0)).toBe(maxSpellLevel("full", 1));
    expect(maxSpellLevel("full", 99)).toBe(maxSpellLevel("full", 20));
  });
});

describe("fallbackCasting", () => {
  // Homebrew classes that set only data.spellcaster get one of these tables, so
  // the ability they cast from is a rule the sheet prints and the server checks.
  it("gives each caster kind the ability its archetype casts from", () => {
    expect(fallbackCasting("half").ability).toBe("CHA");
    expect(fallbackCasting("pact").ability).toBe("CHA");
    expect(fallbackCasting("full").ability).toBe("INT");
    expect(fallbackCasting("anything-else").ability).toBe("INT");
  });

  it("gives a half-caster no cantrips, which is what makes it a half-caster", () => {
    expect(fallbackCasting("half").cantrips.every((n) => n === 0)).toBe(true);
    expect(fallbackCasting("pact").cantrips[0]).toBeGreaterThan(0);
  });
});
