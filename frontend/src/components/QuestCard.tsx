import { useState } from "react";
import type { Quest, QuestStatus, Role } from "../api/client";
import { useClaimQuest, useDeleteQuest, useUpdateQuest } from "../hooks";
import QuestForm, { type QuestFormValues } from "./QuestForm";
import ParchmentModal from "./ui/ParchmentModal";
import {
  IconClaim,
  IconCoins,
  IconFlag,
  IconGem,
  IconMapPin,
  IconPackage,
  IconPencil,
  IconShield,
  IconSparkles,
  IconTrash,
  IconUser,
  IconUsers,
  IconX,
} from "./ui/icons";

/* Difficulty wax-seal palette: light / base / dark. */
const DIFF: Record<string, { label: string; c: string; lc: string; dc: string }> = {
  trivial: { label: "Trivial", c: "#5f6b52", lc: "#7e8c6d", dc: "#39412f" },
  easy: { label: "Easy", c: "#4d6b39", lc: "#6f9051", dc: "#2e4221" },
  medium: { label: "Medium", c: "#b07a2e", lc: "#d8a44e", dc: "#6e4a18" },
  hard: { label: "Hard", c: "#a8552a", lc: "#cd7644", dc: "#6b3417" },
  deadly: { label: "Deadly", c: "#6e1f1c", lc: "#9e3b34", dc: "#3f0f0e" },
};

const STATUS: Record<string, { label: string; c: string }> = {
  available: { label: "Available", c: "#7c5a2e" },
  active: { label: "Claimed", c: "#8a5a1f" },
  completed: { label: "Completed", c: "#3f5a30" },
  failed: { label: "Failed", c: "#6e1f1c" },
};

const STATUS_ORDER: QuestStatus[] = ["available", "active", "completed", "failed"];

/* Stable pinned-by-hand tilt derived from the quest id. */
function rotationFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return `${(((h % 37) / 36) * 3.6 - 1.8).toFixed(2)}deg`;
}

function RewardIcon({ type }: { type: string }) {
  switch (type) {
    case "gold":
      return <IconCoins />;
    case "item":
      return <IconPackage />;
    case "xp":
      return <IconSparkles />;
    case "reputation":
      return <IconShield />;
    default:
      return <IconGem />;
  }
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span className="text-[#8a5e2c]">{icon}</span>
      <span className="label-stamp text-[9.5px] tracking-[1.5px] text-ink-label">
        {label}
      </span>
      <span className="font-medium text-ink-value">{value}</span>
    </div>
  );
}

export default function QuestCard({
  quest,
  role,
  campaignId,
}: {
  quest: Quest;
  role: Role;
  campaignId: string;
}) {
  const isDM = role === "dm";
  const [editing, setEditing] = useState(false);
  const claim = useClaimQuest(campaignId);
  const update = useUpdateQuest(campaignId);
  const del = useDeleteQuest(campaignId);

  const diff = DIFF[quest.difficulty] ?? DIFF.medium;
  const status = STATUS[quest.status] ?? STATUS.available;
  const isDim = quest.status === "completed" || quest.status === "failed";

  const showClaim = !isDM && quest.status === "available" && !quest.claimedByMe;
  const showRelease = !isDM && quest.claimedByMe && !isDim;
  const showTaken = !isDM && quest.status === "active" && !quest.claimedByMe;

  function cycleStatus() {
    const next =
      STATUS_ORDER[(STATUS_ORDER.indexOf(quest.status) + 1) % STATUS_ORDER.length];
    update.mutate({
      questId: quest.id,
      body: {
        title: quest.title,
        description: quest.description,
        giver: quest.giver,
        location: quest.location,
        difficulty: quest.difficulty,
        status: next,
        rewards: quest.rewards.map((r) => ({
          type: r.type,
          label: r.label,
          value: r.value ?? "",
        })),
      },
    });
  }

  const editInitial: QuestFormValues = {
    title: quest.title,
    description: quest.description,
    giver: quest.giver ?? "",
    location: quest.location ?? "",
    difficulty: quest.difficulty,
    status: quest.status,
    rewards: quest.rewards.map((r) => ({
      type: r.type,
      label: r.label,
      value: r.value ?? "",
    })),
  };

  return (
    <article className="relative" style={{ transform: `rotate(${rotationFor(quest.id)})` }}>
      {/* nail pinning the notice */}
      <div className="nailhead absolute -top-[9px] left-1/2 z-[6] -translate-x-1/2" />

      <div className="parchment overflow-hidden px-[22px] pb-5 pt-6">
        {/* status tab (flows above the title, never overlaps the seal) */}
        {quest.status !== "available" && (
          <div
            className="label-stamp mb-3 mr-14 inline-flex items-center gap-[7px] rounded-[2px] px-3 py-[5px] text-[10px] font-bold text-[#f6ead0]"
            style={{
              background: `linear-gradient(180deg, ${status.c}, rgba(0,0,0,.22))`,
              boxShadow:
                "0 2px 4px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.2)",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#f6ead0] opacity-90" />
            {status.label}
          </div>
        )}

        {/* difficulty wax seal */}
        <div
          className="absolute right-[15px] top-[15px] z-[5] flex h-[54px] w-[54px] -rotate-[5deg] items-center justify-center rounded-full border-2 p-1"
          style={{
            borderColor: diff.dc,
            background: `radial-gradient(circle at 40% 34%, ${diff.lc}, ${diff.c} 60%, ${diff.dc})`,
            boxShadow:
              "0 3px 7px rgba(0,0,0,.4), inset 0 0 0 3px rgba(255,255,255,.14), inset 0 2px 3px rgba(255,255,255,.32), inset 0 -5px 8px rgba(0,0,0,.38)",
          }}
        >
          <span
            className="font-heading text-center text-[9px] font-bold uppercase leading-none tracking-[.5px] text-[#f6ead0]"
            style={{ textShadow: "0 1px 1px rgba(0,0,0,.5)" }}
          >
            {diff.label}
          </span>
        </div>

        {/* title */}
        <h3 className="font-display m-0 mb-2.5 mr-14 text-[21px] font-bold leading-[1.15] text-ink">
          {quest.title}
        </h3>

        {/* meta */}
        {(quest.giver || quest.location) && (
          <div className="mb-3 flex flex-col gap-[5px]">
            {quest.giver && (
              <MetaRow icon={<IconUser />} label="Giver" value={quest.giver} />
            )}
            {quest.location && (
              <MetaRow icon={<IconMapPin />} label="Where" value={quest.location} />
            )}
          </div>
        )}

        {/* description */}
        {quest.description && (
          <p className="font-body m-0 mb-3.5 text-sm leading-[1.62] text-ink-body">
            {quest.description}
          </p>
        )}

        {/* rewards */}
        {quest.rewards.length > 0 && (
          <>
            <div className="torn-divider mb-[13px]" />
            <div className="label-stamp mb-2 text-[9.5px] text-ink-label">
              Reward
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {quest.rewards.map((r) => (
                <div
                  key={r.id}
                  className="inline-flex items-center gap-[7px] rounded-[2px] border-[1.5px] border-[#7c5a2e] px-2.5 py-[5px]"
                  style={{
                    background:
                      "linear-gradient(180deg,rgba(124,90,46,.14),rgba(124,90,46,.05))",
                  }}
                >
                  <span className="inline-flex text-[#7c5226]">
                    <RewardIcon type={r.type} />
                  </span>
                  <span className="label-stamp text-[9px] tracking-[.5px] text-ink-label">
                    {r.label}
                  </span>
                  {r.value && (
                    <span className="text-[13px] font-semibold text-ink-value">
                      {r.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* claimed by */}
        {quest.claims.length > 0 && (
          <div
            className="mb-3.5 flex items-center gap-2 px-2.5 py-[7px] text-[12.5px]"
            style={{
              borderLeft: `3px solid ${status.c}`,
              background: "rgba(120,86,42,.08)",
            }}
          >
            <span className="text-[#7c5226]">
              <IconUsers />
            </span>
            <span className="label-stamp text-[9.5px] tracking-[1.5px] text-ink-label">
              Claimed by
            </span>
            <span className="font-semibold text-ink-value">
              {quest.claims.map((c) => c.userName).join(", ")}
            </span>
          </div>
        )}

        {/* actions */}
        {(isDM || showClaim || showRelease || showTaken) && (
          <div className="mt-1 flex items-center gap-2.5">
            {showClaim && (
              <button
                onClick={() => claim.mutate({ questId: quest.id, claimed: false })}
                disabled={claim.isPending}
                className="btn-base btn-wax clip-octagon flex-1 px-3.5 py-[11px] text-xs"
              >
                <IconClaim strokeWidth={2} />
                Claim Notice
              </button>
            )}
            {showRelease && (
              <button
                onClick={() => claim.mutate({ questId: quest.id, claimed: true })}
                disabled={claim.isPending}
                className="btn-base btn-ghost-ink flex-1 px-3.5 py-[11px] text-xs"
              >
                <IconX strokeWidth={2} />
                Release
              </button>
            )}
            {showTaken && (
              <div className="label-stamp flex-1 rounded-[2px] border-2 border-dashed border-[#a98c5e] px-3.5 py-[11px] text-center text-[11px] font-semibold tracking-[1.5px] text-ink-faded">
                Spoken For
              </div>
            )}

            {isDM && (
              <>
                <span className="flex-1" />
                <button
                  onClick={() => setEditing(true)}
                  title="Edit"
                  className="btn-base btn-ghost-ink p-[9px]"
                >
                  <IconPencil strokeWidth={1.8} />
                </button>
                <button
                  onClick={cycleStatus}
                  disabled={update.isPending}
                  title="Change status"
                  className="btn-base btn-ghost-ink p-[9px]"
                >
                  <IconFlag strokeWidth={1.8} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Tear down "${quest.title}"?`)) del.mutate(quest.id);
                  }}
                  disabled={del.isPending}
                  title="Remove"
                  className="btn-base btn-ghost-red p-[9px]"
                >
                  <IconTrash strokeWidth={1.8} />
                </button>
              </>
            )}
          </div>
        )}

        {/* aged veil for done states */}
        {isDim && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(160deg,rgba(60,38,18,.34),rgba(40,24,10,.42))",
            }}
          />
        )}
      </div>

      {editing && (
        <ParchmentModal onClose={() => setEditing(false)} maxWidth="max-w-[560px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Dungeon Master's Quill
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Amend the Notice
          </h3>
          <QuestForm
            initial={editInitial}
            mode="edit"
            isPending={update.isPending}
            errorText={
              update.isError
                ? ((update.error as { error?: string } | null)?.error ??
                  "The notice would not save — check the fields and try again.")
                : undefined
            }
            onCancel={() => setEditing(false)}
            onSubmit={(v) =>
              update.mutate(
                { questId: quest.id, body: v },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        </ParchmentModal>
      )}
    </article>
  );
}
