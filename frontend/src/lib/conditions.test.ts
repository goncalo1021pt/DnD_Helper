import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONDITION_NAMES, MAX_EXHAUSTION, canonicalCondition, normalizeConditions } from "./conditions";

/*
The TypeScript half of the shared conditions contract (#173, #112).

Its Go twin is backend/internal/http/conditions_test.go, reading this same
fixture. What is pinned is the vocabulary itself and the cleanup: the picker
must never offer a chip the tracker will reject, and both sides must agree on
the one canonical spelling and order a set collapses to, or the DM watches their
chips reshuffle every time the stream repaints.
*/

interface ConditionCase {
  name: string;
  input: string[];
  normalized?: string[];
  invalid?: boolean;
}

const fixture: { names: string[]; maxExhaustion: number; cases: ConditionCase[] } = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/conditions.json", import.meta.url), "utf8"),
);

describe("the shared conditions fixture", () => {
  it("is loaded, and covers both accepted and refused sets", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.cases.some((c) => c.invalid)).toBe(true);
    expect(fixture.cases.some((c) => !c.invalid)).toBe(true);
  });

  it("agrees on the vocabulary itself, in order", () => {
    expect([...CONDITION_NAMES]).toEqual(fixture.names);
    expect(MAX_EXHAUSTION).toBe(fixture.maxExhaustion);
  });

  it("normalizes every accepted set to the agreed spelling and order", () => {
    for (const c of fixture.cases.filter((x) => !x.invalid)) {
      expect(normalizeConditions(c.input), c.name).toEqual(c.normalized);
    }
  });

  it("refuses every set the server would refuse", () => {
    for (const c of fixture.cases.filter((x) => x.invalid)) {
      expect(normalizeConditions(c.input), c.name).toBeNull();
    }
  });
});

describe("canonicalCondition", () => {
  it("accepts every name in the vocabulary as itself", () => {
    for (const n of CONDITION_NAMES) expect(canonicalCondition(n)).toBe(n);
  });

  it("accepts every exhaustion level the rules define, and no others", () => {
    for (let lvl = 1; lvl <= MAX_EXHAUSTION; lvl++) {
      expect(canonicalCondition(`Exhaustion ${lvl}`)).toBe(`Exhaustion ${lvl}`);
    }
    expect(canonicalCondition(`Exhaustion ${MAX_EXHAUSTION + 1}`)).toBeNull();
    expect(canonicalCondition("Exhaustion 0")).toBeNull();
  });

  it("is a closed list — nothing outside it resolves", () => {
    expect(canonicalCondition("Cursed")).toBeNull();
    expect(canonicalCondition("")).toBeNull();
  });
});
