/*
Will this fight flatten the party? (#110)

The DM builds an encounter with no signal about its weight, and finds out at the
table. Everything needed to say is already on screen — every creature carries
its XP, and the seated party's levels are known — so this turns it into a number
that moves as monsters go in and out.

## Which edition

The 2024 rules, because everything else here is: SRD 5.2 monsters, the 2024
class tables, 2024 species choices. The issue asked for the 2014 shape — easy /
medium / hard / deadly, with a multiplier for the number of creatures — and
shipping that against 2024 monsters would make encounter maths the only 2014
thing in the app.

The 2024 system is simpler and says the same thing differently: three bands
instead of four, a budget per character rather than a threshold, and no
multiplier at all. Action economy is folded into the budgets rather than applied
as a separate factor.

## Where the XP comes from

Not from a CR-to-XP table. Every SRD monster states its own XP in its `cr`
string — "1/4 (XP 50; PB +2)" — and that is what the book says for that
creature, which is not always what the table says for that CR. Two real cases in
the shipped data:

  - CR 0 splits: most CR 0 creatures are worth 10 XP, but the two that cannot
    meaningfully fight back — the Seahorse and the Shrieker Fungus — are worth 0.
  - The Archmage is CR 12 and states 8,000 XP, where the CR 12 row says 8,400.

A table would silently "correct" both. The per-creature value is read first, and
the table is only a fallback for homebrew that states a CR and no XP.
*/

import type { RulesContent } from "../api/client";

/** The three bands a 2024 encounter falls into, plus "nothing worth counting". */
export type DifficultyBand = "trivial" | "low" | "moderate" | "high";

export interface PartyBudget {
  low: number;
  moderate: number;
  high: number;
}

/**
 * XP budget per character, by level (2024 DMG, "Creating Encounters").
 *
 * Index 0 is unused so the level reads as the index. These twenty rows are the
 * only numbers here that cannot be checked against anything in the repo — the
 * SRD carries monsters, not the DMG's encounter tables — so they are stated
 * once, here, and nowhere else.
 */
const XP_BUDGET: ReadonlyArray<PartyBudget> = [
  { low: 0, moderate: 0, high: 0 }, // level 0 — unused
  { low: 50, moderate: 75, high: 100 },
  { low: 100, moderate: 150, high: 200 },
  { low: 150, moderate: 225, high: 400 },
  { low: 250, moderate: 375, high: 500 },
  { low: 500, moderate: 750, high: 1100 },
  { low: 600, moderate: 1000, high: 1400 },
  { low: 750, moderate: 1300, high: 1700 },
  { low: 1000, moderate: 1700, high: 2100 },
  { low: 1300, moderate: 2000, high: 2600 },
  { low: 1600, moderate: 2300, high: 3100 },
  { low: 1900, moderate: 2900, high: 4100 },
  { low: 2200, moderate: 3700, high: 4700 },
  { low: 2600, moderate: 4200, high: 5400 },
  { low: 2900, moderate: 4900, high: 6200 },
  { low: 3300, moderate: 5400, high: 7800 },
  { low: 3800, moderate: 6100, high: 9800 },
  { low: 4500, moderate: 7200, high: 11700 },
  { low: 5000, moderate: 8700, high: 14200 },
  { low: 5500, moderate: 10700, high: 17200 },
  { low: 6400, moderate: 13200, high: 22000 },
];

/** Standard XP by challenge rating — the fallback when a creature states none. */
const XP_BY_CR: Readonly<Record<number, number>> = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
  1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
  9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000,
  23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000,
  29: 135000, 30: 155000,
};

/**
 * What one creature is worth.
 *
 * Both orderings the SRD actually uses are read — "XP 50" on 326 of the 330
 * shipped creatures, "450 XP" on the other four. A creature in a lair states
 * two numbers ("XP 18,000, or 20,000 in lair"); the first one wins, because the
 * lair bonus is a choice the DM makes, not a property of the monster.
 */
export function monsterXP(m: RulesContent | undefined): number {
  const data = (m?.data ?? {}) as { cr?: string; crValue?: number };
  const cr = data.cr ?? "";
  const stated = /XP\s*([\d,]+)/i.exec(cr) ?? /([\d,]+)\s*XP/i.exec(cr);
  if (stated) return Number(stated[1].replace(/,/g, ""));
  // Homebrew that gave a CR and no XP still gets a weight.
  return XP_BY_CR[data.crValue ?? -1] ?? 0;
}

/** What the party can take, summed over everyone who is actually turning up. */
export function partyBudget(levels: number[]): PartyBudget {
  return levels.reduce<PartyBudget>(
    (total, level) => {
      const row = XP_BUDGET[Math.min(Math.max(Math.round(level), 1), 20)];
      return {
        low: total.low + row.low,
        moderate: total.moderate + row.moderate,
        high: total.high + row.high,
      };
    },
    { low: 0, moderate: 0, high: 0 },
  );
}

/**
 * Which band a total lands in.
 *
 * The bands are floors, not ranges: a fight at or above the high budget is
 * still "high" — there is no band above it, and a DM who has built something
 * enormous can see that from the numbers. Below the low budget is "trivial",
 * which the 2024 rules do not name but a DM still wants told.
 */
export function bandFor(totalXP: number, budget: PartyBudget): DifficultyBand {
  if (budget.low === 0 || totalXP <= 0) return "trivial";
  if (totalXP >= budget.high) return "high";
  if (totalXP >= budget.moderate) return "moderate";
  if (totalXP >= budget.low) return "low";
  return "trivial";
}

export interface Difficulty {
  totalXP: number;
  budget: PartyBudget;
  band: DifficultyBand;
  /** 0–1 across the bar, where 1 is the high budget. Clamped for the meter. */
  fraction: number;
}

/**
 * The whole answer for one encounter.
 *
 * `counts` is how many of each creature are in the fight, so a mob of eight
 * skeletons is eight times a skeleton — the thing a DM most often gets wrong by
 * eye, and the reason this exists at all.
 */
export function encounterDifficulty(
  creatures: Array<{ monster: RulesContent | undefined; count: number }>,
  levels: number[],
): Difficulty {
  const totalXP = creatures.reduce((sum, c) => sum + monsterXP(c.monster) * c.count, 0);
  const budget = partyBudget(levels);
  return {
    totalXP,
    budget,
    band: bandFor(totalXP, budget),
    fraction: budget.high > 0 ? Math.min(totalXP / budget.high, 1) : 0,
  };
}
