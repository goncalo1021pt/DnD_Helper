import { useState } from "react";
import type { CampaignMap, Location, PinShape } from "../../api/client";
import { MarkerSwatch, PIN_SHAPES } from "./PinMarker";

/** What the form hands back; the page decides what absent and nil mean. */
export interface PinFormValues {
  label: string;
  note: string;
  dmOnly: boolean;
  linkMapId: string;
  locationId: string;
  shape: PinShape;
}

/* Create-or-edit pin form. */
export function PinForm({
  initial,
  maps,
  locations,
  currentMapId,
  isPending,
  errorText,
  onCancel,
  onSubmit,
}: {
  initial: PinFormValues;
  maps: CampaignMap[];
  /** The place tree, for a pin to stand for one (#312). */
  locations: Location[];
  currentMapId: string;
  isPending: boolean;
  errorText?: string;
  onCancel: () => void;
  onSubmit: (v: PinFormValues) => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [note, setNote] = useState(initial.note);
  const [dmOnly, setDmOnly] = useState(initial.dmOnly);
  const [linkMapId, setLinkMapId] = useState(initial.linkMapId);
  const [locationId, setLocationId] = useState(initial.locationId);
  const [shape, setShape] = useState<PinShape>(initial.shape);
  const targets = maps.filter((m) => m.id !== currentMapId);

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="field-label">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="The Sleeping Giant Inn"
          className="input-parchment mt-1 w-full"
        />
      </label>
      <label className="block">
        <span className="field-label">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What the party should know — or what only you should."
          className="input-parchment mt-1 w-full resize-y"
        />
      </label>
      {targets.length > 0 && (
        <label className="block">
          <span className="field-label">Leads into</span>
          <select
            value={linkMapId}
            onChange={(e) => setLinkMapId(e.target.value)}
            className="input-parchment mt-1 w-full cursor-pointer"
          >
            <option value="">Nowhere — just a marker</option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {locations.length > 0 && (
        <label className="block">
          <span className="field-label">A place it stands for</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="input-parchment mt-1 w-full cursor-pointer"
          >
            <option value="">— none —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {"— ".repeat(l.depth)}
                {l.name}
              </option>
            ))}
          </select>
          <span className="font-body mt-1 block text-[12px] italic text-ink-body">
            The pin becomes a door: press it and the place opens. The party
            receives it only once they know the place.
          </span>
        </label>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="field-label">Marker</span>
        <div className="flex flex-wrap gap-1.5">
          {PIN_SHAPES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setShape(v)}
              aria-label={v}
              title={v}
              className="flex h-8 w-8 items-center justify-center rounded-[3px] transition"
              style={{
                background: shape === v ? "rgba(139,37,32,.16)" : "rgba(60,35,15,.06)",
                boxShadow:
                  shape === v
                    ? "inset 0 0 0 1.5px rgba(139,37,32,.7)"
                    : "inset 0 0 0 1px rgba(60,35,15,.28)",
              }}
            >
              <MarkerSwatch shape={v} />
            </button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={dmOnly}
          onChange={(e) => setDmOnly(e.target.checked)}
        />
        <span className="text-[13px] text-ink-body">
          DM only — the party never sees this pin
        </span>
      </label>
      {errorText && (
        <div className="font-body text-sm italic text-[#8b2520]">{errorText}</div>
      )}
      <div className="mt-1 flex items-center justify-end gap-3">
        <button onClick={onCancel} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ label, note, dmOnly, linkMapId, locationId, shape })}
          disabled={!label.trim() || isPending}
          className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Pinning…" : "Pin it"}
        </button>
      </div>
    </div>
  );
}
