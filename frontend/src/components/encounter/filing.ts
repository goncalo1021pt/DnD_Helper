
import type { Encounter } from "../../api/client";

/* ═══ Filing: how the library is kept in order ═════════════════════════════ */

export type GroupMode = "tag" | "place" | "none";

export const GROUP_MODES: Array<[GroupMode, string]> = [
  ["tag", "Group by session"],
  ["place", "Group by place"],
  ["none", "No grouping"],
];

export const UNFILED: Record<GroupMode, string> = {
  tag: "Unfiled",
  place: "Nowhere in particular",
  none: "",
};

/**
 * Slice the library into labelled shelves. Encounters keep their newest-first
 * order inside a shelf; the shelves themselves sort naturally, so "Session 2"
 * lands before "Session 10", and whatever is unfiled sits at the bottom rather
 * than going missing.
 */
export function shelve(list: Encounter[], mode: GroupMode): Array<[string, Encounter[]]> {
  if (mode === "none") return list.length > 0 ? [["", list]] : [];
  const shelves = new Map<string, Encounter[]>();
  for (const e of list) {
    const key = (mode === "tag" ? e.tag : (e.locationName ?? "")).trim();
    shelves.set(key, [...(shelves.get(key) ?? []), e]);
  }
  return [...shelves.entries()]
    .sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([key, group]) => [key || UNFILED[mode], group] as [string, Encounter[]]);
}
