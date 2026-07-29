import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { FIELD_BY_ID, type SheetValues } from "./fields";
import { LAYOUT_2024, PAGE, type FieldBox, type SheetLayout } from "./layout2024";
import { hexToRgb, NO_CALIBRATION, type Calibration } from "./prefs";
import { toWinAnsi } from "./text";

/**
 * The ink pass.
 *
 * Everything happens in the browser: no hero data and no copy of the sheet is
 * ever posted anywhere. Two shapes come out of here —
 *
 *   • ink alone, on transparent-white pages, to feed a sheet you have already
 *     printed back through the printer; and
 *   • ink over a backdrop you supply — the sheet as a PDF or as page images —
 *     when you would rather print the whole thing in one pass.
 *
 * The backdrop is always the caller's own file. We do not ship one.
 */

export type Backdrop =
  | { kind: "none" }
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "images"; pages: Record<number, { bytes: Uint8Array; mime: string }> };

export interface RenderOptions {
  values: SheetValues;
  /** Sheet pages to emit, 1-based, in order. */
  pages: number[];
  layout?: SheetLayout;
  calibration?: Calibration;
  backdrop?: Backdrop;
  /** Outline every box and name it — print one of these to check alignment. */
  guides?: boolean;
  /** #rrggbb. */
  ink?: string;
  font?: "helvetica" | "times";
  title?: string;
}

const PAD = 2;

/** The width one line of text takes, guarding against glyphs a font lacks. */
function widthOf(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

/** Break text to a width, keeping long words whole where possible. */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (widthOf(font, next, size) <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function alignedX(box: FieldBox, textWidth: number): number {
  switch (box.align) {
    case "center":
      return box.x + (box.w - textWidth) / 2;
    case "right":
      return box.x + box.w - PAD - textWidth;
    default:
      return box.x + PAD;
  }
}

/** A box scaled and shifted by the printer calibration and the page fit. */
function place(box: FieldBox, cal: Calibration, fit: number): FieldBox {
  const k = cal.scale * fit;
  return {
    ...box,
    x: box.x * k + cal.offsetX,
    y: box.y * k + cal.offsetY,
    w: box.w * k,
    h: box.h * k,
    size: (box.size ?? 10) * k,
  };
}

interface Pen {
  page: PDFPage;
  font: PDFFont;
  /** Page height, to flip our top-left coordinates into PDF space. */
  height: number;
  colour: ReturnType<typeof rgb>;
}

function drawSingle(pen: Pen, box: FieldBox, text: string) {
  let size = box.size ?? 10;
  const room = box.w - PAD * 2;
  while (size > 4 && widthOf(pen.font, text, size) > room) size -= 0.25;
  const width = widthOf(pen.font, text, size);
  const x = alignedX({ ...box, size }, width);
  // Sit the text on the optical middle of the box rather than its baseline.
  const y = pen.height - (box.y + box.h / 2) - size * 0.35;
  pen.page.drawText(text, { x, y, size, font: pen.font, color: pen.colour });
}

function drawPara(pen: Pen, box: FieldBox, text: string) {
  let size = box.size ?? 9;
  let lines = wrap(pen.font, text, size, box.w - PAD * 2);
  // Shrink until the block fits its box, then let it clip if it still cannot.
  while (size > 4.5 && lines.length * size * 1.18 > box.h) {
    size -= 0.25;
    lines = wrap(pen.font, text, size, box.w - PAD * 2);
  }
  const lineHeight = size * 1.18;
  const maxLines = Math.max(1, Math.floor(box.h / lineHeight));
  lines.slice(0, maxLines).forEach((line, i) => {
    const width = widthOf(pen.font, line, size);
    const x = alignedX({ ...box, size }, width);
    const y = pen.height - (box.y + size * 0.95 + i * lineHeight);
    pen.page.drawText(line, { x, y, size, font: pen.font, color: pen.colour });
  });
}

/** A hand-drawn tick: two strokes, so it reads at any size and any printer. */
function drawCheck(pen: Pen, box: FieldBox) {
  const inset = box.w * 0.18;
  const left = box.x + inset;
  const right = box.x + box.w - inset;
  const top = pen.height - (box.y + inset);
  const bottom = pen.height - (box.y + box.h - inset);
  const thickness = Math.max(0.8, box.w * 0.14);
  const stroke = { thickness, color: pen.colour };
  pen.page.drawLine({ start: { x: left, y: top }, end: { x: right, y: bottom }, ...stroke });
  pen.page.drawLine({ start: { x: left, y: bottom }, end: { x: right, y: top }, ...stroke });
}

function drawGuide(pen: Pen, box: FieldBox, id: string) {
  pen.page.drawRectangle({
    x: box.x,
    y: pen.height - (box.y + box.h),
    width: box.w,
    height: box.h,
    borderColor: rgb(0.85, 0.25, 0.2),
    borderWidth: 0.4,
    opacity: 0,
  });
  const size = 4;
  pen.page.drawText(toWinAnsi(id), {
    x: box.x + 0.5,
    y: pen.height - box.y + 1,
    size,
    font: pen.font,
    color: rgb(0.85, 0.25, 0.2),
  });
}

async function backdropPages(
  out: PDFDocument,
  backdrop: Backdrop,
  pages: number[],
): Promise<Map<number, PDFPage>> {
  const placed = new Map<number, PDFPage>();
  if (backdrop.kind === "pdf") {
    const src = await PDFDocument.load(backdrop.bytes, { ignoreEncryption: true });
    const count = src.getPageCount();
    // Sheet page N is page N of the file the user handed us; a short file just
    // means those sheet pages come out blank.
    const wanted = pages.filter((p) => p >= 1 && p <= count);
    const copied = await out.copyPages(src, wanted.map((p) => p - 1));
    wanted.forEach((p, i) => placed.set(p, out.addPage(copied[i])));
  } else if (backdrop.kind === "images") {
    for (const p of pages) {
      const img = backdrop.pages[p];
      const page = out.addPage([PAGE.width, PAGE.height]);
      placed.set(p, page);
      if (!img) continue;
      const embedded = /png/i.test(img.mime)
        ? await out.embedPng(img.bytes)
        : await out.embedJpg(img.bytes);
      // Fit the scan inside the page, centred — a scan is rarely exactly Letter.
      const k = Math.min(PAGE.width / embedded.width, PAGE.height / embedded.height);
      page.drawImage(embedded, {
        x: (PAGE.width - embedded.width * k) / 2,
        y: (PAGE.height - embedded.height * k) / 2,
        width: embedded.width * k,
        height: embedded.height * k,
      });
    }
  }
  return placed;
}

export async function renderSheetPdf(opts: RenderOptions): Promise<Uint8Array> {
  const {
    values,
    pages,
    layout = LAYOUT_2024,
    calibration = NO_CALIBRATION,
    backdrop = { kind: "none" },
    guides = false,
    ink = "#000000",
    font: fontChoice = "helvetica",
    title = "Character Sheet",
  } = opts;

  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator("Quest Board");

  const font = await out.embedFont(
    fontChoice === "times" ? StandardFonts.TimesRoman : StandardFonts.Helvetica,
  );
  const { r, g, b } = hexToRgb(ink);
  const colour = rgb(r, g, b);

  // Ink on its own is fed through a printer on top of a sheet that is already
  // stacked in page order, so the gaps have to be kept: asking for pages 1 and
  // 3 must yield three sheets, the middle one blank, or page 3's writing lands
  // on page 2. A backdrop carries its own pages and needs no such padding.
  const emitted =
    backdrop.kind === "none" && pages.length
      ? Array.from({ length: Math.max(...pages) }, (_, i) => i + 1)
      : pages;

  const placed = await backdropPages(out, backdrop, emitted);
  for (const p of emitted) {
    if (!placed.has(p)) placed.set(p, out.addPage([PAGE.width, PAGE.height]));
  }

  for (const p of pages) {
    const page = placed.get(p);
    if (!page) continue;
    const { width, height } = page.getSize();
    // A backdrop that is not Letter (A4, or a scan) rescales the whole map.
    const fit = Math.min(width / PAGE.width, height / PAGE.height);
    const pen: Pen = { page, font, height, colour };

    for (const [id, rawBox] of Object.entries(layout)) {
      if (rawBox.page !== p) continue;
      const box = place(rawBox, calibration, fit);
      if (guides) drawGuide(pen, box, id);

      const value = values[id];
      if (value === undefined || value === "" || value === false) continue;

      const kind = FIELD_BY_ID[id]?.kind ?? (typeof value === "boolean" ? "check" : "text");
      if (kind === "check") {
        drawCheck(pen, box);
      } else {
        const text = toWinAnsi(String(value)).trim();
        if (!text) continue;
        if (kind === "para" || rawBox.para) drawPara(pen, box, text);
        else drawSingle(pen, box, text);
      }
    }
  }

  return out.save();
}
