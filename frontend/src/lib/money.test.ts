import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coinageOf, formatCoins, priceBase, STANDARD_COINAGE, type Coin } from "./money";

/*
Read at RUNTIME rather than imported, exactly as #174's test did. The container
build runs `tsc` over the frontend alone, with no `fixtures/` in its context —
an import would resolve here and fail the image build.
*/
interface Contract {
  standard: Coin[];
  invented: Coin[];
  cases: { name: string; ladder: string; price: string; base: number | null }[];
  purses: { name: string; ladder: string; base: number; coins: string }[];
}
const contract: Contract = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/price-coins.json", import.meta.url), "utf8"),
);

/*
Two implementations of money is a thing worth being nervous about, so the
contract is the only place either may be changed from. If this file and
backend/internal/http/money_test.go do not both pass, the Buy button and the
till disagree about what a hero can afford.
*/

const LADDERS: Record<string, Coin[]> = {
  standard: contract.standard,
  invented: contract.invented,
};

describe("the till, in the campaign's own coin", () => {
  it("has cases to answer for", () => {
    expect(contract.cases.length).toBeGreaterThan(0);
    expect(contract.purses.length).toBeGreaterThan(0);
  });

  it("agrees with priceBase on every case", () => {
    for (const c of contract.cases) {
      expect(priceBase(c.price, LADDERS[c.ladder]), c.name).toBe(c.base);
    }
  });

  it("agrees with formatCoins on every purse", () => {
    for (const p of contract.purses) {
      expect(formatCoins(p.base, LADDERS[p.ladder]), p.name).toBe(p.coins);
    }
  });

  it("reads an absent ladder as the standard one", () => {
    expect(coinageOf(null)).toEqual(STANDARD_COINAGE);
    expect(coinageOf([])).toEqual(STANDARD_COINAGE);
    expect(priceBase("15 gp")).toBe(1500);
  });

  it("sorts a ladder smallest-first however it arrives", () => {
    const jumbled: Coin[] = [
      { name: "Crown", abbrev: "crn", value: 100 },
      { name: "Shard", abbrev: "shd", value: 1 },
    ];
    expect(coinageOf(jumbled).map((c) => c.abbrev)).toEqual(["shd", "crn"]);
  });
});
