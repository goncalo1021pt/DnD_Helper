import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Campaign } from "../../api/client";
import { useDeleteCampaign } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";

/*
 * Disband the Table: the last resort. Strikes the whole campaign — quests,
 * chronicle, codex, maps, and encounters go with it, and every player loses
 * their seat. Seated heroes return to My Heroes rather than vanishing with
 * the table.
 */
export default function DisbandSection({ campaign }: { campaign: Campaign }) {
  const navigate = useNavigate();
  const del = useDeleteCampaign(campaign.id);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const ready = confirmText.trim() === campaign.name;

  function close() {
    setConfirming(false);
    setConfirmText("");
  }

  return (
    <section
      className="panel-hall px-6 pb-6 pt-5"
      style={{ border: "1px solid rgba(139,37,32,.4)" }}
    >
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(139,37,32,.3)" }}
      >
        <h2
          className="font-display m-0 text-[21px] font-black text-[#e8a493]"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
        >
          Disband the Table
        </h2>
      </div>

      <p className="font-body mb-4 text-[13.5px] leading-relaxed text-cream-muted">
        Strikes this campaign for good: the quest board, chronicle, codex,
        maps, and encounters go with it, and every player loses their seat.
        Heroes seated here return to their owners' My Heroes shelf. This
        can't be undone.
      </p>

      <button
        onClick={() => setConfirming(true)}
        className="label-stamp cursor-pointer rounded-[2px] px-3 py-2 text-[11px] tracking-[1px] text-[#e8c4b8] transition hover:brightness-125"
        style={{ background: "rgba(139,37,32,.28)", border: "1px solid rgba(139,37,32,.6)" }}
      >
        Disband this campaign
      </button>

      {confirming && (
        <ParchmentModal onClose={close}>
          <h3 className="font-display mb-2 mt-0 text-[20px] font-black text-ink">
            Disband {campaign.name}?
          </h3>
          <p className="font-body mb-4 text-[13.5px] leading-relaxed text-ink-body">
            Everyone at this table loses their seat, and the quest board,
            chronicle, codex, maps, and encounters are struck along with it.
            Seated heroes return to My Heroes. This can't be undone.
          </p>
          <label className="mb-4 block">
            <span className="field-label">
              Type <b>{campaign.name}</b> to confirm
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={campaign.name}
              className="input-parchment mt-1 w-full"
            />
          </label>
          {del.isError && (
            <p className="font-body mb-3 text-sm italic text-[#8b2520]">
              The campaign could not be struck — nothing was removed.
            </p>
          )}
          <div className="flex items-center justify-end gap-4">
            <button
              onClick={close}
              className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                del.mutate(undefined, { onSuccess: () => navigate("/questboard") })
              }
              disabled={!ready || del.isPending}
              className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "#8b2520", color: "#f3e6c8" }}
            >
              {del.isPending ? "Disbanding…" : "Disband it"}
            </button>
          </div>
        </ParchmentModal>
      )}
    </section>
  );
}
