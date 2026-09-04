import { useState } from "react";
import type { Campaign, Member } from "../../api/client";
import { useTransferCampaign } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";

/*
 * Hand Over the Table (#299): the owner's door, beside Disband. The heir
 * becomes the owner and a DM; the giver stays seated as a DM and loses only
 * the owner's doors. A table alone in its realm takes the realm with it,
 * atlas and all; one sharing a realm with the giver's other tables steps onto
 * fresh ground of the heir's — the world stays whole with its owner.
 *
 * One-way for the giver, so it asks for the campaign's name the way Disband
 * does: the heir can hand it back, but not by accident.
 */
export default function HandOverSection({
  campaign,
  members,
  meId,
}: {
  campaign: Campaign;
  members: Member[];
  meId: string;
}) {
  const transfer = useTransferCampaign(campaign.id);
  const [heirId, setHeirId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const others = members.filter((m) => m.userId !== meId);
  const heir = others.find((m) => m.userId === heirId);
  const ready = confirmText.trim() === campaign.name;

  function close() {
    setConfirming(false);
    setConfirmText("");
  }

  if (others.length === 0) return null;

  return (
    <section className="panel-hall px-6 pb-6 pt-5" style={{ border: "1px solid rgba(201,162,39,.28)" }}>
      <div
        className="mb-3 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2 className="font-display m-0 text-[21px] font-black text-[#e7d3a6]" style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}>
          Hand Over the Table
        </h2>
        <span className="font-accent text-[12.5px] italic text-cream-muted">
          — they take the table; you stay seated as a DM. —
        </span>
      </div>
      <p className="font-body m-0 mb-4 max-w-[68ch] text-[13.5px] leading-relaxed text-cream-soft">
        The new owner holds the doors that reshape or end the table — disbanding it, moving it between
        realms, appointing the DMs. A table alone in its realm takes the realm with it, maps and towns
        and all; one sharing a realm with your other tables steps onto fresh ground of theirs.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={heirId}
          onChange={(e) => setHeirId(e.target.value)}
          aria-label="Hand the table to"
          className="input-hall input-compact w-56 cursor-pointer text-[13px]"
        >
          <option value="">Hand the table to…</option>
          {others.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}{m.role === "dm" ? " · DM" : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => setConfirming(true)}
          disabled={!heir}
          className="btn-base btn-ghost-gold h-10 px-3 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Hand it over
        </button>
      </div>

      {confirming && heir && (
        <ParchmentModal onClose={close}>
          <h3 className="font-display mb-2 mt-0 text-[20px] font-black text-ink">Hand the table to {heir.name}?</h3>
          <p className="font-body mb-4 text-[13.5px] leading-relaxed text-ink-body">
            They become its owner and a DM. You stay seated as a DM and can no longer disband it, move
            it between realms, or appoint DMs. Type the campaign's name to confirm.
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={campaign.name}
            aria-label="Type the campaign's name to confirm"
            className="input-parchment input-compact mb-4 w-full"
          />
          {transfer.isError && (
            <p className="font-body mb-3 text-sm italic text-[#8b2520]">
              {(transfer.error as { error?: string } | null)?.error ?? "The table stands as it was."}
            </p>
          )}
          <div className="flex items-center justify-end gap-4">
            <button onClick={close} className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink">
              Cancel
            </button>
            <button
              onClick={() => transfer.mutate(heir.userId, { onSuccess: close })}
              disabled={!ready || transfer.isPending}
              className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "#8b2520", color: "#f3e6c8" }}
            >
              Hand it over
            </button>
          </div>
        </ParchmentModal>
      )}
    </section>
  );
}
