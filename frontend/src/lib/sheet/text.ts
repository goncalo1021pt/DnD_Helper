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
