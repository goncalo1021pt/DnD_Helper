/*
The Buy button's half of the till (#174), in the campaign's own coin (#195).

Mirrors priceBase and formatCoins in backend/internal/http/money.go — the
server is the one that actually charges; this exists so the button can say
"not enough" without a round trip, and fixtures/rules/price-coins.json keeps
the two honest.

Everything is in BASE units, the ladder's smallest coin, because that is the
only unit every price and every purse can be stated in exactly. A sub-base
remainder rounds UP: the shopkeeper's handling fee. Anything unshaped like a
cost ("a favor owed", ""), or named in a coin this table does not use, is null
— legal on a shelf, not chargeable.
*/

export interface Coin {
  name: string;
  abbrev: string;
  /** In base units, so the smallest coin is always 1. */
  value: number;
}

/** What every table had before a DM could say otherwise. */
export const STANDARD_COINAGE: Coin[] = [
  { name: "Copper Pieces", abbrev: "cp", value: 1 },
  { name: "Silver Pieces", abbrev: "sp", value: 10 },
  { name: "Electrum Pieces", abbrev: "ep", value: 50 },
  { name: "Gold Pieces", abbrev: "gp", value: 100 },
  { name: "Platinum Pieces", abbrev: "pp", value: 1000 },
];

/** A campaign's ladder, smallest first. An absent one is the standard. */
export function coinageOf(coins: Coin[] | null | undefined): Coin[] {
  if (!coins || coins.length === 0) return STANDARD_COINAGE;
  return [...coins].sort((a, b) => a.value - b.value);
}

// A number — with optional thousands commas and fraction — and one coin. The
// coin is matched against the ladder afterwards, because it is the campaign's
// to name.
const priceShape = /^(\d{1,3}(?:,\d{3})*)(?:\.(\d+))?\s?(\p{L}{1,16})$/u;

/** A price in base units, or null when the till cannot charge it. */
export function priceBase(price: string, ladder: Coin[] = STANDARD_COINAGE): number | null {
  const m = priceShape.exec(price.trim().toLowerCase());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > 6) return null;
  const coin = ladder.find(
    (c) => c.abbrev.toLowerCase() === m[3] || c.name.toLowerCase() === m[3],
  );
  if (!coin) return null;
  const whole = Number(m[1].replaceAll(",", ""));
  if (!Number.isSafeInteger(whole) || whole > 100_000_000) return null;
  const scale = 10 ** frac.length;
  const f = frac === "" ? 0 : Number(frac);
  const num = (whole * scale + f) * coin.value;
  // Exact ceiling division: all operands are true integers well under 2^53,
  // and (num - num % scale) / scale divides evenly, so no float creeps in.
  const rem = num % scale;
  const base = (num - rem) / scale;
  return rem === 0 ? base : base + 1;
}

/** The rung a table talks in: gold where there is gold, the largest otherwise. */
export function goldRung(ladder: Coin[]): number {
  const i = ladder.findIndex((c) => c.abbrev.toLowerCase() === "gp");
  return i >= 0 ? i : ladder.length - 1;
}

/**
 * How many of each coin an amount of base units comes to, one entry per rung,
 * SMALLEST first — the order the official sheet's five cells run in.
 *
 * It counts down from the coin the table TALKS in rather than from the top of
 * the ladder, and the rungs above stay empty. Forty gold pieces are forty gold
 * pieces; no table converts them up and calls it four platinum, and a purse
 * that did would be arithmetically right and useless to read.
 */
export function coinCounts(base: number, ladder: Coin[] = STANDARD_COINAGE): number[] {
  const coins = coinageOf(ladder);
  const out = new Array<number>(coins.length).fill(0);
  if (base <= 0) return out;
  let left = base;
  for (let i = goldRung(coins); i >= 0; i--) {
    out[i] = Math.floor(left / coins[i].value);
    left -= out[i] * coins[i].value;
  }
  return out;
}

/**
 * An amount of base units as the coins a table counts in, largest first,
 * skipping the rungs that come to nothing: "4 crn 1 glm 2 shd". Zero is the
 * smallest coin rather than nothing at all — an empty purse still has a name.
 */
export function formatCoins(base: number, ladder: Coin[] = STANDARD_COINAGE): string {
  const coins = coinageOf(ladder);
  if (base <= 0) return `0 ${coins[0].abbrev}`;
  const counts = coinCounts(base, coins);
  const parts: string[] = [];
  for (let i = coins.length - 1; i >= 0; i--) {
    if (counts[i] > 0) parts.push(`${counts[i]} ${coins[i].abbrev}`);
  }
  return parts.join(" ");
}
