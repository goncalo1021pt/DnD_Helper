import { useState } from "react";
import type { Campaign } from "../../api/client";
import { useSetCoinage } from "../../hooks";
import { coinageOf, formatCoins, STANDARD_COINAGE, type Coin } from "../../lib/money";

/*
Naming a table's money (#195).

#174 shipped gold only and said this would come. A DM names their own coins —
glimmer, trade bars, faction scrip — and the Bazaar prices and charges in them.

The one thing this must be honest about is that changing the ladder converts
nothing. An invented coin has no rate against the one it replaces: a shard is
not worth some number of the gold pieces it stands in for, it is simply what
this table uses now. So the numbers in every purse stand and their meaning
changes, which makes coinage a thing to settle before play rather than during
it — and the screen says so before it lets anyone through.
*/

const EXAMPLE: Coin[] = [
  { name: "Shard", abbrev: "shd", value: 1 },
  { name: "Glimmer", abbrev: "glm", value: 10 },
  { name: "Crown", abbrev: "crn", value: 100 },
];

export default function CoinageSection({ campaign }: { campaign: Campaign }) {
  const setCoinage = useSetCoinage(campaign.id);
  const current = coinageOf(campaign.coinage);
  const standard = campaign.coinage == null || campaign.coinage.length === 0;

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Coin[]>(current);
  const [confirming, setConfirming] = useState(false);

  function open() {
    setRows(coinageOf(campaign.coinage));
    setEditing(true);
    setConfirming(false);
  }

  function set(i: number, patch: Partial<Coin>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  const error = (setCoinage.error as { error?: string } | null)?.error;

  return (
    <section className="panel-hall px-6 pb-6 pt-5">
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2 className="font-display m-0 text-[21px] font-black text-[#e7d3a6]">The Coin</h2>
        <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">
          what this table counts in
        </span>
      </div>

      {!editing ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {current.map((c) => (
              <span
                key={c.abbrev}
                className="label-stamp rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-cream-soft"
                style={{ background: "rgba(255,255,255,.05)" }}
              >
                {c.name} · {c.abbrev} · {c.value === 1 ? "the base" : `${c.value}×`}
              </span>
            ))}
          </div>
          <div className="font-accent mt-3 text-[13px] italic text-cream-muted">
            {standard
              ? "The coins of the books. Prices are written “15 gp”, and a purse is counted in copper."
              : `Your own coinage. A purse of 412 reads as ${formatCoins(412, current)}.`}
          </div>
          <button onClick={open} className="btn-base btn-ghost-gold mt-4 h-9 px-4 text-[11px]">
            Mint your own
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Name</span>
                <input
                  value={c.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                  maxLength={40}
                  className="input-hall h-9 w-44 text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Written</span>
                <input
                  value={c.abbrev}
                  onChange={(e) => set(i, { abbrev: e.target.value })}
                  maxLength={8}
                  className="input-hall h-9 w-24 text-[12px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Worth</span>
                <input
                  type="number"
                  min={1}
                  value={c.value}
                  onChange={(e) => set(i, { value: Math.max(1, Number(e.target.value) || 1) })}
                  className="input-hall h-9 w-28 text-[12px] tabular-nums"
                />
              </label>
              {rows.length > 1 && (
                <button
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="btn-base btn-ghost-gold h-9 px-3 text-[10px]"
                >
                  Melt it down
                </button>
              )}
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { name: "", abbrev: "", value: Math.max(...rs.map((r) => r.value), 1) * 10 },
                ])
              }
              disabled={rows.length >= 8}
              className="btn-base btn-ghost-gold h-8 px-3 text-[10px] disabled:opacity-40"
            >
              Another rung
            </button>
            <button
              onClick={() => setRows(EXAMPLE)}
              className="btn-base btn-ghost-gold h-8 px-3 text-[10px]"
            >
              Try shards and crowns
            </button>
            <button
              onClick={() => setRows(STANDARD_COINAGE)}
              className="btn-base btn-ghost-gold h-8 px-3 text-[10px]"
            >
              Back to the books
            </button>
          </div>

          <div
            className="font-body rounded-[3px] px-3.5 py-3 text-[12.5px] italic leading-relaxed text-[#e6b98a]"
            style={{ background: "rgba(201,120,39,.09)", border: "1px solid rgba(201,120,39,.3)" }}
          >
            Nothing is exchanged. Every purse keeps its number and that number is
            read in the new base — a hero holding 12,000 now holds 12,000 shards
            rather than 12,000 copper. Settle your coinage before play, not during it.
          </div>

          {error && <p className="font-body m-0 text-sm italic text-[#c98a6a]">{error}</p>}

          <div className="flex flex-wrap gap-2">
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="btn-base btn-gold clip-octagon h-9 px-4 text-[11px]"
              >
                Mint it
              </button>
            ) : (
              <button
                onClick={() =>
                  setCoinage.mutate(
                    // The books' own ladder is not a custom one: sending it
                    // empty puts the table back on the default rather than
                    // freezing a copy of it.
                    JSON.stringify(rows) === JSON.stringify(STANDARD_COINAGE) ? [] : rows,
                    { onSuccess: () => setEditing(false) },
                  )
                }
                disabled={setCoinage.isPending}
                className="btn-base btn-ember clip-octagon h-9 px-4 text-[11px]"
              >
                {setCoinage.isPending ? "Minting…" : "Yes — change what this table counts in"}
              </button>
            )}
            <button
              onClick={() => setEditing(false)}
              className="btn-base btn-ghost-gold h-9 px-4 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
