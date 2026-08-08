/*
The Buy button's half of the till (#174). Gold only, on purpose.

Mirrors priceGP in backend/internal/http/money.go — the server is the one
that actually charges; this exists so the button can say "not enough gold"
without a round trip, and fixtures/rules/price-gold.json keeps the two
honest. Sub-gold remainders round UP: the shopkeeper's handling fee.
Anything unshaped like a cost ("a favor owed", "") is null — legal on a
shelf, not chargeable. Real denominations and DM coin are #195's business.
*/

const priceRe = /^(\d{1,3}(?:,\d{3})*)(?:\.(\d+))?\s?(cp|sp|ep|gp|pp)$/;

// Coin values in gold, as fractions — integer arithmetic only, because money.
const NUM: Record<string, number> = { cp: 1, sp: 1, ep: 1, gp: 1, pp: 10 };
const DEN: Record<string, number> = { cp: 100, sp: 10, ep: 2, gp: 1, pp: 1 };

/** A price in whole gold pieces, or null when the till cannot charge it. */
export function priceGp(price: string): number | null {
  const m = priceRe.exec(price.trim().toLowerCase());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > 6) return null;
  const whole = Number(m[1].replaceAll(",", ""));
  if (!Number.isSafeInteger(whole) || whole > 100_000_000) return null;
  const scale = 10 ** frac.length;
  const f = frac === "" ? 0 : Number(frac);
  const num = (whole * scale + f) * NUM[m[3]];
  const den = scale * DEN[m[3]];
  // Exact ceiling division: all operands are true integers well under 2^53,
  // and (num - num % den) / den divides evenly, so no float rounding creeps in.
  const rem = num % den;
  const gp = (num - rem) / den;
  return rem === 0 ? gp : gp + 1;
}
