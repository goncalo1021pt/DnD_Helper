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
 * The tab the sheet prints from. Opened by the button's own click handler,
 * before any of the work: a script may open a window only in direct answer to
 * a gesture, and by the time the PDF is drawn the gesture is long over. Safari's
 * popup blocker eats a window opened after an await, and so does every phone.
 */
export function openSheetTab(): Window | null {
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.title = "Setting the ink…";
    tab.document.body.innerHTML =
      '<p style="font:16px system-ui,sans-serif;padding:2em;color:#444">Setting the ink on the sheet…</p>';
  }
  return tab;
}

/**
 * Hand the finished PDF to the browser's own viewer, in the tab opened for it,
 * and ask for the print dialog.
 *
 * It used to be a hidden frame, and Safari answered a print on a framed PDF by
 * printing the PAGE behind it — the hero's screen, not the sheet (#360); a phone
 * never renders a framed PDF at all. In a tab the viewer holds the file, and
 * where a browser will not let a script print it, the viewer's own print button
 * is one tap away. With no tab at all (a blocker won after all), the download is
 * the honest fallback — the file is what the user wanted either way.
 */
function printOrSave(bytes: Uint8Array, filename: string, tab: Window | null) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  // Keep the URL alive long enough for the viewer and the dialog to read it;
  // the print dialog is modal but the page keeps running behind it.
  setTimeout(() => URL.revokeObjectURL(url), 120_000);

  if (!tab || tab.closed) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    return;
  }
  tab.location.href = url;

  // Ask once, and only once the viewer holds the PDF — never the placeholder,
  // or the dialog would print "Setting the ink". The load event is the clean
  // signal where one fires; the poll is for a viewer that swaps the window
  // out from under the listener, and it checks the address before asking.
  let asked = false;
  const ask = () => {
    if (asked) return;
    asked = true;
    try {
      tab.focus();
      tab.print();
    } catch {
      /* the viewer's own print button remains */
    }
  };
  try {
    tab.addEventListener("load", ask, { once: true });
  } catch {
    /* cross-document already; the poll covers it */
  }
  const started = Date.now();
  const poll = setInterval(() => {
    if (asked || Date.now() - started > 20_000 || tab.closed) {
      clearInterval(poll);
      return;
    }
    try {
      if (tab.location.href === url && tab.document.readyState === "complete") ask();
    } catch {
      // A viewer we may not look into: stop asking, it has its own button.
      clearInterval(poll);
    }
  }, 250);
}

/** Build this hero's sheet and open the print dialog in `tab` (see openSheetTab). */
export async function printHeroSheet(sources: PrintSources, tab: Window | null): Promise<void> {
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
