import type { FieldBox } from "./layout2024";

/**
 * What the exporter remembers between visits.
 *
 * Alignment is a property of a printer and a particular copy of the sheet, not
 * of a hero — so it lives in the browser that does the printing rather than on
 * the server. Everything here survives a reload and nothing here leaves the
 * machine.
 */

const KEY = "questboard.sheet-export.v1";

export interface Calibration {
  /** Points to shift every mark right; negative moves left. */
  offsetX: number;
  /** Points to shift every mark down; negative moves up. */
  offsetY: number;
  /** Uniform scale about the page's top-left corner, for printers that shrink. */
  scale: number;
}

export const NO_CALIBRATION: Calibration = { offsetX: 0, offsetY: 0, scale: 1 };

export interface SheetPrefs {
  calibration: Calibration;
  /** Per-field nudges from the calibrator, merged over the shipped layout. */
  overrides: Record<string, Partial<FieldBox>>;
  /**
   * Field-name maps for fillable PDFs, keyed by a fingerprint of the form's
   * own field names — so one saved map serves every hero on that sheet, and a
   * different sheet gets its own.
   */
  formMaps: Record<string, Record<string, string>>;
  /** Ink colour as #rrggbb. Black prints; a dark blue reads as handwriting. */
  ink: string;
  font: "helvetica" | "times";
}

export const DEFAULT_PREFS: SheetPrefs = {
  calibration: NO_CALIBRATION,
  overrides: {},
  formMaps: {},
  ink: "#1b2440",
  font: "helvetica",
};

export function loadPrefs(): SheetPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SheetPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      calibration: { ...NO_CALIBRATION, ...(parsed.calibration ?? {}) },
      overrides: parsed.overrides ?? {},
      formMaps: parsed.formMaps ?? {},
    };
  } catch {
    // A corrupt or unavailable store is not worth a broken export.
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: SheetPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private-mode browsers refuse to write; the export still works, it just
    // forgets the alignment.
  }
}

/** #rrggbb -> 0..1 components, for pdf-lib's rgb(). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
