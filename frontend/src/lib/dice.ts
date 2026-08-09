/*
The dice pool (#176). A pool is die groups plus one flat modifier — "1d4 +
2d8 + 3" — composed in the moment rather than saved: a combo is what this
spell needs right now, not a thing to name and keep.

Mirrors diceExpression / rollPool in backend/internal/http/dice.go, and
fixtures/rules/dice-pool.json holds the two to the same spelling. That
agreement matters more here than in most mirrors: the browser composes the
pool and the *server* rolls it when the roll is public, so a disagreement
would put one expression on your screen and a different one in the log.
*/

/** The dice the tower carries. A coin is a d2, because it is. */
export const DIE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;

/** No table rolls more than this at once, and no modifier reaches this far. */
export const MAX_DICE = 100;
export const MAX_MODIFIER = 100;

export interface DieGroup {
  count: number;
  sides: number;
}

export interface DicePool {
  groups: DieGroup[];
  modifier: number;
}

export interface RolledGroup {
  sides: number;
  results: number[];
}

export interface PoolResult {
  expression: string;
  groups: RolledGroup[];
  modifier: number;
  total: number;
  /** A lone d20 landing on 20 or 1 — the only roll the tower calls out. */
  crit: boolean;
  fail: boolean;
}

/**
 * Merge same-sided groups and drop the empty ones, largest die first — so a
 * pool built by tapping d6 four times then twice more reads "6d6", and the
 * order of tapping never changes the expression.
 */
export function normalizePool(pool: DicePool): DieGroup[] {
  const bySides = new Map<number, number>();
  for (const g of pool.groups) {
    if (!Number.isInteger(g.count) || g.count <= 0) continue;
    if (!DIE_SIDES.includes(g.sides as (typeof DIE_SIDES)[number])) continue;
    bySides.set(g.sides, (bySides.get(g.sides) ?? 0) + g.count);
  }
  return [...bySides.entries()]
    .map(([sides, count]) => ({ sides, count }))
    .sort((a, b) => b.sides - a.sides);
}

/** True when the pool is something the tower will actually roll. */
export function poolIsRollable(pool: DicePool): boolean {
  const groups = normalizePool(pool);
  if (groups.length === 0) return false;
  const dice = groups.reduce((n, g) => n + g.count, 0);
  if (dice > MAX_DICE) return false;
  if (!Number.isInteger(pool.modifier) || Math.abs(pool.modifier) > MAX_MODIFIER) return false;
  return true;
}

/**
 * How a pool is written: "2d6 + 1d8 + 3". Empty when the pool is not
 * rollable, which is also how a caller asks "is this anything?".
 *
 * The minus is a true minus sign (−), matching how the sheet already writes
 * negative modifiers.
 */
export function diceExpression(pool: DicePool): string {
  if (!poolIsRollable(pool)) return "";
  const parts = normalizePool(pool).map((g) => `${g.count}d${g.sides}`);
  let out = parts.join(" + ");
  if (pool.modifier > 0) out += ` + ${pool.modifier}`;
  if (pool.modifier < 0) out += ` − ${Math.abs(pool.modifier)}`;
  return out;
}

/** The lowest and highest a pool can land on; null when it is not rollable. */
export function poolRange(pool: DicePool): { min: number; max: number } | null {
  if (!poolIsRollable(pool)) return null;
  const groups = normalizePool(pool);
  return {
    min: groups.reduce((n, g) => n + g.count, 0) + pool.modifier,
    max: groups.reduce((n, g) => n + g.count * g.sides, 0) + pool.modifier,
  };
}

/**
 * Roll a pool here in the browser. This is the private roll — a public one
 * is rolled by the server, so that a feed everyone reads cannot be composed
 * by the client that benefits from it.
 */
export function rollPool(pool: DicePool, rng: () => number = Math.random): PoolResult | null {
  if (!poolIsRollable(pool)) return null;
  const groups = normalizePool(pool).map((g) => ({
    sides: g.sides,
    results: Array.from({ length: g.count }, () => 1 + Math.floor(rng() * g.sides)),
  }));
  const rolled = groups.reduce((n, g) => n + g.results.reduce((a, b) => a + b, 0), 0);
  const lone20 =
    groups.length === 1 && groups[0].sides === 20 && groups[0].results.length === 1;
  return {
    expression: diceExpression(pool),
    groups,
    modifier: pool.modifier,
    total: rolled + pool.modifier,
    crit: lone20 && groups[0].results[0] === 20,
    fail: lone20 && groups[0].results[0] === 1,
  };
}

/** "8, 3, 2" — every face that came up, in the order rolled. */
export function facesOf(result: PoolResult): string {
  return result.groups.flatMap((g) => g.results).join(", ");
}
