import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SheetValues } from "./fields";
import { LAYOUT_2024, PAGE, type FieldBox, type SheetLayout } from "./layout2024";
import { toWinAnsi } from "./text";

/**
 * The ink pass: a hero written onto the official 2024 character sheet.
 *
 * The sheet itself comes in as bytes — it ships with the app — and its pages
 * are copied through untouched, with our text drawn over them. Everything
 * happens in the browser; no hero data is posted anywhere.
 */

/** A dark blue that reads as handwriting rather than as print. */
const INK = rgb(0.078, 0.188, 0.42);

const PAD = 2;

export interface RenderOptions {
  values: SheetValues;
  /** The official sheet, as a PDF. */
  sheet: Uint8Array;
  layout?: SheetLayout;
  title?: string;
}

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

/** A box scaled to the page we actually got, in case it is not 603 x 774. */
function place(box: FieldBox, fit: number): FieldBox {
  return {
    ...box,
    x: box.x * fit,
    y: box.y * fit,
    w: box.w * fit,
    h: box.h * fit,
    size: (box.size ?? 10) * fit,
  };
}

interface Pen {
  page: PDFPage;
  font: PDFFont;
  /** Page height, to flip our top-left coordinates into PDF space. */
  height: number;
}

function drawSingle(pen: Pen, box: FieldBox, text: string) {
  let size = box.size ?? 10;
  const room = box.w - PAD * 2;
  while (size > 4 && widthOf(pen.font, text, size) > room) size -= 0.25;
  const width = widthOf(pen.font, text, size);
  const x = alignedX({ ...box, size }, width);
  // Sit the text on the optical middle of the box rather than its baseline.
  const y = pen.height - (box.y + box.h / 2) - size * 0.35;
  pen.page.drawText(text, { x, y, size, font: pen.font, color: INK });
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
    pen.page.drawText(line, { x, y, size, font: pen.font, color: INK });
  });
}

/** A hand-drawn tick: two strokes, so it reads at any size and any printer. */
function drawCheck(pen: Pen, box: FieldBox) {
  const inset = box.w * 0.18;
  const left = box.x + inset;
  const right = box.x + box.w - inset;
  const top = pen.height - (box.y + inset);
  const bottom = pen.height - (box.y + box.h - inset);
  const stroke = { thickness: Math.max(0.8, box.w * 0.14), color: INK };
  pen.page.drawLine({ start: { x: left, y: top }, end: { x: right, y: bottom }, ...stroke });
  pen.page.drawLine({ start: { x: left, y: bottom }, end: { x: right, y: top }, ...stroke });
}

export async function renderSheetPdf({
  values,
  sheet,
  layout = LAYOUT_2024,
  title = "Character Sheet",
}: RenderOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator("Quest Board");

  const src = await PDFDocument.load(sheet, { ignoreEncryption: true });
  const copied = await out.copyPages(src, src.getPageIndices());
  const pages = copied.map((p) => out.addPage(p));

  const font = await out.embedFont(StandardFonts.Helvetica);

  for (const [id, rawBox] of Object.entries(layout)) {
    const page = pages[rawBox.page - 1];
    if (!page) continue;

    const value = values[id];
    if (value === undefined || value === "" || value === false) continue;

    const { width, height } = page.getSize();
    const fit = Math.min(width / PAGE.width, height / PAGE.height);
    const box = place(rawBox, fit);
    const pen: Pen = { page, font, height };

    if (rawBox.check) {
      drawCheck(pen, box);
      continue;
    }
    const text = toWinAnsi(String(value)).trim();
    if (!text) continue;
    if (rawBox.para) drawPara(pen, box, text);
    else drawSingle(pen, box, text);
  }

  return out.save();
}
