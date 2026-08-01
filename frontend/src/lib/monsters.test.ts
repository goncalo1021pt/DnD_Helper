import { describe, expect, it } from "vitest";
import { crValueOfLabel } from "./monsters";

/*
The number behind the written CR (#127).

`cr` is prose and `crValue` is what the Den sorts on, what the band filter
reads, and what the difficulty meter falls back to when a creature states no
XP. A homebrew whose written CR says 5 while crValue still says 0.25 sorts
among the rats and weighs a fight at 50 XP — silently, on a screen where both
look right.
*/
describe("reading a CR out of what a DM typed", () => {
  it("reads the fractions", () => {
    expect(crValueOfLabel("1/8")).toBe(0.125);
    expect(crValueOfLabel("1/4")).toBe(0.25);
    expect(crValueOfLabel("1/2")).toBe(0.5);
  });

  it("reads a whole number, and ignores everything after it", () => {
    expect(crValueOfLabel("5")).toBe(5);
    expect(crValueOfLabel("17 (XP 18,000, or 20,000 in lair; PB +6)")).toBe(17);
    expect(crValueOfLabel("1/4 (XP 50; PB +2)")).toBe(0.25);
  });

  it("survives the states a field passes through while being typed in", () => {
    expect(crValueOfLabel("")).toBe(0);
    expect(crValueOfLabel("   ")).toBe(0);
    expect(crValueOfLabel("1/")).toBe(0);
    expect(crValueOfLabel("wyrm")).toBe(0);
    expect(crValueOfLabel("1/0")).toBe(0); // not Infinity
    expect(crValueOfLabel("-3")).toBe(0);
  });
});
