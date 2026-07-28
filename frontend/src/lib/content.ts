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
