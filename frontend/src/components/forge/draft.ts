/*
The Forge remembers where you were (#130, part 3).

The last piece of the network bug. The reported symptom was three things
stacked: a button that thought forever, a retry that never worked, and — the
part that actually cost the twenty minutes — "the moment you reload it will have
gone to the start and you have to reintroduce everything".

The deadline (#137) removed the reason players were reloading. This removes the
punishment for doing it anyway, which is a different promise: a closed tab, a
flat phone, a browser that decided to update itself mid-session.

Kept deliberately dumb. One key, one JSON blob, written on every change and read
once on mount. No migration story: a draft is minutes old and worth nothing if
its shape has moved on, so a stored version that does not match is dropped
rather than guessed at. The alternative — reviving a half-shaped draft into a
wizard that has since gained a step — is how you get a hero with no species and
no way to notice.
*/

/** Bumped whenever the wizard's state shape changes. Older drafts are discarded. */
const VERSION = 1;
const KEY = "questboard.forge.draft";

/** A draft older than this is not what the player was doing. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ForgeDraft {
  step: number;
  classId: string;
  gear: string;
  skills: string[];
  spellIds: string[];
  backgroundId: string;
  speciesId: string;
  speciesPicks: Record<string, string[]>;
  method: string;
  base: Record<string, number>;
  bonusMode: string;
  bonus2: string;
  bonus1: string;
  name: string;
  tableId: string;
}

interface Stored {
  version: number;
  savedAt: number;
  draft: ForgeDraft;
}

/** True when the player has actually chosen something worth keeping. */
export function worthSaving(d: ForgeDraft): boolean {
  return !!(d.classId || d.speciesId || d.backgroundId || d.name.trim());
}

export function saveDraft(d: ForgeDraft): void {
  try {
    if (!worthSaving(d)) return void clearDraft();
    const stored: Stored = { version: VERSION, savedAt: Date.now(), draft: d };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // A full or disabled localStorage is not a reason to break the Forge.
  }
}

export function loadDraft(): ForgeDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (stored?.version !== VERSION) return null;
    if (!stored.savedAt || Date.now() - stored.savedAt > MAX_AGE_MS) return null;
    return worthSaving(stored.draft) ? stored.draft : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
