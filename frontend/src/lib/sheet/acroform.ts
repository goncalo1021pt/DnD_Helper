import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField } from "pdf-lib";
import { FIELDS, type FieldDef, type SheetValues } from "./fields";
import { fingerprint, normalise, toWinAnsi } from "./text";

/**
 * The good path: a sheet that is already a form.
 *
 * The character sheet Wizards publishes is a fillable PDF, and a fillable PDF
 * carries its own boxes — names, positions, sizes, the lot. When the user hands
 * us one there is no need to guess coordinates at all: we match our field
 * catalogue against the form's own field names, write the values in, and
 * flatten so it prints as ink rather than as a form.
 *
 * The matching is a guess, but a correctable one. Whatever the auto-match gets
 * wrong the user re-points by hand, and the corrected map is remembered against
 * a fingerprint of that form's field names — so it is guessed once per sheet,
 * not once per hero.
 */

export type FormFieldType = "text" | "check" | "choice" | "other";

export interface FormField {
  name: string;
  type: FormFieldType;
}

/** Our field id -> the form's field name. */
export type FieldMap = Record<string, string>;

export interface FormInfo {
  fields: FormField[];
  /** Identifies this form's field set, so a saved map can be found again. */
  fingerprint: string;
  pageCount: number;
}

export async function readForm(bytes: Uint8Array): Promise<FormInfo> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const fields: FormField[] = doc.getForm().getFields().map((f) => ({
    name: f.getName(),
    type:
      f instanceof PDFTextField
        ? "text"
        : f instanceof PDFCheckBox
          ? "check"
          : f instanceof PDFDropdown
            ? "choice"
            : "other",
  }));
  return {
    fields,
    fingerprint: fingerprint(fields.map((f) => `${f.name}:${f.type}`)),
    pageCount: doc.getPageCount(),
  };
}

/** Every spelling of one of our fields worth matching against. */
function needles(def: FieldDef): string[] {
  return [def.id, def.label, ...(def.aliases ?? [])].map(normalise).filter(Boolean);
}

/**
 * How well a form field name answers to one of ours: exact beats prefix beats
 * containment, and a longer needle beats a shorter one so "strsave" is not
 * stolen by "str".
 */
function score(def: FieldDef, field: FormField): number {
  const wantsCheck = def.kind === "check";
  const isCheck = field.type === "check";
  if (wantsCheck !== isCheck) return 0;

  const hay = normalise(field.name);
  if (!hay) return 0;
  let best = 0;
  for (const needle of needles(def)) {
    if (!needle) continue;
    let base = 0;
    if (hay === needle) base = 1000;
    else if (hay.endsWith(needle) || hay.startsWith(needle)) base = 600;
    else if (hay.includes(needle)) base = 300;
    // The other direction, for sheets that shorten a name: "Animal" for
    // Animal Handling. Kept weak, and long enough to not fire on "Str".
    else if (hay.length >= 5 && needle.startsWith(hay)) base = 200;
    if (base) best = Math.max(best, base + needle.length);
  }
  return best;
}

/**
 * Greedy one-to-one auto-match: take the strongest pairing left, claim both
 * sides, repeat. Anything unmatched is simply left for the user to point at.
 */
export function autoMap(form: FormInfo): FieldMap {
  const pairs: Array<{ id: string; name: string; s: number }> = [];
  for (const def of FIELDS) {
    for (const field of form.fields) {
      const s = score(def, field);
      if (s > 0) pairs.push({ id: def.id, name: field.name, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));

  const map: FieldMap = {};
  const takenNames = new Set<string>();
  for (const p of pairs) {
    if (map[p.id] || takenNames.has(p.name)) continue;
    map[p.id] = p.name;
    takenNames.add(p.name);
  }
  return map;
}

export interface FillOptions {
  /** Draw the values as page content rather than leaving live form fields. */
  flatten?: boolean;
  /** Sheet pages to keep, 1-based; omit to keep the whole document. */
  pages?: number[];
  title?: string;
}

/** Write our values into the user's own fillable sheet. */
export async function fillForm(
  bytes: Uint8Array,
  values: SheetValues,
  map: FieldMap,
  { flatten = true, pages, title }: FillOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (title) doc.setTitle(title);
  const form = doc.getForm();

  for (const [id, name] of Object.entries(map)) {
    if (!name) continue;
    const value = values[id];
    if (value === undefined) continue;
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue; // The saved map names a field this file no longer has.
    }
    try {
      if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFTextField) {
        field.setText(toWinAnsi(String(value)));
      } else if (field instanceof PDFDropdown) {
        const text = toWinAnsi(String(value));
        if (text) field.select(text);
      }
    } catch {
      // A read-only field, or a dropdown without our option: skip it rather
      // than lose every other value to one bad box.
    }
  }

  if (flatten) {
    try {
      form.flatten();
    } catch {
      // Some sheets carry fields pdf-lib cannot flatten; a live form still
      // prints correctly, so this is not worth failing over.
    }
  }

  if (pages?.length) {
    const keep = new Set(pages.map((p) => p - 1));
    for (let i = doc.getPageCount() - 1; i >= 0; i--) {
      if (!keep.has(i)) doc.removePage(i);
    }
  }

  return doc.save();
}
