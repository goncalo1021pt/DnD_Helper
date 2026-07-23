/** 2024 XP thresholds: total XP required to REACH each level (index = level). */
const XP_THRESHOLDS = [
  0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

/** XP needed to reach the NEXT level, or null at the cap. */
export function nextLevelXP(level: number): number | null {
  if (level >= 20) return null;
  return XP_THRESHOLDS[level + 1];
}

/** Advisory: has this hero banked enough XP for their next level? */
export function readyToLevel(xp: number, level: number): boolean {
  const next = nextLevelXP(level);
  return next !== null && xp >= next;
}

/**
 * Why this hero cannot level up right now, or null when the road is clear.
 * Mirrors the server's gates so the Level up button never lies: the table's
 * ceiling first, then the milestone allowance (XP tables gate on XP alone).
 */
export function levelUpHold(
  character: { level: number; pendingLevels?: number | null; campaignId?: string | null },
  table: { progression?: "milestone" | "xp"; maxLevel?: number | null } | undefined,
): string | null {
  if (!character.campaignId || !table) return null; // resting heroes rise freely
  if (table.maxLevel != null && character.level >= table.maxLevel) {
    return `at the table's ceiling — level ${table.maxLevel}`;
  }
  if ((table.progression ?? "milestone") !== "xp" && (character.pendingLevels ?? 0) < 1) {
    return "waiting on the DM's milestone";
  }
  return null;
}
