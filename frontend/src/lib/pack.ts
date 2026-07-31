import { http } from "./http";
import { noticeFor, pushNotice } from "./notices";

/** Download the caller's whole homebrew collection as a pack file. */
export function exportHomebrewPack() {
  http("/api/rules/export", { credentials: "include" })
    .then((r) => r.json())
    .then((pack) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(pack, null, 1)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "questboard-homebrew-pack.json";
      a.click();
      URL.revokeObjectURL(url);
    })
    // Not a mutation, so the MutationCache never hears about it — an export
    // that dies would otherwise be a button that did nothing at all.
    .catch((err) => pushNotice(noticeFor(err)));
}

/** The pack's own name for itself, else the file it arrived in — "Xanathars
 * Guide.json" imports as "Xanathars Guide". A pack that spells out an empty
 * book (our own exports do) means "these entries already know their sources",
 * so nothing is stamped over them. */
export function packBookOf(file: File, parsed: unknown): string {
  const declared = (parsed as { book?: unknown })?.book;
  if (typeof declared === "string") return declared.trim().slice(0, 80);
  return file.name.replace(/\.json$/i, "").trim().slice(0, 80);
}

/** Parse a pack file into its entries and its source book, or explain why it
 * wouldn't open. */
export async function parsePackFile(
  file: File,
): Promise<{ entries: unknown[]; book: string } | { error: string }> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not valid JSON." };
  }
  const entries = (parsed as { entries?: unknown[] })?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return { error: 'No entries in that pack — expected { "entries": [...] }.' };
  }
  return { entries, book: packBookOf(file, parsed) };
}
