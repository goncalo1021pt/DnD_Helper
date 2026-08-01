import type { CodexEntry, RulesContent } from "../api/client";

/**
 * Shared "where did this come from, and may I use it here" vocabulary. The
 * Forge, the Archives, the Den and the encounter builder all label and sift the
 * same rules content, so the origin and codex rules live here instead of being
 * re-derived on every page.
 */

/** How an entry's origin reads: SRD, the book a pack carried it in, or the
 * plain Homebrew it was hand-scribed as. */
export function sourceLabel(e: RulesContent): string {
  if (e.source === "srd") return "SRD";
  const book = (e.data as { book?: string }).book;
  return typeof book === "string" && book.trim() ? book.trim() : "Homebrew";
}

/** The stamp that sits beside a name: the origin, plus the author when it is
 * someone's homebrew. SRD entries carry no stamp. */
export function originStamp(e: RulesContent): string {
  if (e.source === "srd") return "";
  const label = sourceLabel(e);
  return e.creatorName ? `${label} · ${e.creatorName}` : label;
}

/** The origins actually present in a list — SRD first, plain Homebrew last,
 * imported books alphabetical between. The order of every source filter. */
export function sourceOptions(entries: RulesContent[] | undefined): string[] {
  const present = new Set((entries ?? []).map(sourceLabel));
  return [...present].sort((a, b) => {
    if (a === "SRD") return -1;
    if (b === "SRD") return 1;
    if (a === "Homebrew") return 1;
    if (b === "Homebrew") return -1;
    return a.localeCompare(b);
  });
}

/**
 * A free name for a copy of `original` (#127).
 *
 * The server refuses a second homebrew entry of the same kind and name — "you
 * already have a homebrew monster named X" — so a copy that suggested the
 * original's name would fail on the first press. It also dodges names that are
 * merely *present*: an SRD name is not technically taken, but a homebrew entry
 * wearing one shadows it, and both then sit in the list looking identical.
 *
 * Copying a copy gives "(copy 2)", not "(copy) (copy)".
 */
export function copyName(original: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const base = original.trim().replace(/\s*\(copy(?:\s+\d+)?\)$/i, "");
  let candidate = `${base} (copy)`;
  let n = 1;
  while (used.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base} (copy ${n})`;
  }
  return candidate;
}

/**
 * An entry as the seed for a new homebrew one of your own.
 *
 * `book` is dropped deliberately. It is what sourceLabel reads to say where an
 * entry came from, so a copy that kept it would file itself under someone
 * else's book — a creature you wrote, claiming to be from Rime of the
 * Frostmaiden. Everything else about the creature comes across whole, which is
 * the point: a copy is a starting position, not a blank page.
 */
export function copyOf(
  e: RulesContent,
  taken: Iterable<string>,
): { name: string; summary: string; data: Record<string, unknown> } {
  const { book: _book, ...data } = (e.data ?? {}) as Record<string, unknown>;
  return { name: copyName(e.name, taken), summary: e.summary ?? "", data };
}

/** A campaign's verdict on one entry. */
export type Legality = "legal" | "banned" | "proposed" | "absent";

/**
 * A campaign's codex as a predicate, mirroring the server's seat check: SRD is
 * legal until the DM bans it, homebrew is illegal until the DM enables it. A
 * table that banned every SRD class therefore offers only its own homebrew.
 */
export function codexLegality(codex: CodexEntry[] | undefined) {
  const ruled = new Map((codex ?? []).map((e) => [e.content.id, e.status]));
  return (e: RulesContent): Legality => {
    const status = ruled.get(e.id);
    if (e.source === "srd") return status === "banned" ? "banned" : "legal";
    if (status === "enabled") return "legal";
    return status === "proposed" ? "proposed" : "absent";
  };
}

/** Why an entry is unusable at a table, in the words the Forge shows. */
export function legalityReason(state: Legality): string {
  switch (state) {
    case "banned":
      return "banned at that table";
    case "proposed":
      return "still awaiting the DM's verdict";
    default:
      return "not in that table's codex";
  }
}
