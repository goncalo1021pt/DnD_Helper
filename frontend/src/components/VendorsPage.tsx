import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { Vendor, VendorStock } from "../api/client";
import type { CampaignContext } from "./CampaignView";
import {
  useAddStock,
  useBuyStock,
  useCharacterDetail,
  useCharacters,
  useCreateVendor,
  useDeleteStock,
  useDeleteVendor,
  useLocations,
  useRules,
  useUpdateStock,
  useUpdateVendor,
  useVendors,
} from "../hooks";
import { coinageOf, formatCoins, priceBase, type Coin } from "../lib/money";
import ContentEntry from "./ui/ContentEntry";
import ParchmentModal from "./ui/ParchmentModal";
import { IconPlus, IconTrash } from "./ui/icons";

/**
 * The Bazaar (#102): who trades where, and what is on their shelves — and the
 * till that takes money (#174). A revealed, priced line has a Buy: gold
 * leaves the hero's purse, the item lands in their pack, the chronicle says
 * so. Prices stay free text; one the till cannot read is a story, not a sale.
 *
 * A player only ever receives revealed shops and revealed lines, so this page
 * does no hiding of its own. What arrives is what they are allowed to know.
 */

/** The buyer at the counter: which hero, and what their purse holds. */
export interface Buyer {
  heroId: string;
  gold: number;
}

export default function VendorsPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: vendors, isLoading } = useVendors(campaign.id);
  const { data: places } = useLocations(campaign.id);
  const { data: party } = useCharacters(campaign.id);
  const create = useCreateVendor(campaign.id);
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [reading, setReading] = useState<VendorStock | null>(null);

  // Whose coin is on the counter. One seated hero needs no asking; a stable
  // of them gets a select. The purse is read the way the sheet reads it —
  // the first content-less "Gold Pieces" row.
  const myHeroes = useMemo(() => (party ?? []).filter((c) => c.mine), [party]);
  const [buyingAs, setBuyingAs] = useState("");
  const heroId = buyingAs || myHeroes[0]?.id || "";
  const { data: heroDetail } = useCharacterDetail(!isDM && heroId ? heroId : undefined);
  const purse = heroDetail?.items.find((i) => i.isPurse);
  const buyer: Buyer | null =
    !isDM && heroId ? { heroId, gold: purse?.qty ?? 0 } : null;
  // What this table counts in. Absent means the standard coins.
  const ladder = coinageOf(campaign.coinage);

  // Grouped by the place they trade in, because that is how a party meets them
  // — "we're in Phandalin, who's open?" — and unfiled shops last.
  const byPlace = useMemo(() => {
    const groups = new Map<string, Vendor[]>();
    for (const v of vendors ?? []) {
      const key = v.locationName ?? "";
      groups.set(key, [...(groups.get(key) ?? []), v]);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [vendors]);

  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div>
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Bazaar
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {isDM
              ? "Stock a shop at home; show the party what they can see of it."
              : "Who trades where, and what they have out on the counter."}
          </div>
        </div>
        {buyer && (
          <div className="flex items-center gap-2">
            {myHeroes.length > 1 && (
              <select
                value={heroId}
                onChange={(e) => setBuyingAs(e.target.value)}
                aria-label="Buying as"
                className="input-hall h-8 w-[170px] text-[12px]"
              >
                {myHeroes.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            )}
            <span
              className="label-stamp rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-gold-muted tabular-nums"
              style={{ background: "rgba(201,162,39,.10)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}
            >
              {formatCoins(buyer.gold, ladder)}
            </span>
          </div>
        )}
      </div>

      {isDM && (
        <form
          className="mb-6 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate(
              { name: name.trim(), locationId: where || null },
              { onSuccess: () => { setName(""); setWhere(""); } },
            );
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Open a shop — name it…"
            className="input-hall min-w-0 flex-1 basis-[240px] sm:max-w-[320px]"
          />
          <select
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            aria-label="Where it trades"
            className="input-hall w-[190px]"
          >
            <option value="">Filed nowhere</option>
            {(places ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px] disabled:opacity-40"
          >
            <IconPlus size={15} strokeWidth={2} />
            Open
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Asking around the market…
        </div>
      ) : (vendors ?? []).length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          {isDM
            ? "No shops yet — open one, and file it where the party will find it."
            : "Nobody is trading that you know of. Yet — the shops you are shown keep their counters here."}
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {byPlace.map(([place, shops]) => (
            <section key={place || "nowhere"}>
              <div className="label-stamp mb-2 text-[10px] tracking-[3px] text-gold-muted">
                {place || "Filed nowhere"}
              </div>
              <div className="flex flex-col gap-3">
                {shops.map((v) => (
                  <VendorCard
                    key={v.id}
                    campaignId={campaign.id}
                    vendor={v}
                    buyer={buyer}
                    ladder={ladder}
                    onRead={setReading}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {reading?.item && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[560px]">
          <ContentEntry entry={reading.item} />
        </ParchmentModal>
      )}
    </div>
  );
}

function VendorCard({
  campaignId,
  vendor,
  buyer,
  ladder,
  onRead,
}: {
  campaignId: string;
  vendor: Vendor;
  buyer: Buyer | null;
  /** The coins this table counts in (#195). */
  ladder: Coin[];
  onRead: (s: VendorStock) => void;
}) {
  const update = useUpdateVendor(campaignId);
  const remove = useDeleteVendor(campaignId);
  const addStock = useAddStock(campaignId);
  const updateStock = useUpdateStock(campaignId);
  const removeStock = useDeleteStock(campaignId);
  const buy = useBuyStock(campaignId);
  const { data: items } = useRules("item", vendor.isDM);
  const [picking, setPicking] = useState("");
  const [writeIn, setWriteIn] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newQty, setNewQty] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(vendor.description);
  const [receipt, setReceipt] = useState("");

  const reveal = (revealed: boolean) =>
    update.mutate({ vendorId: vendor.id, body: { name: vendor.name, revealed } });

  const stockIt = () => {
    if (!picking && !writeIn.trim()) return;
    addStock.mutate(
      {
        vendorId: vendor.id,
        body: {
          contentId: picking || undefined,
          name: writeIn.trim() || undefined,
          price: newPrice.trim() || undefined,
          qty: newQty === "" ? undefined : Number(newQty),
        },
      },
      { onSuccess: () => { setPicking(""); setWriteIn(""); setNewPrice(""); setNewQty(""); } },
    );
  };

  return (
    <div
      className="rounded-[4px] p-3.5"
      style={{ background: "rgba(0,0,0,.12)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.16)" }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[16px] font-bold text-[#e7d3a6]">{vendor.name}</div>
        {vendor.isDM && (
          <div className="flex items-center gap-2">
            {/* The shopfront switch. A shop the party has not met is the DM's
                alone; revealing it is a deliberate act, like handing over a
                creature's record in the bestiary. */}
            <button
              onClick={() => reveal(!vendor.revealed)}
              aria-pressed={vendor.revealed}
              className="label-stamp rounded-[2px] px-2 py-1 text-[9px] tracking-[1px]"
              style={{
                color: vendor.revealed ? "#e6d2a0" : "#8a7b60",
                background: vendor.revealed ? "rgba(201,162,39,.12)" : "transparent",
                boxShadow: `inset 0 0 0 1px rgba(201,162,39,${vendor.revealed ? ".34" : ".14"})`,
              }}
            >
              {vendor.revealed ? "The party knows it" : "Hidden from the party"}
            </button>
            <button
              onClick={() => setEditingDesc((on) => !on)}
              aria-label={`Describe ${vendor.name}`}
              className="btn-base btn-ghost-gold h-7 px-2 py-0 text-[10px]"
            >
              Describe
            </button>
            <button
              onClick={() => {
                if (confirm(`Close "${vendor.name}" and empty its shelves?`)) {
                  remove.mutate(vendor.id);
                }
              }}
              aria-label={`Close ${vendor.name}`}
              className="btn-base btn-ghost-red h-7 px-2 py-0 text-[11px]"
            >
              <IconTrash size={12} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {editingDesc ? (
        <div className="mb-2 flex flex-col gap-2">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            aria-label={`Description of ${vendor.name}`}
            placeholder="What the party smells, hears and haggles with in here…"
            className="input-hall min-h-[52px] w-full text-[12.5px]"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                update.mutate(
                  { vendorId: vendor.id, body: { name: vendor.name, description: desc } },
                  { onSuccess: () => setEditingDesc(false) },
                )
              }
              disabled={update.isPending}
              className="btn-base btn-gold h-7 px-3 text-[10px]"
            >
              Save
            </button>
            <button
              onClick={() => { setDesc(vendor.description); setEditingDesc(false); }}
              className="btn-base btn-ghost-gold h-7 px-3 text-[10px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        vendor.description && (
          <div className="font-accent mb-2 text-[12.5px] italic text-cream-muted">
            {vendor.description}
          </div>
        )
      )}

      {vendor.stock.length === 0 ? (
        <div className="font-accent py-1 text-[12.5px] italic text-cream-muted">
          {vendor.isDM ? "Nothing on the shelves yet." : "Nothing out on the counter."}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {vendor.stock.map((line) => (
            <StockRow
              // Price and qty in the key: a change landing from the server —
              // another window's edit, a sale — remounts the row so the DM's
              // draft inputs never show yesterday's ink.
              key={`${line.id}:${line.price}:${line.qty ?? "∞"}`}
              line={line}
              isDM={vendor.isDM}
              buyer={buyer}
              ladder={ladder}
              onRead={onRead}
              onPatch={(body) => updateStock.mutate({ stockId: line.id, body })}
              onDelete={() => removeStock.mutate(line.id)}
              onBuy={(heroId) =>
                buy.mutate(
                  { stockId: line.id, characterId: heroId },
                  {
                    onSuccess: (r) =>
                      setReceipt(
                        `Paid ${formatCoins(r.paidGp, ladder)} for ${line.name} — ` +
                          `${formatCoins(r.goldRemaining, ladder)} left in the purse.`,
                      ),
                  },
                )
              }
              buying={buy.isPending}
            />
          ))}
        </div>
      )}

      {receipt && (
        <div className="font-accent mt-2 text-[12px] italic text-[#8fb15f]" role="status">
          {receipt}
        </div>
      )}

      {vendor.isDM && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select
            value={picking}
            onChange={(e) => setPicking(e.target.value)}
            aria-label={`Stock ${vendor.name}`}
            className="input-hall h-8 w-[200px] text-[12px]"
          >
            <option value="">Put something on the shelves…</option>
            {(items ?? []).map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <input
            value={writeIn}
            onChange={(e) => setWriteIn(e.target.value)}
            placeholder="…or write a line in"
            maxLength={80}
            aria-label={`Write a line into ${vendor.name}`}
            className="input-hall h-8 w-[150px] text-[12px]"
          />
          <input
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="price"
            aria-label="Price for the new line"
            className="input-hall h-8 w-[90px] text-[12px]"
          />
          <input
            value={newQty}
            onChange={(e) => setNewQty(e.target.value.replace(/\D/g, ""))}
            placeholder="qty"
            inputMode="numeric"
            aria-label="Quantity for the new line"
            title="Leave blank for as many as you like"
            className="input-hall h-8 w-[64px] text-[12px]"
          />
          <button
            onClick={stockIt}
            disabled={(!picking && !writeIn.trim()) || addStock.isPending}
            className="btn-base btn-ghost-gold h-8 px-3 text-[11px] disabled:opacity-40"
          >
            Stock it
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One shelf line. For the DM the price and count are ink still wet — inline
 * inputs committing on blur or Enter; for a player they are the offer, and a
 * Buy button that knows why it is disabled.
 */
function StockRow({
  line,
  isDM,
  buyer,
  ladder,
  onRead,
  onPatch,
  onDelete,
  onBuy,
  buying,
}: {
  line: VendorStock;
  isDM: boolean;
  buyer: Buyer | null;
  /** The coins this table counts in (#195). */
  ladder: Coin[];
  onRead: (s: VendorStock) => void;
  onPatch: (body: { price?: string; qty?: number | null; revealed?: boolean }) => void;
  onDelete: () => void;
  onBuy: (heroId: string) => void;
  buying: boolean;
}) {
  const [price, setPrice] = useState(line.price);
  const [qty, setQty] = useState(line.qty == null ? "" : String(line.qty));
  const soldOut = line.qty === 0;
  const cost = priceBase(line.price, ladder);

  const commitPrice = () => {
    if (price.trim() !== line.price) onPatch({ price: price.trim() });
  };
  const commitQty = () => {
    const next = qty === "" ? null : Number(qty);
    if (next !== (line.qty ?? null)) onPatch({ qty: next });
  };

  const buyBlocked =
    !buyer ? "no seated hero to buy with"
    : cost === null ? "no price the till can take"
    : soldOut ? "sold out"
    : buyer.gold < cost ? `not enough — ${formatCoins(cost, ladder)} asked`
    : "";

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <button
        onClick={() => line.item && onRead(line)}
        disabled={!line.item}
        className="font-heading cursor-pointer border-none bg-transparent p-0 text-left text-[13px] text-[#e6d2a0] disabled:cursor-default"
      >
        {line.name}
      </button>

      {isDM ? (
        <>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => e.key === "Enter" && commitPrice()}
            aria-label={`Price of ${line.name}`}
            placeholder="—"
            title={
              price.trim() && priceBase(price, ladder) === null
                ? "Players cannot buy a line priced like this — the till reads coin, not prose"
                : undefined
            }
            className="input-hall h-7 w-[90px] text-[12px] tabular-nums"
            style={
              price.trim() && priceBase(price, ladder) === null
                ? { boxShadow: "inset 0 0 0 1px rgba(201,120,39,.6)" }
                : undefined
            }
          />
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
            onBlur={commitQty}
            onKeyDown={(e) => e.key === "Enter" && commitQty()}
            aria-label={`Stock of ${line.name}`}
            placeholder="∞"
            inputMode="numeric"
            title="Blank is as many as you like"
            className="input-hall h-7 w-[56px] text-[12px] tabular-nums"
          />
        </>
      ) : (
        <>
          <span className="text-gold-muted tabular-nums">{line.price || "—"}</span>
          {line.qty != null && !soldOut && (
            <span className="label-stamp text-[9px] tracking-[1px] text-cream-muted">
              ×{line.qty}
            </span>
          )}
        </>
      )}

      {soldOut && (
        <span
          className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8px] tracking-[1px]"
          style={{ color: "#c96a5a", boxShadow: "inset 0 0 0 1px rgba(201,106,90,.4)" }}
        >
          sold out
        </span>
      )}

      {!isDM && buyer && (
        <button
          onClick={() => onBuy(buyer.heroId)}
          disabled={!!buyBlocked || buying}
          aria-label={`Buy ${line.name}`}
          title={buyBlocked || `${cost} gp from the purse`}
          className="btn-base btn-ghost-gold h-7 px-2.5 py-0 text-[10px] disabled:opacity-35"
        >
          Buy
        </button>
      )}

      {isDM && (
        <>
          <button
            onClick={() => onPatch({ revealed: !line.revealed })}
            aria-pressed={line.revealed}
            aria-label={`${line.revealed ? "Hide" : "Show"} ${line.name}`}
            className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8px] tracking-[1px]"
            style={{
              color: line.revealed ? "#8fb15f" : "#8a7b60",
              boxShadow: `inset 0 0 0 1px rgba(201,162,39,${line.revealed ? ".3" : ".12"})`,
            }}
          >
            {line.revealed ? "on the counter" : "under it"}
          </button>
          <button
            onClick={onDelete}
            aria-label={`Take ${line.name} off the shelves`}
            className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-[#c96a5a]"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
