import type { RulesContent } from "../api/client";

/*
The Rulebook's lookup half (#199). A keyword on a card — "Versatile" on a
weapon, a "Grappled" chip in the tracker — resolves to the rule entry it
names, so the popover can open the actual text instead of sending a player
to the shelf. Matching is by name, forgiving only the forms the app itself
produces: chip case, and the two spellings below.
*/

/** Tracker vocabulary that differs from the book's entry name. */
const ALIAS: Record<string, string> = {
  concentrating: "concentration",
};

/**
 * The rule-entry name a chip or property tag should open. "Exhaustion 3"
 * sheds its level; "Concentrating" maps to the Concentration entry.
 */
export function ruleTermFor(label: string): string {
  const bare = label
    .replace(/\s+\d+$/, "")
    .trim()
    .toLowerCase();
  return ALIAS[bare] ?? bare;
}

/** Rule entries by lowercase name, for O(1) chip lookups. */
export function indexRules(entries: RulesContent[] | undefined): Map<string, RulesContent> {
  const map = new Map<string, RulesContent>();
  for (const e of entries ?? []) {
    map.set(e.name.toLowerCase(), e);
  }
  return map;
}

/*
Spells named in entry text (#285). Three spellings are in the wild: the 2024
books italicise a spell (_Fireball_, and _Light, Thaumaturgy_ in one run),
the 2014 books list them lowercase after a header ("Cantrips (at will): fire
bolt, light"), and a scanned book lists them plain ("At will: Detect Magic,
Tongues"). Which words are read as names is decided by where they stand,
never by what they are: an italic run, or a list after a spell-list header.
A bare word in prose never counts, or "resistance", "fly" and "light" would
light up in every second sentence.
*/

/** A header that introduces a list of spells — "At will:", "1/day each:",
 *  "Cantrips (at will):", "3rd level (3 slots):" — with or without bold. */
const SPELL_LIST_HEADER = /^\s*(?:&emsp;)?\s*\**\s*([^:\n*_]{1,48}?)\s*:\**\s*(\S[\s\S]*)$/;
const SPELL_LIST_WORDS = /\b(will|day|days|slot|slots|cantrip|cantrips|level|each|rest)\b/i;

/**
 * Splits a paragraph into a spell-list header and the list it introduces,
 * or nothing when the paragraph is not a spell list. The header keeps its
 * markup so it renders exactly as written.
 */
export function spellListOf(block: string): { header: string; list: string } | null {
  const m = SPELL_LIST_HEADER.exec(block);
  if (!m || !SPELL_LIST_WORDS.test(m[1])) return null;
  return { header: block.slice(0, block.length - m[2].length), list: m[2] };
}

/** What stands between the names of a list. Kept as prose. */
const SPELL_SEPARATOR = /(\s*[,;]\s*|\s+or\s+|\s+and\s+)/;
/** What a name may carry after it: a note in brackets, a marker, a stop. */
const SPELL_TAIL = /(\s*\([^)]*\)\s*|[\s.:*†]+)+$/;

/**
 * Reads a run of text as a list of spell names, linking the ones `lookup`
 * knows (by lowercase name) and keeping everything else as prose — the
 * separators, a "(self only)", a name the codex has never heard of. Lossless:
 * the strings and the linked names concatenate back to the input.
 */
export function linkSpellNames<T>(
  text: string,
  lookup: (name: string) => T | undefined,
): Array<string | { text: string; entry: T }> {
  const out: Array<string | { text: string; entry: T }> = [];
  const prose = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (typeof last === "string") out[out.length - 1] = last + s;
    else out.push(s);
  };
  // A capturing separator interleaves the separators into the split, so
  // nothing is lost; a separator never names a spell and falls to prose.
  for (const piece of text.split(SPELL_SEPARATOR)) {
    const lead = /^\s*/.exec(piece)![0];
    const body = piece.slice(lead.length);
    const tail = SPELL_TAIL.exec(body)?.[0] ?? "";
    const name = body.slice(0, body.length - tail.length);
    const entry = name ? lookup(name.toLowerCase()) : undefined;
    if (!entry) {
      prose(piece);
      continue;
    }
    prose(lead);
    out.push({ text: name, entry });
    prose(tail);
  }
  return out;
}
