import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Campaign } from "../api/client";
import {
  useCampaigns,
  useCreateQuest,
  useQuests,
  useRegenerateInvite,
} from "../hooks";
import QuestBoard from "./QuestBoard";
import QuestForm, { emptyQuest } from "./QuestForm";
import ParchmentModal from "./ui/ParchmentModal";
import RoleBadge from "./ui/RoleBadge";
import {
  IconCheckSquare,
  IconCopy,
  IconPlus,
  IconRefresh,
} from "./ui/icons";

/* Invite-code plate: click to copy, with a transient confirmation. */
function InviteChip({ campaign }: { campaign: Campaign }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function copy() {
    navigator.clipboard?.writeText(campaign.inviteCode).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      onClick={copy}
      title="Copy invite code"
      className="chip-hall cursor-pointer border-none px-3.5 py-[9px] transition hover:brightness-125"
    >
      <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">
        Invite
      </span>
      <span className="font-heading text-sm font-bold tracking-[2px] text-ember-bright">
        {campaign.inviteCode}
      </span>
      <span className="text-gold-hair">
        <IconCopy strokeWidth={1.8} />
      </span>
      {copied && (
        <span className="label-stamp text-[10px] tracking-[1px] text-[#8fb15f]">
          Copied
        </span>
      )}
    </button>
  );
}

export default function CampaignView() {
  const { id } = useParams();
  const { data: campaigns, isLoading } = useCampaigns();
  const [posting, setPosting] = useState(false);

  // Same query key as the board below — served from the cache, no double fetch.
  const { data: quests } = useQuests(id ?? "");
  const createQuest = useCreateQuest(id ?? "");
  const regenerate = useRegenerateInvite(id ?? "");

  if (isLoading) {
    return (
      <p className="font-accent text-base italic text-[#9c855e]">
        Finding your table…
      </p>
    );
  }

  const membership = campaigns?.find((m) => m.campaign.id === id);
  if (!membership) {
    return (
      <div className="text-cream-soft">
        <p>This table is not yours to sit at — or it never was.</p>
        <Link
          to="/questboard"
          className="label-stamp text-xs text-ember-bright underline"
        >
          ← Back to your campaigns
        </Link>
      </div>
    );
  }

  const { campaign, role } = membership;
  const isDM = role === "dm";
  const myClaims = quests?.filter((q) => q.claimedByMe).length ?? 0;

  return (
    <div>
      <Link
        to="/questboard"
        className="label-stamp text-[11px] text-gold-muted no-underline transition hover:text-ember-bright"
      >
        ← All campaigns
      </Link>

      {/* campaign toolbar */}
      <div className="mb-[26px] mt-3 flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 flex-wrap items-center gap-[18px]">
          <div className="min-w-0">
            <div className="font-accent text-sm italic tracking-[.16em] text-[#c89a5a]">
              Campaign
            </div>
            <div className="font-display truncate text-[clamp(17px,2.2vw,24px)] font-bold leading-[1.15] text-cream">
              {campaign.name}
            </div>
          </div>
          <RoleBadge role={role} />
        </div>

        <div className="flex flex-wrap items-center gap-3.5">
          {isDM ? (
            <>
              <InviteChip campaign={campaign} />
              <button
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending}
                title="Forge a new invite code (the old one stops working)"
                className="chip-hall cursor-pointer border-none p-[9px] text-gold-hair transition hover:brightness-125 disabled:opacity-55"
              >
                <IconRefresh strokeWidth={1.8} />
              </button>
              <button
                onClick={() => setPosting(true)}
                className="btn-base btn-gold clip-octagon h-11 px-6 text-sm"
              >
                <IconPlus size={16} strokeWidth={2} />
                Post a Quest
              </button>
            </>
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
      </div>

      <QuestBoard campaign={campaign} role={role} />

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
    </div>
  );
}
