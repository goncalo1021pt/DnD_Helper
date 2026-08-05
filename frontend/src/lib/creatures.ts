/*
Molding a creature, as a pure function.

The editor shows the numbers as *played* — the merged block — because that is
what a player recognises. But "I left this field alone" has to mean "don't
touch it", and from the merged block alone that is undecidable: a 14 in the AC
box might be the book's 14 or a hand-set one, and guessing wrong either freezes
a number that should follow the hero's level or quietly discards a houserule.

So the patch is built from three things: the values the form opened with, the
values it holds now, and the override map the server sent unmerged. Only a
field that moved off its seed counts as an edit; everything else is copied
through untouched. Clearing an edited field deletes its override, which is how
a number is handed back to the book.

This lives here rather than in the panel because it is the one part of the
feature that is easy to get wrong and easy to test.
*/

export const MOLDABLE_FIELDS: Array<[string, string]> = [
  ["ac", "AC"],
  ["hp", "HP"],
  ["speed", "Speed"],
  ["cr", "CR"],
];

export const MOLDABLE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

/** Fields the books write as prose — "40 ft.", "1/4" — and must not be numbers. */
const PROSE = new Set(["speed", "cr"]);

/** The form's starting values, read off the block the hero currently plays. */
export function moldSeed(block: Record<string, unknown>): Record<string, string> {
  const seed: Record<string, string> = {};
  for (const [key] of MOLDABLE_FIELDS) {
    const value = block[key];
    seed[key] = value == null ? "" : String(value);
  }
  const abilities = (block.abilities ?? {}) as Record<string, unknown>;
  for (const ab of MOLDABLE_ABILITIES) {
    seed[ab] = abilities[ab] == null ? "" : String(abilities[ab]);
  }
  return seed;
}

/**
 * The override map to send, given what the form opened with, what it holds
 * now, and what was already molded.
 */
export function moldPatch(
  existing: Record<string, unknown> | undefined,
  seed: Record<string, string>,
  fields: Record<string, string>,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = { ...(existing ?? {}) };
  const abilities: Record<string, unknown> = {
    ...((existing?.abilities as Record<string, unknown>) ?? {}),
  };

  for (const [key] of MOLDABLE_FIELDS) {
    const typed = (fields[key] ?? "").trim();
    if (typed === (seed[key] ?? "")) continue;
    if (typed === "") {
      delete overrides[key];
      continue;
    }
    const asNumber = Number(typed);
    overrides[key] = !PROSE.has(key) && Number.isFinite(asNumber) ? asNumber : typed;
  }

  for (const ab of MOLDABLE_ABILITIES) {
    const typed = (fields[ab] ?? "").trim();
    if (typed === (seed[ab] ?? "")) continue;
    const n = Number(typed);
    if (typed === "" || !Number.isFinite(n)) delete abilities[ab];
    else abilities[ab] = n;
  }

  if (Object.keys(abilities).length > 0) overrides.abilities = abilities;
  else delete overrides.abilities;

  return overrides;
}
