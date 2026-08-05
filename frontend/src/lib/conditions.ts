/*
What a combatant can be suffering (#173).

The client half of the condition vocabulary. Its Go twin is
backend/internal/http/conditions.go, which is the authority — this exists so the
DM's picker can draw its chips without a round-trip, and so the tracker can sort
what the server sent without re-asking what order things go in.

Both engines answer fixtures/rules/conditions.json (#112). Changing the list on
one side alone fails the other side's tests, which is the point: a picker that
offers a condition the server rejects fails mid-fight, with the table waiting.
*/

/** Every condition, in the order the picker shows them. */
export const CONDITION_NAMES = [
  "Concentrating",
  "Blinded",
  "Charmed",
  "Deafened",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
] as const;

/** The level at which a hero dies, and so the highest the tracker can hold. */
export const MAX_EXHAUSTION = 6;

const ORDER = new Map<string, number>(CONDITION_NAMES.map((n, i) => [n, i]));

/**
 * Resolve one written condition to its canonical spelling, or null if there is
 * no such thing. Case and stray space are forgiven; a misspelling is not.
 */
export function canonicalCondition(raw: string): string | null {
  const name = raw.trim().split(/\s+/).join(" ");
  if (!name) return null;
  const known = CONDITION_NAMES.find((c) => c.toLowerCase() === name.toLowerCase());
  if (known) return known;
  const exhaustion = /^exhaustion\s+(\d+)$/i.exec(name);
  if (exhaustion) {
    const lvl = parseInt(exhaustion[1], 10);
    if (lvl >= 1 && lvl <= MAX_EXHAUSTION) return `Exhaustion ${lvl}`;
  }
  return null;
}

/** The level of an "Exhaustion N" chip, or 0 for anything else. */
export function exhaustionLevel(condition: string): number {
  const m = /^Exhaustion (\d+)$/.exec(condition);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Canonicalise a set: every name resolved, duplicates dropped, one stable
 * order. Returns null if any entry is not a condition — the server would refuse
 * the whole set, so the client refuses it the same way rather than sending
 * something it knows will bounce.
 *
 * Exhaustion collapses to the highest level present and always sorts last.
 */
export function normalizeConditions(raw: string[]): string[] | null {
  const seen = new Set<string>();
  let exhaustion = 0;
  const out: string[] = [];
  for (const r of raw) {
    const name = canonicalCondition(r);
    if (name === null) return null;
    const lvl = exhaustionLevel(name);
    if (lvl > 0) {
      exhaustion = Math.max(exhaustion, lvl);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  out.sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
  if (exhaustion > 0) out.push(`Exhaustion ${exhaustion}`);
  return out;
}
