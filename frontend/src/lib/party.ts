/** Shared party-roster presentation helpers (roster page + dashboard block). */

/* Medallion gradients (from the Emberhall reference); picked by a stable hash. */
const MEDALLIONS = [
  "linear-gradient(140deg,#6b3f2a,#3a2113)",
  "linear-gradient(140deg,#5a3a63,#2f1e36)",
  "linear-gradient(140deg,#3f5530,#22301a)",
  "linear-gradient(140deg,#2f4a55,#16282f)",
  "linear-gradient(140deg,#6a2f2f,#371616)",
  "linear-gradient(140deg,#4a4030,#27210f)",
];

export function medallionFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return MEDALLIONS[h % MEDALLIONS.length];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/* HP color by remaining fraction: healthy sage, worn gold, dying wax-red. */
export function hpColor(current: number, max: number): string {
  const pct = max > 0 ? current / max : 0;
  if (pct > 0.6) return "#4d6b39";
  if (pct > 0.3) return "#b07a2e";
  return "#8b2520";
}
