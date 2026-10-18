import type { InventoryItem } from "../api/client";

/*
The data an inventory row plays by (#396): the armory entry's when the row is
linked to one, or the row's own when it was written in with stats. Everything
that reads an item — armor class, attack lines, which slot it fits, what the
tile prints — goes through here, so a sword the hero wrote in is a sword to all
of them.
*/
export function itemDataOf(it: Pick<InventoryItem, "content" | "customData">): Record<string, unknown> {
  return (it.content?.data ?? it.customData ?? {}) as Record<string, unknown>;
}

/** Whether the row has stats to play by at all — an entry's or its own. */
export function hasItemData(it: Pick<InventoryItem, "content" | "customData">): boolean {
  return Boolean(it.content) || Boolean(it.customData);
}
