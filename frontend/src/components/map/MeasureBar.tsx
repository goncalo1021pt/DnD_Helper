import { useState } from "react";
import type { CampaignMap, MapPoint } from "../../api/client";
import { distanceLine, runDistance, scaleFor, type ScaleUnit } from "../../lib/mapScale";

/*
The measuring bar (#357): tap, tap, tap, and it says how far. Nothing is kept.

On a DM's bar the same run is how a map gets its scale — measure between two
places whose distance you know, say what it is, and the map takes it. One
gesture for both, so there is no second tool to find.
*/

export function MeasureBar({
  map,
  points,
  isDM,
  pending,
  onUndo,
  onClear,
  onDone,
  onScale,
}: {
  map: CampaignMap;
  points: MapPoint[];
  isDM: boolean;
  pending: boolean;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  /** Distance across the whole width, or 0 to take the scale off. */
  onScale: (distance: number, unit: ScaleUnit) => void;
}) {
  const [setting, setSetting] = useState(false);
  const [said, setSaid] = useState("");
  const [unit, setUnit] = useState<ScaleUnit>(map.scale?.unit ?? "miles");
  const d = runDistance(points, map);
  const saidNumber = Number(said.replace(",", "."));
  const across = points.length >= 2 ? scaleFor(points, map, saidNumber) : null;

  const linkClass =
    "label-stamp cursor-pointer border-none bg-transparent text-[10px] font-semibold tracking-[1px] text-gold-muted transition hover:text-ember-bright disabled:opacity-40";

  return (
    <div
      data-map-overlay
      data-testid="measure-bar"
      className="absolute left-1/2 top-3 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-[3px] px-3.5 py-2"
      style={{ background: "rgba(16,9,5,.88)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.4)" }}
    >
      <span className="label-stamp text-[10px] tracking-[1.5px] text-[#f0dfb8]" data-testid="measure-reading">
        {points.length < 2
          ? map.scale
            ? "Tap to measure"
            : "Tap to measure — this map has no scale yet"
          : d !== null && map.scale
            ? distanceLine(d, map.scale.unit)
            : "No scale yet"}
      </span>
      {points.length > 0 && (
        <button onClick={onUndo} className={linkClass}>
          Undo
        </button>
      )}
      {points.length > 0 && (
        <button onClick={onClear} className={linkClass}>
          Clear
        </button>
      )}
      {isDM && !setting && (
        <button onClick={() => setSetting(true)} className={linkClass}>
          {map.scale ? "Change scale" : "Set scale"}
        </button>
      )}
      <button onClick={onDone} className="btn-base btn-gold h-7 px-3 py-0 text-[10px]">
        Done
      </button>
      {isDM && setting && (
        <form
          className="flex w-full flex-wrap items-center justify-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (across) onScale(across, unit);
            setSetting(false);
            setSaid("");
          }}
        >
          <span className="font-body text-[12.5px] text-cream-muted">
            {points.length < 2 ? "Measure between two places you know, then: that is" : "That is"}
          </span>
          <input
            value={said}
            onChange={(e) => setSaid(e.target.value)}
            inputMode="decimal"
            aria-label="Measured distance"
            placeholder="40"
            className="input-hall h-7 w-[72px] px-2 py-0 text-[13px]"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as ScaleUnit)}
            aria-label="Unit"
            className="input-hall h-7 px-1.5 py-0 text-[13px]"
          >
            <option value="miles">miles</option>
            <option value="km">km</option>
            <option value="feet">feet</option>
          </select>
          <button
            type="submit"
            disabled={!across || pending}
            className="btn-base btn-ember h-7 px-3 py-0 text-[10px] disabled:opacity-40"
          >
            Use as scale
          </button>
          {map.scale && (
            <button
              type="button"
              onClick={() => {
                onScale(0, unit);
                setSetting(false);
              }}
              className={linkClass}
            >
              Remove scale
            </button>
          )}
          <button type="button" onClick={() => setSetting(false)} className={linkClass}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
