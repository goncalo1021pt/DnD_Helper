import sheetUrl from "../../assets/dnd-2024-character-sheet.pdf?url";
import { buildSheetValues, type SheetSources } from "./values";

/**
 * One button's worth of work: a hero onto the official sheet, and the print
 * dialog open over it.
 *
 * The sheet ships with the app, so there is nothing to choose and nothing to
 * upload — and because the whole thing is assembled in the browser, the hero
 * never leaves the machine that is printing it.
 *
 * pdf-lib and the sheet are both fetched only when this runs, which keeps
 * roughly two megabytes out of the page load for everyone who never prints.
 */

/** Everything the exporter needs, plus what to call the file. */
export type PrintSources = SheetSources;

function safeName(s: string): string {
  return s.replace(/[^\w \-]+/g, "").trim() || "character";
}

/**
 * Hand the finished PDF to the browser's print dialog.
 *
 * A blob is same-origin, so an offscreen frame may drive it. Where the browser
 * will not print a framed PDF, the download is the honest fallback — the file
 * is what the user wanted either way.
 */
function printOrSave(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const save = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  frame.src = url;
  frame.onload = () => {
    try {
      const win = frame.contentWindow;
      if (!win) throw new Error("no frame window");
      win.focus();
      win.print();
    } catch {
      save();
    }
  };
  frame.onerror = save;
  document.body.appendChild(frame);

  // Leave the frame and its URL alive long enough for the dialog to read them;
  // the print dialog is modal but the page keeps running behind it.
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 120_000);
}

/** Build this hero's sheet and open the print dialog. */
export async function printHeroSheet(sources: PrintSources): Promise<void> {
  const [{ renderSheetPdf }, sheet] = await Promise.all([
    import("./render"),
    fetch(sheetUrl).then((r) => {
      if (!r.ok) throw new Error(`the character sheet failed to load (${r.status})`);
      return r.arrayBuffer();
    }),
  ]);

  const name = sources.detail.character.name;
  const bytes = await renderSheetPdf({
    values: buildSheetValues(sources),
    sheet: new Uint8Array(sheet),
    title: `${name} — character sheet`,
  });
  printOrSave(bytes, `${safeName(name)}.pdf`);
}
