/* One reader for every term (#285). */
import { useSyncExternalStore } from "react";
import type { RulesContent } from "../../api/client";
import ContentEntry from "./ContentEntry";
import ParchmentModal from "./ParchmentModal";
import SpellEntry from "./SpellEntry";

/*
A term pressed anywhere — a condition on a chip, a spell in a stat block —
opens the entry it names here, in one dialog mounted at the root, rather than
in a dialog the term itself owns. The difference shows inside a hover card:
a dialog owned by a term inside the card is torn down with the card the
moment the pointer leaves it, which is the moment the dialog opens. The
reader belongs to nobody's card, so it stays.
*/

let current: RulesContent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function snapshot() {
  return current;
}

/** Open the reader on an entry. */
export function openReader(entry: RulesContent) {
  current = entry;
  notify();
}
export function closeReader() {
  current = null;
  notify();
}

export default function Reader() {
  const entry = useSyncExternalStore(subscribe, snapshot);
  if (!entry) return null;
  return (
    <ParchmentModal onClose={closeReader} maxWidth="max-w-[460px]">
      {/* The dialog scrolls itself, so the entry text keeps no box of its own. */}
      {entry.kind === "spell" ? (
        <SpellEntry spell={entry} />
      ) : (
        <ContentEntry entry={entry} scroll={false} />
      )}
    </ParchmentModal>
  );
}
