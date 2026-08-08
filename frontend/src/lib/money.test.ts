import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priceGp } from "./money";

/*
The TypeScript half of the till's contract (#174). Its Go twin is
backend/internal/http/money_test.go; the fixture keeps them agreeing on what
a free-text price is worth in whole gold — and on what is refused.
*/

interface PriceCase {
  name: string;
  price: string;
  gp: number | null;
}

const cases: PriceCase[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/price-gold.json", import.meta.url), "utf8"),
).cases;

describe("the shared price fixture", () => {
  it("covers charges and refusals both", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.filter((c) => c.gp === null).length).toBeGreaterThanOrEqual(3);
    expect(cases.some((c) => c.gp === 0)).toBe(true); // free is free
  });

  it("agrees with priceGp on every case", () => {
    for (const c of cases) {
      expect(priceGp(c.price), c.name).toBe(c.gp);
    }
  });
});
