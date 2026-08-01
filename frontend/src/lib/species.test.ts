import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  choiceCount,
  grantedFeats,
  grantedSkills,
  picksComplete,
  type SpeciesChoice,
  type SpeciesPicks,
} from "./species";

/*
The TypeScript half of the shared species contract (#112).

Its Go twin is backend/internal/http/shared_rules_test.go. What the fixture
pins is the agreement that actually matters to a player: the Forge arms its
Next button exactly when the server would accept the hero, and the skills and
feats it shows them are the ones they will end up with.

Drift here is the expensive kind. The wizard is twenty minutes of choices, and
a disagreement surfaces at the very end — the forge refuses a hero the UI has
been telling them was finished.
*/

interface SpeciesCase {
  name: string;
  choices: SpeciesChoice[];
  picks: SpeciesPicks;
  complete: boolean;
  skills: string[];
  feats: string[];
}

const cases: SpeciesCase[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/species-choices.json", import.meta.url), "utf8"),
).cases;

describe("the shared species-choices fixture", () => {
  it("is loaded, and covers both answered and unanswered species", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((c) => c.complete)).toBe(true);
    expect(cases.some((c) => !c.complete)).toBe(true);
  });

  it("agrees on whether a species has been answered", () => {
    for (const c of cases) {
      expect(picksComplete({ choices: c.choices }, c.picks), c.name).toBe(c.complete);
    }
  });

  it("agrees on what the answers put on the sheet", () => {
    for (const c of cases) {
      // An unanswered species is not a legal hero, so it grants nothing worth
      // comparing — the server never gets far enough to say.
      if (!c.complete) continue;
      expect(grantedSkills({ choices: c.choices }, c.picks), c.name).toEqual(c.skills);
      expect(grantedFeats({ choices: c.choices }, c.picks), c.name).toEqual(c.feats);
    }
  });

  // Stated separately because it is the rule the completeness cases are built
  // on: a choice with no `choose`, or a nonsense one, still asks for exactly
  // one answer. Both engines normalise it the same way.
  it("reads a missing or zero choose as one", () => {
    expect(choiceCount({ id: "a", name: "A", type: "size" })).toBe(1);
    expect(choiceCount({ id: "a", name: "A", type: "size", choose: 0 })).toBe(1);
    expect(choiceCount({ id: "a", name: "A", type: "size", choose: 2 })).toBe(2);
  });
});
