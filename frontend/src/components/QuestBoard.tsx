import { useState } from "react";
import type { Campaign, Role } from "../api/client";
import { useQuests, useCreateQuest, useRegenerateInvite } from "../hooks";
import QuestCard from "./QuestCard";
import QuestForm, { emptyQuest } from "./QuestForm";

export default function QuestBoard({
  campaign,
  role,
}: {
  campaign: Campaign;
  role: Role;
}) {
  const isDM = role === "dm";
  const { data: quests, isLoading } = useQuests(campaign.id);
  const createQuest = useCreateQuest(campaign.id);
  const regenerate = useRegenerateInvite(campaign.id);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      {isDM && (
        <div className="rounded-lg bg-wood/60 border border-gold/30 p-4 text-parchment flex items-center justify-between gap-4">
          <div>
            <span className="text-xs uppercase tracking-wide opacity-70">Invite code</span>
            <div className="font-display text-2xl tracking-widest">{campaign.inviteCode}</div>
            <p className="text-xs opacity-60">Share this so players can join the campaign.</p>
          </div>
          <button
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
            className="text-sm rounded px-3 py-1 bg-wood-dark/60 hover:bg-wood-dark disabled:opacity-50"
          >
            Regenerate
          </button>
        </div>
      )}

      {isDM && (
        <div className="rounded-xl bg-parchment border-2 border-wood p-4">
          {showForm ? (
            <QuestForm
              initial={emptyQuest}
              mode="create"
              isPending={createQuest.isPending}
              onCancel={() => setShowForm(false)}
              onSubmit={(v) =>
                createQuest.mutate(v, { onSuccess: () => setShowForm(false) })
              }
            />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="rounded bg-ember text-white px-4 py-2 font-semibold"
            >
              + Post a quest
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-parchment/60">Loading quests…</p>
      ) : quests && quests.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {quests.map((q) => (
            <QuestCard key={q.id} quest={q} role={role} campaignId={campaign.id} />
          ))}
        </div>
      ) : (
        <p className="text-parchment/60">
          The board is empty. {isDM ? "Post the first quest above." : "Check back soon."}
        </p>
      )}
    </div>
  );
}
