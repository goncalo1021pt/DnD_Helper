import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diceExpression, poolRange, rollPool, type DicePool } from "./dice";

/*
The TypeScript half of the dice pool's contract (#176). Its Go twin is
backend/internal/http/dice_test.go; the fixture keeps the tower and the
server writing the same expression for the same pool.
*/

interface PoolCase {
  name: string;
  pool: DicePool;
  expression: string;
  min: number | null;
  max: number | null;
}

const cases: PoolCase[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/rules/dice-pool.json", import.meta.url), "utf8"),
).cases;

describe("the shared dice fixture", () => {
  it("covers rollable pools and refusals both", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.filter((c) => c.expression === "").length).toBeGreaterThanOrEqual(3);
  });

  it("agrees with diceExpression on every case", () => {
    for (const c of cases) {
      expect(diceExpression(c.pool), c.name).toBe(c.expression);
    }
  });

  it("agrees on what a pool can land on", () => {
    for (const c of cases) {
      const range = poolRange(c.pool);
      expect(range?.min ?? null, c.name).toBe(c.min);
      expect(range?.max ?? null, c.name).toBe(c.max);
    }
  });
});

describe("rolling a pool", () => {
  it("returns nothing for a pool the tower will not roll", () => {
    expect(rollPool({ groups: [], modifier: 3 })).toBeNull();
    expect(rollPool({ groups: [{ count: 1, sides: 7 }], modifier: 0 })).toBeNull();
  });

  it("stays inside the range it promised, over many rolls", () => {
    const pool: DicePool = {
      groups: [{ count: 2, sides: 6 }, { count: 1, sides: 8 }],
      modifier: 3,
    };
    const range = poolRange(pool)!;
    for (let i = 0; i < 500; i++) {
      const result = rollPool(pool)!;
      expect(result.total).toBeGreaterThanOrEqual(range.min);
      expect(result.total).toBeLessThanOrEqual(range.max);
      expect(result.groups.flatMap((g) => g.results)).toHaveLength(3);
    }
  });

  it("rolls one die per count, with every face in range", () => {
    const result = rollPool({ groups: [{ count: 8, sides: 6 }], modifier: 0 }, () => 0.5)!;
    expect(result.groups[0].results).toHaveLength(8);
    expect(result.total).toBe(8 * 4); // 0.5 → floor(0.5*6)+1 = 4
    expect(result.expression).toBe("8d6");
  });

  it("calls a natural 20 and a natural 1, but only on a lone d20", () => {
    const nat20 = rollPool({ groups: [{ count: 1, sides: 20 }], modifier: 0 }, () => 0.999)!;
    expect(nat20.crit).toBe(true);
    expect(nat20.fail).toBe(false);

    const nat1 = rollPool({ groups: [{ count: 1, sides: 20 }], modifier: 0 }, () => 0)!;
    expect(nat1.fail).toBe(true);

    // Two d20s in the pool is not a d20 test — nothing is called.
    const pair = rollPool({ groups: [{ count: 2, sides: 20 }], modifier: 0 }, () => 0.999)!;
    expect(pair.crit).toBe(false);
    // Nor is a d20 rolled alongside something else.
    const mixed = rollPool(
      { groups: [{ count: 1, sides: 20 }, { count: 1, sides: 6 }], modifier: 0 },
      () => 0.999,
    )!;
    expect(mixed.crit).toBe(false);
  });

  it("keeps the modifier out of the dice and in the total", () => {
    const result = rollPool({ groups: [{ count: 1, sides: 20 }], modifier: -2 }, () => 0.999)!;
    expect(result.groups[0].results[0]).toBe(20);
    expect(result.total).toBe(18);
    expect(result.expression).toBe("1d20 − 2");
  });
});
