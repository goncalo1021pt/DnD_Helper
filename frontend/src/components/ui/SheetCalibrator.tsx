import { useRef, useState } from "react";
import { FIELD_BY_ID, fieldGroups, type SheetValues } from "../../lib/sheet/fields";
import { PAGE, type FieldBox, type SheetLayout } from "../../lib/sheet/layout2024";

/**
 * Drag the boxes onto your own sheet.
 *
 * The shipped coordinates are a good first guess and no more — a scan sits a
 * few points off, a printer shrinks the page, a later printing of the sheet
 * moves a box. Rather than ask anyone to guess numbers, this lays the ink over
 * an image of the page at true proportion and lets it be dragged and stretched
 * into place. What comes out is a patch over the default layout, saved in the
 * browser, and copyable as JSON so a good alignment can be shared or folded
 * back into the shipped map.
 */

export interface CalibratorProps {
  page: number;
  /** Object URL of an image of this page of the sheet. */
  imageUrl: string;
  layout: SheetLayout;
  values: SheetValues;
  overrides: Record<string, Partial<FieldBox>>;
  onChange: (overrides: Record<string, Partial<FieldBox>>) => void;
}

type Drag = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  box: FieldBox;
};

/** Points, rounded to a half — finer than a printer can tell. */
const snap = (n: number) => Math.round(n * 2) / 2;

export default function SheetCalibrator({
  page,
  imageUrl,
  layout,
  values,
  overrides,
  onChange,
}: CalibratorProps) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState("");
  const [width, setWidth] = useState(612);

  const groups = fieldGroups(page);
  const shown = Object.entries(layout).filter(
    ([id, b]) => b.page === page && (!group || FIELD_BY_ID[id]?.group === group),
  );

  // Points to on-screen pixels. The image is laid out at the page's aspect,
  // so one factor serves both axes.
  const k = width / PAGE.width;

  function patch(id: string, next: Partial<FieldBox>) {
    onChange({ ...overrides, [id]: { ...overrides[id], ...next } });
  }

  function onPointerDown(e: React.PointerEvent, id: string, mode: Drag["mode"]) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelected(id);
    drag.current = { id, mode, startX: e.clientX, startY: e.clientY, box: layout[id] };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / k;
    const dy = (e.clientY - d.startY) / k;
    if (d.mode === "move") {
      patch(d.id, { x: snap(d.box.x + dx), y: snap(d.box.y + dy) });
    } else {
      patch(d.id, {
        w: Math.max(6, snap(d.box.w + dx)),
        h: Math.max(6, snap(d.box.h + dy)),
      });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (drag.current) (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  }

  /** Arrow keys walk the selected box a point at a time; shift walks five. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (!selected) return;
    const step = e.shiftKey ? 5 : 1;
    const box = layout[selected];
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    patch(selected, { x: snap(box.x + move[0]), y: snap(box.y + move[1]) });
  }

  const sel = selected ? layout[selected] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="input-parchment input-compact cursor-pointer text-[12px]"
        >
          <option value="">All boxes on page {page}</option>
          {groups.map((g) => (
            <option key={g.group} value={g.group}>
              {g.group}
            </option>
          ))}
        </select>
        <label className="label-stamp flex items-center gap-2 text-[9px] tracking-[1.5px] text-ink-label">
          Zoom
          <input
            type="range"
            min={480}
            max={1100}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        {sel && (
          <span className="label-stamp text-[9px] tracking-[1px] text-ink-label">
            {FIELD_BY_ID[selected!]?.label ?? selected} · x {sel.x} y {sel.y} · {sel.w}×{sel.h}
          </span>
        )}
        <button
          onClick={() => onChange({})}
          className="btn-base btn-ghost-ink ml-auto px-3 py-1.5 text-[10px]"
        >
          Reset page positions
        </button>
      </div>

      <div className="overflow-auto" style={{ maxHeight: "58vh" }}>
        <div
          ref={frame}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative select-none outline-none"
          style={{ width, height: width * (PAGE.height / PAGE.width) }}
        >
          <img
            src={imageUrl}
            alt={`Sheet page ${page}`}
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {shown.map(([id, box]) => {
            const value = values[id];
            const isCheck = FIELD_BY_ID[id]?.kind === "check";
            const active = selected === id;
            return (
              <div
                key={id}
                onPointerDown={(e) => onPointerDown(e, id, "move")}
                title={FIELD_BY_ID[id]?.label ?? id}
                className="absolute cursor-move overflow-hidden"
                style={{
                  left: box.x * k,
                  top: box.y * k,
                  width: box.w * k,
                  height: box.h * k,
                  outline: active ? "1.5px solid #8b2520" : "1px dashed rgba(139,37,32,.45)",
                  background: active ? "rgba(201,162,39,.22)" : "rgba(201,162,39,.08)",
                }}
              >
                <span
                  className="pointer-events-none absolute inset-0 flex items-center whitespace-nowrap px-[2px] font-semibold text-[#16204a]"
                  style={{
                    fontSize: (box.size ?? 10) * k,
                    justifyContent:
                      box.align === "center" ? "center" : box.align === "right" ? "flex-end" : "flex-start",
                  }}
                >
                  {isCheck ? (value ? "✕" : "") : String(value ?? "")}
                </span>
                <span
                  onPointerDown={(e) => onPointerDown(e, id, "resize")}
                  className="absolute bottom-0 right-0 h-2 w-2 cursor-nwse-resize"
                  style={{ background: "#8b2520" }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <p className="font-accent text-[11.5px] italic leading-relaxed text-ink-body">
        Drag a box to move it, pull its corner to resize, or select one and walk it with the arrow
        keys — hold shift for five points a step. Positions save as you go.
      </p>
    </div>
  );
}
