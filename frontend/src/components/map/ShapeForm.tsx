import { useState, type FormEvent } from "react";
import type { Location, MapShape, MapShapeInput, MapPoint } from "../../api/client";

/*
Naming and styling a road or a region (#262).

The same form serves both, because the same row does — what differs is only
which controls make sense: a line has no fill to be transparent, and an area's
"width" is the weight of its border. Rather than two nearly identical forms
drifting apart, one form asks `kind` and hides what does not apply.
*/

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** A short, legible palette rather than a colour picker: a map wants inks. */
const INKS: [string, string][] = [
  ["#c96a5a", "clay"],
  ["#e0a94e", "gold"],
  ["#7d9b6a", "moss"],
  ["#6a8fb0", "slate"],
  ["#9a86b8", "iris"],
  ["#b8705a", "rust"],
  ["#cdbb99", "bone"],
  ["#8b2520", "blood"],
];

export interface ShapeDraft {
  kind: "line" | "area";
  points: MapPoint[];
  /** Present when editing something already drawn. */
  existing?: MapShape;
}

export function ShapeForm({
  draft,
  locations,
  isPending,
  errorText,
  onSubmit,
  onDelete,
  onCancel,
}: {
  draft: ShapeDraft;
  locations: Location[];
  isPending: boolean;
  errorText?: string;
  onSubmit: (body: MapShapeInput) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const e = draft.existing;
  const area = draft.kind === "area";
  const [label, setLabel] = useState(e?.label ?? "");
  const [color, setColor] = useState(e?.color ?? (area ? "#7d9b6a" : "#c96a5a"));
  const [dashed, setDashed] = useState(e?.dashed ?? false);
  const [width, setWidth] = useState(e?.width ?? 0.004);
  const [opacity, setOpacity] = useState(e?.opacity ?? 0.25);
  const [dmOnly, setDmOnly] = useState(e?.dmOnly ?? false);
  const [locationId, setLocationId] = useState(e?.locationId ?? "");

  function submit(ev: FormEvent) {
    ev.preventDefault();
    onSubmit({
      kind: draft.kind,
      points: draft.points,
      label: label.trim(),
      color,
      dashed,
      width,
      opacity,
      dmOnly,
      // Absent keeps what is set; the nil UUID detaches, as everywhere else.
      locationId: locationId || NIL_UUID,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 text-ink-strong">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">{area ? "Name of the region" : "Name of the road"}</span>
        <input
          autoFocus
          value={label}
          onChange={(ev) => setLabel(ev.target.value)}
          maxLength={80}
          placeholder={area ? "e.g. Barovia" : "e.g. the High Road"}
          className="input-parchment input-compact"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="field-label">Ink</span>
        <div className="flex flex-wrap gap-1.5">
          {INKS.map(([hex, name]) => (
            <button
              key={hex}
              type="button"
              onClick={() => setColor(hex)}
              aria-label={name}
              title={name}
              className="h-7 w-7 rounded-[3px] transition"
              style={{
                background: hex,
                boxShadow:
                  color === hex
                    ? "0 0 0 2px rgba(60,35,15,.85), inset 0 0 0 1px rgba(255,255,255,.35)"
                    : "inset 0 0 0 1px rgba(60,35,15,.35)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">{area ? "Border weight" : "Width"}</span>
          <input
            type="range"
            min={0.0008}
            max={0.02}
            step={0.0004}
            value={width}
            onChange={(ev) => setWidth(Number(ev.target.value))}
            className="w-full"
          />
        </label>
        {area && (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Tint</span>
            <input
              type="range"
              min={0.05}
              max={0.7}
              step={0.05}
              value={opacity}
              onChange={(ev) => setOpacity(Number(ev.target.value))}
              className="w-full"
            />
          </label>
        )}
      </div>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={dashed}
          onChange={(ev) => setDashed(ev.target.checked)}
          className="h-4 w-4 cursor-pointer accent-[#8b2520]"
        />
        <span className="font-body text-sm">
          {area ? "Dashed border — a claim rather than a settled line" : "Dashed — a track, not a paved road"}
        </span>
      </label>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={dmOnly}
          onChange={(ev) => setDmOnly(ev.target.checked)}
          className="h-4 w-4 cursor-pointer accent-[#8b2520]"
        />
        <span className="font-body text-sm">Yours alone — the table never receives it</span>
      </label>

      {locations.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="field-label">A place it stands for (optional)</span>
          <select
            value={locationId}
            onChange={(ev) => setLocationId(ev.target.value)}
            className="input-parchment input-compact cursor-pointer"
          >
            <option value="">— none —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="font-body text-[12px] italic text-ink-body">
            Tint Barovia and clicking it opens Barovia. The place still rules who
            may know it — this only draws where it is.
          </span>
        </label>
      )}

      <div className="torn-divider" />

      {errorText && <p className="font-body m-0 text-sm italic text-[#8b2520]">{errorText}</p>}

      <div className="flex flex-wrap gap-2.5">
        <button
          type="submit"
          disabled={isPending}
          className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
        >
          {isPending ? "Drawing…" : e ? "Save" : area ? "Draw the region" : "Draw the road"}
        </button>
        <button type="button" onClick={onCancel} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="btn-base btn-ghost-red ml-auto px-5 py-[11px] text-xs"
          >
            Rub it out
          </button>
        )}
      </div>
    </form>
  );
}
