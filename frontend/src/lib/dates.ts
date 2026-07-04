/**
 * House date rules: dd/mm order and a 24h clock, always (the table is
 * Portuguese). English day names to match the app's copy. No locale
 * detection — the browser's idea of a date format is not welcome here.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "Sat 12/07 · 19:00" (year appended as /2027 only when it isn't this year). */
export function formatWhen(d: Date): string {
  const year =
    d.getFullYear() === new Date().getFullYear() ? "" : `/${d.getFullYear()}`;
  return `${DAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${year} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "yyyy-MM-ddTHH:mm" in local time, for <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface CountdownParts {
  days: number;
  hours: number;
  mins: number;
  past: boolean;
}

export function countdownParts(target: Date, now: number): CountdownParts {
  const diff = target.getTime() - now;
  if (diff <= 0) return { days: 0, hours: 0, mins: 0, past: true };
  const mins = Math.floor(diff / 60_000);
  return {
    days: Math.floor(mins / 1440),
    hours: Math.floor((mins % 1440) / 60),
    mins: mins % 60,
    past: false,
  };
}
