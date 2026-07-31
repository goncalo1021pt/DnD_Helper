import { useState } from "react";
import type { CampaignMap } from "../../api/client";

/* Create-or-edit pin form. */
export function PinForm({
  initial,
  maps,
  currentMapId,
  isPending,
  errorText,
  onCancel,
  onSubmit,
}: {
  initial: { label: string; note: string; dmOnly: boolean; linkMapId: string };
  maps: CampaignMap[];
  currentMapId: string;
  isPending: boolean;
  errorText?: string;
  onCancel: () => void;
  onSubmit: (v: { label: string; note: string; dmOnly: boolean; linkMapId: string }) => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [note, setNote] = useState(initial.note);
  const [dmOnly, setDmOnly] = useState(initial.dmOnly);
  const [linkMapId, setLinkMapId] = useState(initial.linkMapId);
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
          onClick={() => onSubmit({ label, note, dmOnly, linkMapId })}
          disabled={!label.trim() || isPending}
          className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Pinning…" : "Pin it"}
        </button>
      </div>
    </div>
  );
}
