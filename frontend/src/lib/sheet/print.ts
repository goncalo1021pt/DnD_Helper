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
 * Where printing a PDF from an offscreen frame cannot be trusted (#360).
 *
 * Every browser on iOS is WebKit, and WebKit answers `frame.print()` on a
 * framed PDF by printing the page around it: no error to catch, so the
 * download fallback never ran and an iPhone printed the hero sheet's web page.
 * Android's Chrome has no inline PDF viewer to frame at all. Desktop Safari
 * shares iOS's engine and its habit. On all of them the PDF goes to a tab of
 * its own, whose viewer prints it properly.
 */
function framedPrintUnreliable(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; the touch points give it away.
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua);
  return iOS || android || safari;
}

function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * Hand the finished PDF to the browser's print dialog.
 *
 * A blob is same-origin, so an offscreen frame may drive it. Where the browser
 * will not print a framed PDF, the download is the honest fallback — the file
 * is what the user wanted either way.
 */
function printOrSave(bytes: Uint8Array, filename: string, tab: Window | null) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));

  if (tab || framedPrintUnreliable()) {
    // The tab was opened on the tap itself (see printHeroSheet); one opened
    // now, after the awaits, would be eaten by the popup blocker.
    if (tab && !tab.closed) tab.location.href = url;
    else download(url, filename);
    // The tab has read the blob long before this; the delay is only generous.
    setTimeout(() => URL.revokeObjectURL(url), 600_000);
    return;
  }

  const save = () => download(url, filename);
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
  // Before the first await, while this is still the tap: the only moment a
  // browser lets a page open a tab.
  const tab = framedPrintUnreliable() ? window.open("", "_blank") : null;
  if (tab) {
    tab.document.title = "Preparing the character sheet…";
    tab.document.body.textContent = "Preparing the character sheet…";
  }
  try {
    await buildAndPrint(sources, tab);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

async function buildAndPrint(sources: PrintSources, tab: Window | null): Promise<void> {
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
  printOrSave(bytes, `${safeName(name)}.pdf`, tab);
}
