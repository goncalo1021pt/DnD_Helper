import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterDetail } from "../api/client";
import { useRules } from "../hooks";
import type { FieldMap, FormInfo } from "../lib/sheet/acroform";
import { fieldGroups, FIELD_BY_ID, type SheetValues } from "../lib/sheet/fields";
import {
  applyOverrides,
  LAYOUT_2024,
  layoutPages,
  type FieldBox,
  type SheetLayout,
} from "../lib/sheet/layout2024";
import { loadPrefs, savePrefs, type SheetPrefs } from "../lib/sheet/prefs";
import { clearSheetFiles, loadSheetFiles, saveSheetFiles } from "../lib/sheet/store";
import { buildSheetValues } from "../lib/sheet/values";
import ParchmentModal from "./ui/ParchmentModal";
import SheetCalibrator from "./ui/SheetCalibrator";

/**
 * Take a hero off the screen and onto paper.
 *
 * Three ways out, in descending order of how good the result looks:
 *
 *   Fill  — you hand over your own fillable copy of the 2024 sheet and we
 *           write into its actual form boxes. Nothing is guessed; it comes
 *           out looking typed.
 *   Over  — you hand over the sheet as pages of image or PDF and we lay the
 *           ink over it at measured positions, one file to print.
 *   Ink   — no backdrop at all: just the writing, on blank pages, to feed a
 *           sheet you have already printed back through the printer.
 *
 * The sheet itself is always yours. Quest Board ships no copy of it, and none
 * of this leaves the browser — the PDF is built here, on this machine, from a
 * hero the page had already loaded.
 */

type Mode = "fill" | "over" | "ink";

const MODES: Array<{ id: Mode; title: string; blurb: string }> = [
  { id: "over", title: "Print over my sheet", blurb: "Your copy of the 2024 sheet, with the ink on top." },
  { id: "ink", title: "Ink only", blurb: "Just the writing, to print onto a sheet you have." },
  { id: "fill", title: "Fill my sheet", blurb: "A fillable PDF — written into its own boxes." },
];

interface PageImage {
  bytes: Uint8Array;
  mime: string;
  url: string;
}

function safeName(s: string): string {
  return s.replace(/[^\w \-]+/g, "").trim() || "character";
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="label-stamp mb-1.5 text-[9px] tracking-[2px] text-ink-label">{children}</div>
  );
}

export default function SheetExportModal({
  detail,
  onClose,
}: {
  detail: CharacterDetail;
  onClose: () => void;
}) {
  const { data: classes } = useRules("class");
  const { data: subclasses } = useRules("subclass");
  const { data: species } = useRules("species");
  const { data: backgrounds } = useRules("background");

  const [prefs, setPrefs] = useState<SheetPrefs>(() => loadPrefs());
  const [mode, setMode] = useState<Mode>("over");
  const [pages, setPages] = useState<number[]>(() => layoutPages());
  const [guides, setGuides] = useState(false);
  const [pdfBackdrop, setPdfBackdrop] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [images, setImages] = useState<Record<number, PageImage>>({});
  const [form, setForm] = useState<FormInfo | null>(null);
  const [formBytes, setFormBytes] = useState<Uint8Array | null>(null);
  const [map, setMap] = useState<FieldMap>({});
  const [showMapper, setShowMapper] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const character = detail.character;
  const values: SheetValues = useMemo(
    () => buildSheetValues({ detail, classes, subclasses, species, backgrounds }),
    [detail, classes, subclasses, species, backgrounds],
  );

  const layout: SheetLayout = useMemo(
    () => applyOverrides(LAYOUT_2024, prefs.overrides),
    [prefs.overrides],
  );

  // Alignment and colour belong to this browser, not to the hero.
  useEffect(() => savePrefs(prefs), [prefs]);

  // Object URLs for the page images outlive a render; clean them up on the way out.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(
    () => () => Object.values(imagesRef.current).forEach((i) => URL.revokeObjectURL(i.url)),
    [],
  );

  // The sheet you supplied last time is still on this device — pick it up so
  // the dialog opens ready to print rather than asking for the file again.
  useEffect(() => {
    let live = true;
    loadSheetFiles().then((files) => {
      if (!live || files.length === 0) return;
      const pdf = files.find((f) => /pdf/i.test(f.mime));
      if (pdf) {
        setPdfBackdrop({ bytes: pdf.bytes, name: pdf.name });
        return;
      }
      setImages(
        Object.fromEntries(
          files
            .filter((f) => f.page !== undefined)
            .map((f) => [
              f.page!,
              {
                bytes: f.bytes,
                mime: f.mime,
                url: URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime })),
              },
            ]),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, []);

  const availablePages = mode === "fill" && form ? Array.from({ length: form.pageCount }, (_, i) => i + 1) : layoutPages();

  async function build(): Promise<Uint8Array> {
    if (mode === "fill") {
      if (!formBytes) throw new Error("Choose your fillable sheet first.");
      const { fillForm } = await import("../lib/sheet/acroform");
      return fillForm(formBytes, values, map, {
        pages: pages.length ? pages : undefined,
        title: `${character.name} — character sheet`,
      });
    }
    const { renderSheetPdf } = await import("../lib/sheet/render");
    const backdrop =
      mode === "over"
        ? pdfBackdrop
          ? ({ kind: "pdf", bytes: pdfBackdrop.bytes } as const)
          : ({
              kind: "images",
              pages: Object.fromEntries(
                Object.entries(images).map(([p, i]) => [p, { bytes: i.bytes, mime: i.mime }]),
              ),
            } as const)
        : ({ kind: "none" } as const);
    return renderSheetPdf({
      values,
      pages,
      layout,
      calibration: prefs.calibration,
      backdrop,
      guides,
      ink: prefs.ink,
      font: prefs.font,
      title: `${character.name} — character sheet`,
    });
  }

  // Rebuild the preview whenever anything that shapes it moves. The last run
  // wins: an older build finishing late must not overwrite a newer preview.
  const run = useRef(0);
  useEffect(() => {
    const token = ++run.current;
    let url: string | null = null;
    // Waiting on a file is not an error — say nothing until there is one.
    if (mode === "fill" && !formBytes) {
      setPreview(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    build()
      .then((bytes) => {
        if (token !== run.current) return;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        setPreview(url);
        setError(null);
      })
      .catch((e: unknown) => {
        if (token !== run.current) return;
        setPreview(null);
        setError(e instanceof Error ? e.message : "The sheet would not render.");
      })
      .finally(() => {
        if (token === run.current) setBusy(false);
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pages, guides, layout, prefs.calibration, prefs.ink, prefs.font, values, pdfBackdrop, images, formBytes, map]);

  async function onPickFillable(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const bytes = await readFile(file);
      const { readForm, autoMap } = await import("../lib/sheet/acroform");
      const info = await readForm(bytes);
      if (info.fields.length === 0) {
        setError("That PDF has no form fields — try “Print over my sheet” instead.");
        return;
      }
      setFormBytes(bytes);
      setForm(info);
      // A map corrected once for this sheet serves every hero on it.
      setMap(prefs.formMaps[info.fingerprint] ?? autoMap(info));
      setPages(Array.from({ length: info.pageCount }, (_, i) => i + 1));
    } catch {
      setError("That file could not be read as a PDF.");
    }
  }

  async function onPickBackdrop(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files);
    const pdf = list.find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (pdf) {
      const bytes = await readFile(pdf);
      setPdfBackdrop({ bytes, name: pdf.name });
      setImages({});
      void saveSheetFiles([{ bytes, name: pdf.name, mime: "application/pdf" }]);
      return;
    }
    // Images land on the sheet pages we know about, in the order they were given.
    const targets = layoutPages();
    const next: Record<number, PageImage> = { ...images };
    for (const [i, file] of list.entries()) {
      const page = targets[i] ?? targets[targets.length - 1] + i;
      if (next[page]) URL.revokeObjectURL(next[page].url);
      const bytes = await readFile(file);
      next[page] = {
        bytes,
        mime: file.type || "image/png",
        url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: file.type || "image/png" })),
      };
    }
    setPdfBackdrop(null);
    setImages(next);
    void saveSheetFiles(
      Object.entries(next).map(([page, i]) => ({
        bytes: i.bytes,
        name: `page ${page}`,
        mime: i.mime,
        page: Number(page),
      })),
    );
  }

  function forgetSheet() {
    Object.values(images).forEach((i) => URL.revokeObjectURL(i.url));
    setPdfBackdrop(null);
    setImages({});
    void clearSheetFiles();
  }

  function setCal(patch: Partial<SheetPrefs["calibration"]>) {
    setPrefs((p) => ({ ...p, calibration: { ...p.calibration, ...patch } }));
  }

  function rememberMap(next: FieldMap) {
    setMap(next);
    if (form) {
      setPrefs((p) => ({ ...p, formMaps: { ...p.formMaps, [form.fingerprint]: next } }));
    }
  }

  const calibratable = layoutPages().filter((p) => images[p]);

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[1040px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        For the table
      </div>
      <h3 className="font-display m-0 mb-1 text-center text-2xl font-bold text-ink">
        Print {character.name}
      </h3>
      <p className="font-accent mb-5 text-center text-[12.5px] italic text-ink-body">
        Built here in your browser — the sheet you supply never leaves this machine.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        {/* — the controls — */}
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setError(null);
                  // Page numbers mean different things per mode: a fillable
                  // sheet's own pages, or the pages our layout knows about.
                  setPages(
                    m.id === "fill" && form
                      ? Array.from({ length: form.pageCount }, (_, i) => i + 1)
                      : layoutPages(),
                  );
                  setCalibrating(null);
                }}
                className="cursor-pointer rounded-[2px] border-none px-3 py-2.5 text-left"
                style={{
                  background: mode === m.id ? "rgba(201,162,39,.18)" : "rgba(120,86,42,.08)",
                  boxShadow: `inset 0 0 0 1px rgba(120,80,30,${mode === m.id ? ".6" : ".28"})`,
                }}
              >
                <div className="font-heading text-[12.5px] font-bold text-ink">{m.title}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-ink-body">{m.blurb}</div>
              </button>
            ))}
          </div>

          {mode === "fill" && (
            <div>
              <Label>Your fillable 2024 sheet</Label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => onPickFillable(e.target.files?.[0])}
                className="input-parchment input-compact w-full text-[12px]"
              />
              {form && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-body">
                  <span>
                    {form.fields.length} boxes found · {Object.keys(map).length} matched
                  </span>
                  <button
                    onClick={() => setShowMapper((s) => !s)}
                    className="btn-base btn-ghost-ink px-2.5 py-1 text-[10px]"
                  >
                    {showMapper ? "Hide" : "Check"} the matching
                  </button>
                </div>
              )}
              {form && showMapper && (
                <div
                  className="mt-2 max-h-[320px] overflow-y-auto rounded-[2px] px-3 py-2"
                  style={{ boxShadow: "inset 0 0 0 1px rgba(120,80,30,.3)" }}
                >
                  {fieldGroups().map((g) => (
                    <div key={g.group} className="mb-2">
                      {/* One group open at a time: the catalogue runs to a few
                          hundred boxes, and rendering every select at once is
                          a lot of DOM for a panel nobody reads end to end. */}
                      <button
                        onClick={() => setOpenGroup(openGroup === g.group ? null : g.group)}
                        className="label-stamp flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-0 py-1 text-[9px] tracking-[2px] text-ink-label"
                      >
                        <span>{g.group}</span>
                        <span className="text-ink-body">
                          {g.fields.filter((d) => map[d.id]).length}/{g.fields.length}
                          {openGroup === g.group ? " ▾" : " ▸"}
                        </span>
                      </button>
                      {openGroup === g.group &&
                        g.fields.map((def) => (
                        <div key={def.id} className="mb-1 flex items-center gap-2">
                          <span className="w-[140px] flex-none truncate text-[11px] text-ink-body">
                            {def.label}
                          </span>
                          <select
                            value={map[def.id] ?? ""}
                            onChange={(e) =>
                              rememberMap(
                                e.target.value
                                  ? { ...map, [def.id]: e.target.value }
                                  : Object.fromEntries(
                                      Object.entries(map).filter(([k]) => k !== def.id),
                                    ),
                              )
                            }
                            className="input-parchment input-compact min-w-0 flex-1 cursor-pointer text-[11px]"
                          >
                            <option value="">— not on this sheet —</option>
                            {form.fields
                              .filter((f) => (def.kind === "check") === (f.type === "check"))
                              .map((f) => (
                                <option key={f.name} value={f.name}>
                                  {f.name}
                                </option>
                              ))}
                          </select>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === "over" && (
            <div>
              <Label>Your copy of the sheet — page images, or the PDF</Label>
              <input
                type="file"
                accept="image/png,image/jpeg,application/pdf,.pdf"
                multiple
                onChange={(e) => onPickBackdrop(e.target.files)}
                className="input-parchment input-compact w-full text-[12px]"
              />
              <p className="mt-1.5 text-[11px] leading-snug text-ink-body">
                {pdfBackdrop
                  ? `Using ${pdfBackdrop.name} — kept on this device, so you need not pick it again. Page images unlock the drag-to-align tool.`
                  : calibratable.length
                    ? `Images kept for page ${calibratable.join(" and ")}.`
                    : "The official 2024 sheet as you downloaded it, or one image per page."}
              </p>
              {(pdfBackdrop || calibratable.length > 0) && (
                <button
                  onClick={forgetSheet}
                  className="btn-base btn-ghost-ink mt-1.5 px-3 py-1 text-[10px]"
                >
                  Forget this sheet
                </button>
              )}
              {calibratable.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {calibratable.map((p) => (
                    <button
                      key={p}
                      onClick={() => setCalibrating(calibrating === p ? null : p)}
                      className="btn-base btn-wax px-3 py-1.5 text-[10.5px]"
                    >
                      {calibrating === p ? "Close" : "Align"} page {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Pages</Label>
            <div className="flex flex-wrap gap-2">
              {availablePages.map((p: number) => (
                <button
                  key={p}
                  onClick={() =>
                    setPages((cur) =>
                      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p].sort((a, b) => a - b),
                    )
                  }
                  className="label-stamp cursor-pointer rounded-[2px] border-none px-3 py-1.5 text-[10px] tracking-[1px]"
                  style={{
                    background: pages.includes(p)
                      ? "linear-gradient(180deg,#8b2520,#5e1611)"
                      : "rgba(120,86,42,.13)",
                    color: pages.includes(p) ? "#f3d9c0" : "#4a3620",
                    boxShadow: `inset 0 0 0 1px ${pages.includes(p) ? "#3f0f0e" : "rgba(120,80,30,.45)"}`,
                  }}
                >
                  Page {p}
                </button>
              ))}
            </div>
            {mode === "ink" && pages.length > 0 && (
              <p className="mt-1.5 text-[11px] leading-snug text-ink-body">
                Skipped pages still come out blank, so the stack lines up with the sheet when you
                feed it back through.
              </p>
            )}
          </div>

          {mode !== "fill" && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <Label>Ink</Label>
                <input
                  type="color"
                  value={prefs.ink}
                  onChange={(e) => setPrefs((p) => ({ ...p, ink: e.target.value }))}
                  className="h-8 w-full cursor-pointer rounded-[2px] border-none bg-transparent p-0"
                />
              </div>
              <div>
                <Label>Hand</Label>
                <select
                  value={prefs.font}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, font: e.target.value as SheetPrefs["font"] }))
                  }
                  className="input-parchment input-compact w-full cursor-pointer text-[12px]"
                >
                  <option value="helvetica">Plain</option>
                  <option value="times">Serif</option>
                </select>
              </div>
              <div>
                <Label>Nudge across</Label>
                <input
                  type="number"
                  step={0.5}
                  value={prefs.calibration.offsetX}
                  onChange={(e) => setCal({ offsetX: Number(e.target.value) || 0 })}
                  className="input-parchment input-compact w-full text-[12px]"
                />
              </div>
              <div>
                <Label>Nudge down</Label>
                <input
                  type="number"
                  step={0.5}
                  value={prefs.calibration.offsetY}
                  onChange={(e) => setCal({ offsetY: Number(e.target.value) || 0 })}
                  className="input-parchment input-compact w-full text-[12px]"
                />
              </div>
            </div>
          )}

          {mode !== "fill" && (
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[11.5px] text-ink-body">
                <input
                  type="checkbox"
                  checked={guides}
                  onChange={(e) => setGuides(e.target.checked)}
                />
                Show alignment guides
              </label>
              <label className="flex items-center gap-2 text-[11.5px] text-ink-body">
                Scale
                <input
                  type="number"
                  step={0.005}
                  min={0.8}
                  max={1.2}
                  value={prefs.calibration.scale}
                  onChange={(e) => setCal({ scale: Number(e.target.value) || 1 })}
                  className="input-parchment input-compact w-[86px] text-[12px]"
                />
              </label>
              <button
                onClick={() => setCal({ offsetX: 0, offsetY: 0, scale: 1 })}
                className="btn-base btn-ghost-ink px-3 py-1.5 text-[10px]"
              >
                Reset nudge
              </button>
            </div>
          )}

          {error && (
            <div className="font-accent text-[12.5px] italic" style={{ color: "#8b2520" }}>
              {error}
            </div>
          )}
        </div>

        {/* — the proof — */}
        <div className="flex flex-col gap-2">
          <Label>{busy ? "Setting the ink…" : "Proof"}</Label>
          {preview ? (
            <iframe
              title="Character sheet preview"
              src={preview}
              className="h-[440px] w-full rounded-[2px]"
              style={{ boxShadow: "inset 0 0 0 1px rgba(120,80,30,.35)", background: "#efe3c8" }}
            />
          ) : (
            <div
              className="font-accent flex h-[440px] items-center justify-center rounded-[2px] px-4 text-center text-[13px] italic text-ink-body"
              style={{ boxShadow: "inset 0 0 0 1px rgba(120,80,30,.35)" }}
            >
              {busy ? "…" : "Nothing to show yet."}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || !preview}
              onClick={async () => {
                try {
                  download(
                    await build(),
                    `${safeName(character.name)} — level ${character.level}.pdf`,
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : "The sheet would not render.");
                }
              }}
              className="btn-base btn-gold clip-octagon h-10 flex-1 px-5 text-[12px]"
            >
              Download
            </button>
            <button onClick={onClose} className="btn-base btn-ghost-ink h-10 px-4 text-[11px]">
              Close
            </button>
          </div>
        </div>
      </div>

      {calibrating !== null && images[calibrating] && (
        <div
          ref={(el) => el?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="mt-6 border-t border-[rgba(120,80,30,.3)] pt-4"
        >
          <SheetCalibrator
            page={calibrating}
            imageUrl={images[calibrating].url}
            layout={layout}
            values={values}
            overrides={Object.fromEntries(
              Object.entries(prefs.overrides).filter(
                ([id]) => FIELD_BY_ID[id]?.page === calibrating,
              ),
            )}
            onChange={(next: Record<string, Partial<FieldBox>>) =>
              setPrefs((p) => ({
                ...p,
                overrides: {
                  // Keep the other pages' work; replace this page's wholesale so
                  // "reset page positions" actually resets.
                  ...Object.fromEntries(
                    Object.entries(p.overrides).filter(
                      ([id]) => FIELD_BY_ID[id]?.page !== calibrating,
                    ),
                  ),
                  ...next,
                },
              }))
            }
          />
        </div>
      )}
    </ParchmentModal>
  );
}
