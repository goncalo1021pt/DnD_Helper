import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useCreateQuest, useQuests } from "../hooks";
import type { CampaignContext } from "./CampaignView";
import QuestCard from "./QuestCard";
import QuestForm, { emptyQuest } from "./QuestForm";
import FloatingDiceTray from "./ui/DiceTray";
import ParchmentModal from "./ui/ParchmentModal";
import { IconCheckSquare, IconFolder, IconPlus } from "./ui/icons";

export default function QuestBoard() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: quests, isLoading } = useQuests(campaign.id);
  const createQuest = useCreateQuest(campaign.id);
  const [posting, setPosting] = useState(false);

  const availableCount = quests?.filter((q) => q.status === "available").length ?? 0;
  const activeCount = quests?.filter((q) => q.status === "active").length ?? 0;
  const myClaims = quests?.filter((q) => q.claimedByMe).length ?? 0;

  return (
    <div className="panel-hall px-[30px] pb-11 pt-8">
      {/* board header strip */}
      <div
        className="mb-[26px] flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Quest Board
          </h2>
          <span className="label-stamp text-xs text-gold-muted">
            {availableCount} open · {activeCount} afoot
          </span>
        </div>

        {isDM ? (
          <button
            onClick={() => setPosting(true)}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
          >
            <IconPlus size={15} strokeWidth={2} />
            Post a Quest
          </button>
        ) : (
          <div className="chip-hall px-[15px] py-[9px]">
            <span className="text-gold-hair">
              <IconCheckSquare size={16} />
            </span>
            <span className="label-stamp text-[11px] font-semibold text-[#e6d5af]">
              {myClaims} claimed by you
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Unrolling the notices…
        </div>
      ) : quests && quests.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(312px,1fr))] gap-x-[26px] gap-y-[34px]">
          {quests.map((q) => (
            <QuestCard key={q.id} quest={q} role={role} campaignId={campaign.id} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-[70px] text-center">
          <div className="mb-4 inline-flex text-[#7a5e34]">
            <IconFolder size={46} strokeWidth={1.4} />
          </div>
          <div className="font-display text-2xl text-[#cdb582]">
            No quests posted
          </div>
          <div className="font-accent mt-2 text-base italic text-[#9c855e]">
            — the board awaits. —
          </div>
        </div>
      )}

      {posting && (
        <ParchmentModal onClose={() => setPosting(false)} maxWidth="max-w-[560px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Dungeon Master's Quill
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Nail Up a Notice
          </h3>
          <QuestForm
            initial={emptyQuest}
            mode="create"
            isPending={createQuest.isPending}
            errorText={
              createQuest.isError
                ? ((createQuest.error as { error?: string } | null)?.error ??
                  "The notice would not pin — check the fields and try again.")
                : undefined
            }
            onCancel={() => setPosting(false)}
            onSubmit={(v) =>
              createQuest.mutate(v, { onSuccess: () => setPosting(false) })
            }
          />
        </ParchmentModal>
      )}

      <FloatingDiceTray />
    </div>
  );
}
