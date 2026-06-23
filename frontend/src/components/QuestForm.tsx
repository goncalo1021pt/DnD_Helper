import { useState } from "react";
import type {
  QuestDifficulty,
  QuestStatus,
  RewardInput,
  RewardType,
} from "../api/client";

const DIFFICULTIES: QuestDifficulty[] = ["trivial", "easy", "medium", "hard", "deadly"];
const STATUSES: QuestStatus[] = ["available", "active", "completed", "failed"];
const REWARD_TYPES: RewardType[] = ["gold", "item", "xp", "reputation", "other"];

export interface QuestFormValues {
  title: string;
  description: string;
  giver: string;
  location: string;
  difficulty: QuestDifficulty;
  status: QuestStatus;
  rewards: RewardInput[];
}

export const emptyQuest: QuestFormValues = {
  title: "",
  description: "",
  giver: "",
  location: "",
  difficulty: "medium",
  status: "available",
  rewards: [],
};

export default function QuestForm({
  initial,
  mode,
  isPending,
  onSubmit,
  onCancel,
}: {
  initial: QuestFormValues;
  mode: "create" | "edit";
  isPending: boolean;
  onSubmit: (values: QuestFormValues) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<QuestFormValues>(initial);

  function set<K extends keyof QuestFormValues>(key: K, val: QuestFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: val }));
  }

  function setReward(i: number, patch: Partial<RewardInput>) {
    setV((prev) => ({
      ...prev,
      rewards: prev.rewards.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.title.trim()) return;
    onSubmit({
      ...v,
      rewards: v.rewards.filter((r) => r.label.trim() !== ""),
    });
  }

  const field = "rounded border border-ink/20 px-2 py-1 bg-parchment text-ink";

  return (
    <form onSubmit={submit} className="space-y-3 text-ink">
      <input
        className={`${field} w-full font-semibold`}
        placeholder="Quest title"
        value={v.title}
        maxLength={200}
        onChange={(e) => set("title", e.target.value)}
      />
      <textarea
        className={`${field} w-full`}
        placeholder="Description"
        rows={2}
        value={v.description}
        onChange={(e) => set("description", e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className={field}
          placeholder="Quest giver (NPC)"
          value={v.giver}
          onChange={(e) => set("giver", e.target.value)}
        />
        <input
          className={field}
          placeholder="Location"
          value={v.location}
          onChange={(e) => set("location", e.target.value)}
        />
        <select className={field} value={v.difficulty} onChange={(e) => set("difficulty", e.target.value as QuestDifficulty)}>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {mode === "edit" && (
          <select className={field} value={v.status} onChange={(e) => set("status", e.target.value as QuestStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Rewards</span>
          <button
            type="button"
            className="text-xs rounded bg-wood text-parchment px-2 py-1"
            onClick={() => set("rewards", [...v.rewards, { type: "gold", label: "", value: "" }])}
          >
            + Add reward
          </button>
        </div>
        {v.rewards.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select className={field} value={r.type} onChange={(e) => setReward(i, { type: e.target.value as RewardType })}>
              {REWARD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              className={`${field} flex-1`}
              placeholder="Label (e.g. Bounty)"
              value={r.label}
              onChange={(e) => setReward(i, { label: e.target.value })}
            />
            <input
              className={`${field} w-32`}
              placeholder="Value"
              value={r.value ?? ""}
              onChange={(e) => setReward(i, { value: e.target.value })}
            />
            <button
              type="button"
              className="text-ember text-sm px-1"
              onClick={() => set("rewards", v.rewards.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending || !v.title.trim()}
          className="rounded bg-ember text-white px-4 py-1.5 font-semibold disabled:opacity-50"
        >
          {mode === "create" ? "Post quest" : "Save"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded px-4 py-1.5 border border-ink/20">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
