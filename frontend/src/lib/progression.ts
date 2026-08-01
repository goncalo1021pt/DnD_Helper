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

/** What is holding a hero at their level, as both engines name it. */
export type LevelUpHold = "ceiling" | "milestone";

/**
 * What stops a seated hero rising, or null when the road is clear.
 *
 * This is the server's gate, repeated — internal/http/levelup.go has the same
 * decision, and fixtures/rules/level-up-gates.json holds the two together. It
 * returns a reason rather than a sentence because the two sides word it
 * differently on purpose: the server raises an error a player reads once, this
 * side writes a line that sits under a disabled button.
 *
 * The ceiling is asked first, and that ordering is the part worth pinning. A
 * hero standing at the table's cap with a milestone already banked is held by
 * the cap; say "milestone" there and the player goes to ask a DM who has
 * already done their part and has nothing to give them.
 */
export function levelUpHoldReason(
  level: number,
  pendingLevels: number,
  progression: "milestone" | "xp",
  maxLevel: number | null,
): LevelUpHold | null {
  if (maxLevel != null && level >= maxLevel) return "ceiling";
  // XP tables gate on XP alone; the allowance is the DM's lever on milestone
  // tables only.
  if (progression !== "xp" && pendingLevels < 1) return "milestone";
  return null;
}

/** The same answer, in the words the button wears. */
export function levelUpHold(
  character: { level: number; pendingLevels?: number | null; campaignId?: string | null },
  table: { progression?: "milestone" | "xp"; maxLevel?: number | null } | undefined,
): string | null {
  if (!character.campaignId || !table) return null; // resting heroes rise freely
  switch (
    levelUpHoldReason(
      character.level,
      character.pendingLevels ?? 0,
      table.progression ?? "milestone",
      table.maxLevel ?? null,
    )
  ) {
    case "ceiling":
      return `at the table's ceiling — level ${table.maxLevel}`;
    case "milestone":
      return "waiting on the DM's milestone";
    default:
      return null;
  }
}
