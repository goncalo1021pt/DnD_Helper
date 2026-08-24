/*
The Inkwork (#277): everything drawn on this map, as a list.

#262 gave a shape one way in — press the thing on the map. That was the whole
of it, and it did not work: the viewer captured the press for panning before it
ever reached the mark, so the Rub it out button sitting inside the form could
not be reached by anybody. The press is fixed in ShapeLayer; this is the other
half, and the half a DM actually looks for.

A hairline is a poor handle even when it answers. A road running under fog is
clipped away from the ground the DM is looking at, a region can sit behind
another, and a run drawn at the far corner is off the screen entirely — none of
them can be pressed, and all of them can be listed. So the Atlas's shape,
applied to what is drawn rather than to what it is drawn on: a row per thing,
the strike on the row it strikes.

It replaces the old Draw button's first act, too. Pressing Draw used to drop
straight into line mode and then ask Road or Region in the bar; now it opens
here, which asks the same question one step earlier and shows the answers to
the last one.
*/

import { useState } from "react";
import type { MapShape } from "../../api/client";
import ParchmentModal from "../ui/ParchmentModal";
import { IconEyeOff, IconPencil, IconTrash } from "../ui/icons";

/** A road is its ink drawn along; a region is its ink filled in. */
function InkSwatch({ shape }: { shape: MapShape }) {
  const area = shape.kind === "area";
  return (
    <span
      aria-hidden="true"
      className="flex-none rounded-[2px]"
      style={{
        width: 22,
        height: area ? 14 : 4,
        background: area ? shape.color : "transparent",
        opacity: area ? Math.max(shape.opacity, 0.35) : 1,
        boxShadow: area
          ? `inset 0 0 0 1px ${shape.color}`
          : `inset 0 0 0 2px ${shape.color}`,
      }}
    />
  );
}

export function InkworkModal({
  shapes,
  isPending,
  onEdit,
  onDraw,
  onDelete,
  onClose,
}: {
  shapes: MapShape[];
  isPending: boolean;
  /** Open one for renaming or restyling — the same form drawing one ends in. */
  onEdit: (shape: MapShape) => void;
  /** Start a fresh run of the given kind; the modal closes behind it. */
  onDraw: (kind: "line" | "area") => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [striking, setStriking] = useState("");

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[460px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        The Map
      </div>
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
        The Inkwork
      </h3>

      {shapes.length === 0 ? (
        <div className="font-accent py-6 text-center text-sm italic text-ink-faded">
          Nothing is drawn on this map yet.
        </div>
      ) : (
        <div className="flex flex-col">
          {shapes.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 border-0 border-b border-solid py-2"
              style={{ borderColor: "rgba(74,55,28,.14)" }}
            >
              <InkSwatch shape={s} />
              <button
                onClick={() => onEdit(s)}
                title={`Open ${s.label || (s.kind === "area" ? "this region" : "this road")}`}
                className="font-heading min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-[14px] text-ink transition hover:text-[#8b2520]"
              >
                {s.label || (
                  <span className="font-accent italic text-ink-faded">
                    {s.kind === "area" ? "an unnamed region" : "an unnamed road"}
                  </span>
                )}
              </button>

              {/* A shape that stands for a place says so — pressing it on the
                  map opens that place, which is worth knowing before you
                  strike it. */}
              {s.locationName && (
                <span className="font-accent flex-none text-[11px] italic text-ink-label">
                  {s.locationName}
                </span>
              )}
              {s.dmOnly && (
                <span
                  className="flex items-center text-ink-faded"
                  title="Yours alone — the table never receives it"
                >
                  <IconEyeOff size={12} strokeWidth={1.8} />
                </span>
              )}

              {striking === s.id ? (
                <span className="flex items-center gap-1.5">
                  <span className="font-body text-[11px] italic text-[#8b2520]">
                    Gone for good.
                  </span>
                  <button
                    onClick={() => {
                      onDelete(s.id);
                      setStriking("");
                    }}
                    disabled={isPending}
                    className="btn-base btn-ghost-red px-2 py-1 text-[10px]"
                  >
                    {isPending ? "Rubbing…" : "Rub it out"}
                  </button>
                  <button
                    onClick={() => setStriking("")}
                    className="btn-base btn-ghost-ink px-2 py-1 text-[10px]"
                  >
                    Keep it
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => onEdit(s)}
                    aria-label={`Redraw ${s.label || "this shape"}`}
                    title="Rename or restyle it"
                    className="btn-base btn-ghost-ink h-7 px-2 py-0 text-[11px]"
                  >
                    <IconPencil size={12} strokeWidth={1.8} />
                  </button>
                  <button
                    onClick={() => setStriking(s.id)}
                    aria-label={`Rub out ${s.label || "this shape"}`}
                    title="Rub it out"
                    className="btn-base btn-ghost-red h-7 px-2 py-0 text-[11px]"
                  >
                    <IconTrash size={12} strokeWidth={1.8} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="field-label mr-1">Draw</span>
        <button
          onClick={() => onDraw("line")}
          className="btn-base btn-wax clip-octagon h-10 px-4 text-[12px]"
        >
          A road
        </button>
        <button
          onClick={() => onDraw("area")}
          className="btn-base btn-ghost-ink h-10 px-4 text-[12px]"
        >
          A region
        </button>
        <button
          onClick={onClose}
          className="btn-base btn-ghost-ink ml-auto px-5 py-[11px] text-xs"
        >
          Close
        </button>
      </div>
    </ParchmentModal>
  );
}
