import { useState } from "react";
import type {
  QuestDifficulty,
  QuestStatus,
  RewardInput,
  RewardType,
} from "../api/client";
import { IconPlus, IconX } from "./ui/icons";

const DIFFICULTIES: QuestDifficulty[] = ["trivial", "easy", "medium", "hard", "deadly"];
const STATUSES: QuestStatus[] = ["available", "active", "completed", "failed"];
const REWARD_TYPES: RewardType[] = ["gold", "item", "xp", "reputation", "other"];

/* The backend requires a reward label, but the form doesn't expose one — it is
   always derived from the type (labels already stored on a quest survive edits). */
const TYPE_LABEL: Record<RewardType, string> = {
  gold: "Gold",
  item: "Item",
  xp: "XP",
  reputation: "Reputation",
  other: "Boon",
};

const VALUE_HINT: Record<RewardType, string> = {
  gold: "e.g. 200 gp",
  item: "e.g. Cloak of Elvenkind",
  xp: "e.g. 700",
  reputation: "e.g. +2 with the Temple",
  other: "e.g. Free board at the inn",
};

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export default function QuestForm({
  initial,
  mode,
  isPending,
  errorText,
  onSubmit,
  onCancel,
}: {
  initial: QuestFormValues;
  mode: "create" | "edit";
  isPending: boolean;
  errorText?: string;
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
      // A reward is its value; rows without one drop.
      rewards: v.rewards
        .filter((r) => (r.value ?? "").trim() !== "")
        .map((r) => ({ ...r, label: r.label.trim() || TYPE_LABEL[r.type] })),
    });
  }

  const input = "input-parchment input-compact";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 text-ink-strong">
      <Field label="Title">
        <input
          className={`${input} font-heading font-semibold`}
          placeholder="e.g. Rats in the Cellar"
          value={v.title}
          maxLength={200}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>

      <Field label="The notice reads">
        <textarea
          className="input-parchment h-auto resize-y py-2 text-[15px]"
          placeholder="What is asked, and what is at stake…"
          rows={3}
          value={v.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Giver">
          <input
            className={input}
            placeholder="Bram the Barkeep"
            value={v.giver}
            onChange={(e) => set("giver", e.target.value)}
          />
        </Field>
        <Field label="Where">
          <input
            className={input}
            placeholder="The Prancing Pony, Bree"
            value={v.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </Field>
        <Field label="Difficulty">
          <select
            className={`${input} cursor-pointer`}
            value={v.difficulty}
            onChange={(e) => set("difficulty", e.target.value as QuestDifficulty)}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        {mode === "edit" && (
          <Field label="Status">
            <select
              className={`${input} cursor-pointer`}
              value={v.status}
              onChange={(e) => set("status", e.target.value as QuestStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="field-label">Rewards</span>
          <button
            type="button"
            className="btn-base btn-ghost-ink px-2.5 py-1.5 text-[10px]"
            onClick={() =>
              set("rewards", [...v.rewards, { type: "gold", label: "", value: "" }])
            }
          >
            <IconPlus size={12} strokeWidth={2} />
            Add reward
          </button>
        </div>
        {v.rewards.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className={`${input} w-32 cursor-pointer`}
              value={r.type}
              onChange={(e) => setReward(i, { type: e.target.value as RewardType })}
            >
              {REWARD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              className={`${input} flex-1`}
              placeholder={VALUE_HINT[r.type]}
              value={r.value ?? ""}
              onChange={(e) => setReward(i, { value: e.target.value })}
            />
            <button
              type="button"
              title="Remove reward"
              className="inline-flex cursor-pointer border-none bg-transparent p-1 text-[#8b2520] hover:opacity-70"
              onClick={() =>
                set(
                  "rewards",
                  v.rewards.filter((_, idx) => idx !== i),
                )
              }
            >
              <IconX size={16} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      <div className="torn-divider" />

      {errorText && (
        <p className="font-body m-0 text-sm italic text-[#8b2520]">
          {errorText}
        </p>
      )}

      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={isPending || !v.title.trim()}
          className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
        >
          {mode === "create" ? "Nail it to the board" : "Save the notice"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
