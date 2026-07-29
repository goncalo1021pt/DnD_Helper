/**
 * The standard PDF fonts speak WinAnsi and nothing else, and our own copy is
 * full of curly quotes, em dashes and “×”. Fold them to Latin-1 before a glyph
 * we cannot draw takes the whole export down with it.
 */
export function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[×✕✖]/g, "x")
    .replace(/−/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/[^ -ÿ\n]/g, "");
}

/** A stable short hash of a list of strings — FNV-1a, hex. */
export function fingerprint(parts: string[]): string {
  let h = 0x811c9dc5;
  for (const part of [...parts].sort()) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f; // a separator, so ["ab"] and ["a","b"] differ
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Lowercase alphanumerics only — the shape a name has in common with another. */
export function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
