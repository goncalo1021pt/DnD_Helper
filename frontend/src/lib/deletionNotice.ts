/*
 * A scheduled deletion signs the account out of every browser (#322), and the
 * app answers by taking the person to the front door. The day they have to
 * come back by would be lost on the way, so it rides in sessionStorage: the
 * landing page reads it, and entering the tavern again — which IS the cancel —
 * forgets it.
 */

const KEY = "qb.deletionScheduled";

export function rememberDeletion(scheduledFor: string): void {
  try {
    sessionStorage.setItem(KEY, scheduledFor);
  } catch {
    /* private mode: the modal already said it, the mail says it again */
  }
}

export function readDeletion(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetDeletion(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}

export function deletionDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
