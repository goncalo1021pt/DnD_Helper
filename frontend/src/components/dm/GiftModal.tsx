/*
The DM gives (#394): items and coin into the packs of seated heroes.

One dialog behind every door — the roster's Give, a hero's card, a sheet's
inventory — so a gift reads the same wherever it is made. It speaks the table's
own money (a shard-and-crown table types shards and crowns), takes the armory
or a written-in name, and says whether the table reads about it: the hero's
owner is always told, so a ring slipped to the rogue can stay between the two.
*/

import { useState } from "react";
import type { Character } from "../../api/client";
import { useGiveGift } from "../../hooks";
import { coinageOf, goldRung, type Coin } from "../../lib/money";
import ItemLinesEditor, { type Line } from "./ItemLinesEditor";
import ParchmentModal from "../ui/ParchmentModal";

const field = "input-parchment input-compact";

export default function GiftModal({
  campaignId,
  coinage,
  heroes,
  preselect = [],
  onClose,
}: {
  campaignId: string;
  coinage: Coin[] | null | undefined;
  /** The seated heroes the DM may give to. */
  heroes: Character[];
  preselect?: string[];
  onClose: () => void;
}) {
  const give = useGiveGift(campaignId);
  const ladder = coinageOf(coinage);
  const [chosen, setChosen] = useState<string[]>(preselect);
  const [lines, setLines] = useState<Line[]>([]);
  const [amount, setAmount] = useState("");
  const [coinIdx, setCoinIdx] = useState(goldRung(ladder));
  const [note, setNote] = useState("");
  const [announce, setAnnounce] = useState(true);

  const toggle = (id: string) =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]));
  const everyone = chosen.length === heroes.length && heroes.length > 0;

  const coinText = amount.trim() ? `${amount.trim()} ${ladder[coinIdx].abbrev}` : "";
  const hasGoods = lines.length > 0 || coinText !== "";
  const ready = chosen.length > 0 && hasGoods;

  function submit() {
    give.mutate(
      {
        heroIds: chosen,
        items: lines.length
          ? lines.map((l) => ({ contentId: l.contentId, name: l.contentId ? undefined : l.name, qty: l.qty }))
          : undefined,
        coin: coinText || undefined,
        note: note.trim() || undefined,
        announce,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">Give</h3>

      <div className="mb-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="field-label">To</span>
          <button
            type="button"
            onClick={() => setChosen(everyone ? [] : heroes.map((h) => h.id))}
            className="label-stamp cursor-pointer border-none bg-transparent p-0 text-[10px] tracking-[1px] text-ink-label underline"
          >
            {everyone ? "Nobody" : "Everyone"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {heroes.map((h) => {
            const on = chosen.includes(h.id);
            return (
              <button
                key={h.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(h.id)}
                className="cursor-pointer rounded-[2px] border-none px-2.5 py-1 text-[12.5px] text-ink-body"
                style={{
                  background: on ? "rgba(139,37,32,.12)" : "rgba(120,86,42,.08)",
                  boxShadow: `inset 0 0 0 1px ${on ? "rgba(139,37,32,.45)" : "rgba(120,80,30,.2)"}`,
                }}
              >
                <strong className="font-heading text-ink">{h.name}</strong>
              </button>
            );
          })}
          {heroes.length === 0 && (
            <span className="font-accent text-[12.5px] italic text-ink-body">Nobody is seated at this table yet.</span>
          )}
        </div>
      </div>

      <div className="mb-3">
        <div className="field-label mb-1.5">Items</div>
        <ItemLinesEditor lines={lines} onChange={setLines} />
      </div>

      <div className="mb-3">
        <div className="field-label mb-1.5">Coin</div>
        <div className="flex gap-2">
          <input
            className={`${field} w-28`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="Amount"
            aria-label="Coin amount"
          />
          <select
            className={`${field} cursor-pointer`}
            value={coinIdx}
            onChange={(e) => setCoinIdx(Number(e.target.value))}
            aria-label="Coin"
          >
            {ladder.map((c, i) => (
              <option key={c.abbrev} value={i}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="mb-3 flex flex-col gap-1">
        <span className="field-label">Note</span>
        <input
          className={`${field} w-full`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Found in the vault…"
        />
      </label>

      <label className="mb-4 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-body">
        <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
        Tell the table in the Chronicle
        <span className="text-[11px] italic text-ink-label">(the hero's player is always told)</span>
      </label>

      <div className="flex items-center justify-end gap-3">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!ready || give.isPending}
          className="btn-base btn-gold clip-octagon h-10 px-6 text-xs"
        >
          {give.isPending ? "Giving…" : "Give"}
        </button>
      </div>
    </ParchmentModal>
  );
}
