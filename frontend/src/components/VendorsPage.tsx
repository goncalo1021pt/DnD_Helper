import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { Vendor, VendorStock } from "../api/client";
import type { CampaignContext } from "./CampaignView";
import {
  useAddStock,
  useCreateVendor,
  useDeleteStock,
  useDeleteVendor,
  useLocations,
  useRules,
  useUpdateStock,
  useUpdateVendor,
  useVendors,
} from "../hooks";
import ContentEntry from "./ui/ContentEntry";
import ParchmentModal from "./ui/ParchmentModal";
import { IconPlus, IconTrash } from "./ui/icons";

/**
 * The Bazaar (#102): who trades where, and what is on their shelves.
 *
 * A shop is prep, like an encounter — the DM stocks it at home and the party
 * meets it at the table — so shops are filed under a place and listed under it
 * here. No money moves: buying is a conversation, and this is the list the DM
 * reads from.
 *
 * A player only ever receives revealed shops and revealed lines, so this page
 * does no hiding of its own. What arrives is what they are allowed to know.
 */
export default function VendorsPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: vendors, isLoading } = useVendors(campaign.id);
  const { data: places } = useLocations(campaign.id);
  const create = useCreateVendor(campaign.id);
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [reading, setReading] = useState<VendorStock | null>(null);

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
            : "Nobody is trading that you know of. Yet."}
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
  onRead,
}: {
  campaignId: string;
  vendor: Vendor;
  onRead: (s: VendorStock) => void;
}) {
  const update = useUpdateVendor(campaignId);
  const remove = useDeleteVendor(campaignId);
  const addStock = useAddStock(campaignId);
  const updateStock = useUpdateStock(campaignId);
  const removeStock = useDeleteStock(campaignId);
  const { data: items } = useRules("item", vendor.isDM);
  const [picking, setPicking] = useState("");

  const reveal = (revealed: boolean) =>
    update.mutate({ vendorId: vendor.id, body: { name: vendor.name, revealed } });

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

      {vendor.description && (
        <div className="font-accent mb-2 text-[12.5px] italic text-cream-muted">
          {vendor.description}
        </div>
      )}

      {vendor.stock.length === 0 ? (
        <div className="font-accent py-1 text-[12.5px] italic text-cream-muted">
          {vendor.isDM ? "Nothing on the shelves yet." : "Nothing out on the counter."}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {vendor.stock.map((line) => (
            <div key={line.id} className="flex flex-wrap items-center gap-2 text-[13px]">
              <button
                onClick={() => line.item && onRead(line)}
                disabled={!line.item}
                className="font-heading cursor-pointer border-none bg-transparent p-0 text-left text-[13px] text-[#e6d2a0] disabled:cursor-default"
              >
                {line.name}
              </button>
              <span className="text-gold-muted tabular-nums">{line.price || "—"}</span>
              {line.qty != null && (
                <span className="label-stamp text-[9px] tracking-[1px] text-cream-muted">
                  ×{line.qty}
                </span>
              )}
              {vendor.isDM && (
                <>
                  <button
                    onClick={() =>
                      updateStock.mutate({ stockId: line.id, body: { revealed: !line.revealed } })
                    }
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
                    onClick={() => removeStock.mutate(line.id)}
                    aria-label={`Take ${line.name} off the shelves`}
                    className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-[#c96a5a]"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {vendor.isDM && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select
            value={picking}
            onChange={(e) => setPicking(e.target.value)}
            aria-label={`Stock ${vendor.name}`}
            className="input-hall h-8 w-[220px] text-[12px]"
          >
            <option value="">Put something on the shelves…</option>
            {(items ?? []).map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!picking) return;
              // The price comes from the item's own cost and the DM types over
              // it — a shop marks up, but starting from the book beats
              // starting from nothing (#101 gave items a cost to start from).
              addStock.mutate(
                { vendorId: vendor.id, body: { contentId: picking } },
                { onSuccess: () => setPicking("") },
              );
            }}
            disabled={!picking || addStock.isPending}
            className="btn-base btn-ghost-ink h-8 px-3 text-[11px] disabled:opacity-40"
          >
            Stock it
          </button>
        </div>
      )}
    </div>
  );
}
