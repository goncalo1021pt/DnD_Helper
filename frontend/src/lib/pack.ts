/** Download the caller's whole homebrew collection as a pack file. */
export function exportHomebrewPack() {
  fetch("/api/content/pack", { credentials: "include" })
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
    });
}

/** Parse a pack file into its entries, or explain why it wouldn't open. */
export async function parsePackFile(
  file: File,
): Promise<{ entries: unknown[] } | { error: string }> {
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
  return { entries };
}
