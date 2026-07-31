/*
The initiative order, as the tracker actually walks it.

A mob is ONE entry: monsters added together share an initiative and act on a
single turn, which is what stops a pack of eight skeletons eating eight presses
of "Next turn". The stored turnIndex still points at a row, so the tracker
translates — see EncounterRunner. e2e/encounter.spec.ts holds this to it.
*/
import type { Combatant } from "../../api/client";

/* An entry in the initiative order: either a lone combatant or a whole mob
   taking a single turn. The server already returns members of a group
   consecutively, so folding is just a walk down the list. */
export type Entry = { key: string; groupId: string | null; members: Combatant[] };

export function toEntries(combatants: Combatant[]): Entry[] {
  const entries: Entry[] = [];
  for (const c of combatants) {
    const last = entries[entries.length - 1];
    if (c.groupId && last && last.groupId === c.groupId) {
      last.members.push(c);
      continue;
    }
    entries.push({ key: c.groupId ?? c.id, groupId: c.groupId ?? null, members: [c] });
  }
  return entries;
}

/* "Skeleton 4" → "Skeleton". Members are numbered on the way in, so the mob's
   shared name is any member's label without its ordinal. */
export const mobName = (label: string) => label.replace(/\s+\d+$/, "");
