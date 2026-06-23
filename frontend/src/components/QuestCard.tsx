import { useState } from "react";
import type { Quest, Role } from "../api/client";
import { useClaimQuest, useDeleteQuest, useUpdateQuest } from "../hooks";
import QuestForm, { type QuestFormValues } from "./QuestForm";

const DIFFICULTY_COLOR: Record<string, string> = {
  trivial: "bg-gray-200 text-gray-700",
  easy: "bg-green-200 text-green-900",
  medium: "bg-yellow-200 text-yellow-900",
  hard: "bg-orange-200 text-orange-900",
  deadly: "bg-red-300 text-red-900",
};

const STATUS_COLOR: Record<string, string> = {
  available: "bg-emerald-700 text-white",
  active: "bg-blue-700 text-white",
  completed: "bg-gray-600 text-white",
  failed: "bg-red-800 text-white",
};

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

  if (editing) {
    const initial: QuestFormValues = {
      title: quest.title,
      description: quest.description,
      giver: quest.giver ?? "",
      location: quest.location ?? "",
      difficulty: quest.difficulty,
      status: quest.status,
      rewards: quest.rewards.map((r) => ({ type: r.type, label: r.label, value: r.value ?? "" })),
    };
    return (
      <div className="rounded-xl bg-parchment border-2 border-wood p-4">
        <QuestForm
          initial={initial}
          mode="edit"
          isPending={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={(v) =>
            update.mutate(
              { questId: quest.id, body: v },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-parchment border-2 border-wood p-4 text-ink shadow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-xl text-wood-dark">{quest.title}</h3>
        <div className="flex gap-1 shrink-0">
          <span className={`text-xs uppercase rounded px-2 py-0.5 ${DIFFICULTY_COLOR[quest.difficulty]}`}>
            {quest.difficulty}
          </span>
          <span className={`text-xs uppercase rounded px-2 py-0.5 ${STATUS_COLOR[quest.status]}`}>
            {quest.status}
          </span>
        </div>
      </div>

      {quest.description && <p className="mt-2 text-sm text-ink/80">{quest.description}</p>}

      <div className="mt-2 text-xs text-ink/60 flex gap-4">
        {quest.giver && <span>Giver: {quest.giver}</span>}
        {quest.location && <span>Location: {quest.location}</span>}
      </div>

      {quest.rewards.length > 0 && (
        <div className="mt-3">
          <span className="text-xs uppercase tracking-wide text-ink/50">Rewards</span>
          <ul className="mt-1 flex flex-wrap gap-2">
            {quest.rewards.map((r) => (
              <li key={r.id} className="text-xs rounded-full bg-gold/30 border border-gold/60 px-2 py-0.5">
                {r.label}
                {r.value ? `: ${r.value}` : ""} <span className="opacity-60">({r.type})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {quest.claims.length > 0 && (
        <p className="mt-2 text-xs text-ink/60">
          Claimed by: {quest.claims.map((c) => c.userName).join(", ")}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => claim.mutate({ questId: quest.id, claimed: quest.claimedByMe })}
          disabled={claim.isPending}
          className={`text-sm rounded px-3 py-1 font-semibold disabled:opacity-50 ${
            quest.claimedByMe ? "bg-wood text-parchment" : "bg-ember text-white"
          }`}
        >
          {quest.claimedByMe ? "Release" : "Claim"}
        </button>
        {isDM && (
          <>
            <button onClick={() => setEditing(true)} className="text-sm rounded px-3 py-1 border border-ink/20">
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete "${quest.title}"?`)) del.mutate(quest.id);
              }}
              disabled={del.isPending}
              className="text-sm rounded px-3 py-1 text-ember border border-ember/40 disabled:opacity-50"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
