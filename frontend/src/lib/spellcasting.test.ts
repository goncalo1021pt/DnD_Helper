import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { casterSourceFor, fallbackCasting, maxSpellLevel, spellOnClassList } from "./spellcasting";

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
    expect(cases.length).toBe(100);
    for (const kind of ["full", "half", "third", "pact", "none"]) {
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

  it("gives a third-caster nothing before the subclass exists at level 3", () => {
    expect(fallbackCasting("third").ability).toBe("INT");
    expect(fallbackCasting("third").cantrips[1]).toBe(0);
    expect(fallbackCasting("third").cantrips[2]).toBe(2);
  });
});

/*
Subclass-granted casting (#220): Fighter is not a caster — an Eldritch
Knight's spellcasting is declared on the subclass, and reads the Wizard list
through data.spellListClass.
*/
describe("casterSourceFor", () => {
  const fighter = { name: "Fighter", data: {} };
  const eldritchKnight = { data: { spellcaster: "third", spellListClass: "Wizard" } };
  const fireball = { name: "Fireball", data: { classes: ["Sorcerer", "Wizard"], level: 3 } };

  it("falls through to the subclass when the class does not cast", () => {
    const source = casterSourceFor(fighter, eldritchKnight);
    expect(source?.name).toBe("Fighter");
    expect(source?.data).toBe(eldritchKnight.data);
    expect(casterSourceFor(fighter, undefined)).toBeUndefined();
  });

  it("keeps the class's own declaration when it has one", () => {
    const wizard = { name: "Wizard", data: { spellcaster: "full" } };
    expect(casterSourceFor(wizard, eldritchKnight)).toBe(wizard);
  });

  it("borrows the spellListClass's spell list", () => {
    const source = casterSourceFor(fighter, eldritchKnight);
    expect(spellOnClassList(fireball, source)).toBe(true);
    const bless = { name: "Bless", data: { classes: ["Cleric"], level: 1 } };
    expect(spellOnClassList(bless, source)).toBe(false);
  });
});
