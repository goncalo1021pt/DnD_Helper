import { useState } from "react";
import { IconLayers } from "../ui/icons";
import type { MapView } from "./useMapView";

/*
The Legend: what is drawn on this map, and a switch for each (#355).

It is laid over the map in the corner the zoom rail leaves free, and marked
`data-map-overlay` so the viewer leaves its presses and its wheel alone — its
switches are labels, which the viewer would otherwise capture as the start of
a pan and eat the click.

Rows come in groups, and the panel knows nothing about what a group is: the
built-in kinds today, the DM's named layers next, and one group per player's
own marks after that (#356). A group with no rows is not drawn.
*/

export type LegendRow = {
  key: string;
  label: string;
  /** How many things the row switches, when that is worth saying. */
  count?: number;
  /** Whether the row is on for a viewer who has never touched it. */
  byDefault?: boolean;
};

export type LegendGroup = { title: string; rows: LegendRow[] };

export function Legend({ groups, view }: { groups: LegendGroup[]; view: MapView }) {
  const [open, setOpen] = useState(false);
  const drawn = groups.filter((g) => g.rows.length > 0);
  const rows = drawn.flatMap((g) => g.rows);
  const keys = rows.map((r) => r.key);
  const anyOn = rows.some((r) => view.shown(r.key, r.byDefault));
  const allOn = rows.every((r) => view.shown(r.key, r.byDefault));
  const hiding = rows.filter((r) => !view.shown(r.key, r.byDefault)).length;

  return (
    <div data-map-overlay className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1.5">
      {open && (
        <div
          role="group"
          aria-label="Legend"
          data-testid="map-legend"
          className="max-h-[min(50vh,420px)] w-[210px] overflow-y-auto rounded-[3px] px-3.5 py-3"
          style={{
            background: "rgba(16,9,5,.9)",
            boxShadow: "inset 0 0 0 1px rgba(201,162,39,.4), 0 6px 18px rgba(0,0,0,.5)",
          }}
        >
          {drawn.map((g) => (
            <div key={g.title} className="mb-2.5 last:mb-0">
              <div className="label-stamp mb-1.5 text-[9px] tracking-[2px] text-gold-muted">{g.title}</div>
              {g.rows.map((r) => (
                <label
                  key={r.key}
                  className="font-body flex cursor-pointer items-center gap-2 py-[3px] text-[13px] text-[#e7d3a6]"
                >
                  <input
                    type="checkbox"
                    name={`legend-${r.key}`}
                    checked={view.shown(r.key, r.byDefault)}
                    onChange={(e) => view.set(r.key, e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#c9a227]"
                  />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.count !== undefined && (
                    <span className="text-[11px] tabular-nums text-gold-muted">{r.count}</span>
                  )}
                </label>
              ))}
            </div>
          ))}
          <div className="mt-2.5 flex justify-end pt-2" style={{ borderTop: "1px solid rgba(201,162,39,.16)" }}>
            {/* "Clean map" is the whole point for a reader; once it is clean the
                same place brings everything back. */}
            <button
              onClick={() => view.setAll(keys, !anyOn)}
              className="btn-base btn-ghost-gold px-2.5 py-1.5 text-[10px]"
            >
              {anyOn ? "Clean map" : "Show all"}
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={hiding > 0 ? `${hiding} hidden` : "What is drawn on this map"}
        className="btn-base btn-ghost-gold px-3 py-2 text-[10px]"
        style={{ background: "rgba(16,9,5,.78)" }}
      >
        <IconLayers size={13} strokeWidth={1.9} />
        Legend
        {!allOn && <span className="text-ember-bright">· {hiding} off</span>}
      </button>
    </div>
  );
}
