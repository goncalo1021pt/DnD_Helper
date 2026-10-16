/*
The table's own starting packs (#390).

The books' options for every class and background are always on offer when a DM
hands a hero their start; this is where a table writes its own — "Wild-west
drifter", "Temple orphan" — items from the armory or written in, and coin in the
table's own money. A pack is only a gift with a name: nothing here puts anything
in a pack until the DM gives it.
*/

import { useState } from "react";
import type { Campaign, CustomPack } from "../../api/client";
import { useCampaignPacks, useDeletePack, useSavePack } from "../../hooks";
import { coinageOf, goldRung, priceBase } from "../../lib/money";
import ParchmentModal from "../ui/ParchmentModal";
import ItemLinesEditor, { type Line } from "./ItemLinesEditor";

const field = "input-parchment input-compact";

function describe(p: CustomPack): string {
  const parts = p.items.map((i) => ((i.qty ?? 1) > 1 ? `${i.qty}× ${i.name}` : (i.name ?? "")));
  if (p.coin) parts.push(p.coin);
  return parts.join(", ");
}

function PackEditor({
  campaign,
  pack,
  onClose,
}: {
  campaign: Campaign;
  pack?: CustomPack;
  onClose: () => void;
}) {
  const save = useSavePack(campaign.id);
  const ladder = coinageOf(campaign.coinage);
  const [name, setName] = useState(pack?.name ?? "");
  const [lines, setLines] = useState<Line[]>(
    (pack?.items ?? []).map((i, n) => ({ key: `${i.contentId ?? i.name}-${n}`, contentId: i.contentId, name: i.name ?? "", qty: i.qty ?? 1 })),
  );
  // An existing pack's coin is shown as it was written; a new amount is typed
  // as a number in a coin.
  const [coinText, setCoinText] = useState(pack?.coin ?? "");
  const [amount, setAmount] = useState("");
  const [coinIdx, setCoinIdx] = useState(goldRung(ladder));

  const typed = amount.trim() ? `${amount.trim()} ${ladder[coinIdx].abbrev}` : "";
  const coin = typed || coinText;
  const badCoin = typed !== "" && priceBase(typed, ladder) === null;
  const ready = name.trim() !== "" && (lines.length > 0 || coin !== "") && !badCoin;
  const error = (save.error as { error?: string } | null)?.error;

  function submit() {
    save.mutate(
      {
        packId: pack?.id,
        body: {
          name: name.trim(),
          items: lines.map((l) => ({ contentId: l.contentId, name: l.contentId ? undefined : l.name, qty: l.qty })),
          coin: coin || undefined,
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[540px]">
      <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">
        {pack ? "Edit pack" : "New pack"}
      </h3>
      <label className="mb-3 flex flex-col gap-1">
        <span className="field-label">Name</span>
        <input className={`${field} w-full`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Temple orphan" />
      </label>
      <div className="mb-3">
        <div className="field-label mb-1.5">Items</div>
        <ItemLinesEditor lines={lines} onChange={setLines} />
      </div>
      <div className="mb-4">
        <div className="field-label mb-1.5">Coin</div>
        {coinText && !typed && (
          <div className="mb-1.5 flex items-center gap-2 text-[12.5px] text-ink">
            <strong className="font-heading">{coinText}</strong>
            <button type="button" onClick={() => setCoinText("")} className="btn-base btn-ghost-ink px-2.5 py-1 text-[10px]">
              Clear
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            className={`${field} w-28`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder={coinText ? "Replace…" : "Amount"}
            aria-label="Coin amount"
          />
          <select className={`${field} w-48 cursor-pointer`} value={coinIdx} onChange={(e) => setCoinIdx(Number(e.target.value))} aria-label="Coin">
            {ladder.map((c, i) => (
              <option key={c.abbrev} value={i}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="m-0 mb-3 text-[12.5px] italic text-[#8b2520]">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        <button onClick={submit} disabled={!ready || save.isPending} className="btn-base btn-gold clip-octagon h-10 px-6 text-xs">
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </ParchmentModal>
  );
}

export default function StartingPacksSection({ campaign }: { campaign: Campaign }) {
  const { data: packs } = useCampaignPacks(campaign.id);
  const remove = useDeletePack(campaign.id);
  const [editing, setEditing] = useState<CustomPack | "new" | null>(null);

  return (
    <section className="panel-hall px-6 pb-6 pt-5">
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2 className="font-display m-0 text-[21px] font-black text-[#e7d3a6]">Starting packs</h2>
        <button onClick={() => setEditing("new")} className="btn-base btn-ghost-gold px-4 py-2 text-[11px]">
          New pack
        </button>
      </div>
      <p className="font-body m-0 mb-4 text-[13px] italic text-[#cdb582]">
        Heroes begin with an empty pack. You hand out their start from the roster
        — the books&apos; options for their class and background are always on
        offer, and the packs you write here join them.
      </p>
      {packs && packs.length === 0 && (
        <p className="font-accent m-0 text-[13px] italic text-gold-muted">No packs of your own yet.</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {(packs ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3" data-pack={p.name}>
            <div className="min-w-0 flex-1">
              <div className="font-heading text-[14px] font-bold text-[#e7d3a6]">{p.name}</div>
              <div className="text-[12px] text-[#cdb582]">{describe(p)}</div>
            </div>
            <button onClick={() => setEditing(p)} className="btn-base btn-ghost-gold px-3 py-1.5 text-[10px]">
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm(`Strike "${p.name}"? Heroes already given it keep what they were given.`)) remove.mutate(p.id);
              }}
              disabled={remove.isPending}
              className="btn-base btn-ghost-ember px-3 py-1.5 text-[10px]"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <PackEditor campaign={campaign} pack={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
