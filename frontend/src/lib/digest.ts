/*
 * The daily digest's hour (#339). The server keeps it as a UTC hour and the
 * profile shows it in the reader's own zone: the options ARE the 24 UTC hours,
 * each labelled with the local time it strikes today, so a half-hour zone
 * still gets a true label and nothing is converted by arithmetic that daylight
 * saving would break. (The hour is stored in UTC, so it shifts by one local
 * hour across a clock change — said on the settings, not hidden.)
 */

/** The local time a UTC hour strikes today, as a person reads it. */
export function localLabel(utcHour: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Every UTC hour with its local label, ordered by the hour the reader lives it. */
export function hourOptions(now: Date = new Date()): { utc: number; label: string }[] {
  return Array.from({ length: 24 }, (_, utc) => ({ utc, label: localLabel(utc, now) }));
}

export const DEFAULT_DIGEST_HOUR = 18;
