/*
An item on a hero's sheet, in its owner's own words (#396).

Every row can be renamed and carry a note ("engraved with the family crest"). A
row written in rather than taken from the armory can also carry stats of its own
— the Archives' item fields — which is how a hero comes to own a sword nobody
authored as homebrew. At a table the numbers are the table's (#378), so a seated
hero's player is offered the name and the note, and the DM the whole thing.
*/

import { useState } from "react";
import type { InventoryItem } from "../../api/client";
import ParchmentModal from "../ui/ParchmentModal";
import ItemFields from "../content/fields/ItemFields";
import type { DataObj } from "../content/fields/shared";

const field = "input-parchment input-compact";

/** What the editor hands back. `data` is `undefined` to leave the stats alone,
 *  `{}` to clear them, or the stats to set. */
export interface ItemEdit {
  name: string;
  notes: string;
  data?: DataObj;
}

// The fields a type needs before the server will take it — the form shows
// defaults it has not yet written down.
const SEED: Record<string, DataObj> = {
  gear: {},
  armor: { category: "Light", ac: 11 },
  shield: { acBonus: 2 },
  weapon: { category: "Simple", damage: "1d6", damageType: "slashing" },
};

export default function ItemEditor({
  item,
  canStats,
  pending,
  onSave,
  onClose,
}: {
  /** The row being edited; absent when writing a new item in. */
  item?: InventoryItem;
  /** Whether the viewer may write the numbers (not a seated player). */
  canStats: boolean;
  pending: boolean;
  onSave: (edit: ItemEdit) => void;
  onClose: () => void;
}) {
  const linked = !!item?.content;
  const [name, setName] = useState(item?.name ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const own = (item?.customData ?? null) as DataObj | null;
  const [hasStats, setHasStats] = useState(!!own);
  const [data, setData] = useState<DataObj>(own ?? { type: "gear" });
  const offerStats = canStats && !linked;

  const props = {
    data,
    set: (key: string, value: unknown) =>
      setData(key === "type" ? { type: value, ...SEED[value as string] } : { ...data, [key]: value }),
    patch: (values: DataObj) => setData({ ...data, ...values }),
    strArr: (key: string): string[] => (Array.isArray(data[key]) ? (data[key] as string[]) : []),
    classNames: [],
  };

  function save() {
    const edit: ItemEdit = { name: name.trim(), notes: notes.trim() };
    if (offerStats) {
      if (hasStats) edit.data = data;
      else if (own) edit.data = {};
    }
    onSave(edit);
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
        {item ? "Edit item" : "Custom item"}
      </h3>
      <div className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Name</span>
          <input
            className={field}
            value={name}
            maxLength={80}
            placeholder={linked ? "As the armory has it" : "e.g. Grandfather's Longsword"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Note</span>
          <textarea
            className={`${field} min-h-[64px] resize-y`}
            value={notes}
            maxLength={500}
            placeholder="Engraved with the family crest"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {offerStats && (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={hasStats} onChange={(e) => setHasStats(e.target.checked)} />
              <span className="field-label">Give it stats of its own</span>
            </label>
            {hasStats && <ItemFields {...props} />}
          </>
        )}
        {!canStats && !linked && (
          <p className="font-accent m-0 text-[12px] italic text-ink-body">
            At a table an item's numbers are the DM's — you can name it and write a note.
          </p>
        )}
        {linked && (
          <p className="font-accent m-0 text-[12px] italic text-ink-body">
            Its numbers come from the armory. Write an item in to give it stats of its own.
          </p>
        )}
      </div>
      <div className="mt-5 flex items-center justify-end gap-3">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={pending || (!item && !name.trim())}
          className="btn-base btn-gold clip-octagon h-10 px-6 text-xs"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </ParchmentModal>
  );
}
