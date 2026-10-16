/*
Pay a completed quest into the pack (#395).

Opens when the DM marks a quest completed, and from the card until it has paid.
The gold is shared (rounded down, the leftover said) or given whole to each; every
item goes to the hero the DM picks. The claimants' heroes are offered first; a
quest nobody claimed offers the whole table, since the party often does a job
the board never heard of. What does not read as goods stays words on the notice.
*/

import { useState } from "react";
import type { Character, Quest } from "../../api/client";
import { usePayOutQuest } from "../../hooks";
import { pushNotice } from "../../lib/notices";
import ParchmentModal from "../ui/ParchmentModal";

type Mode = "split" | "each";

const MODE_KEY = (campaignId: string) => `qb.payout-mode.${campaignId}`;

function readMode(campaignId: string): Mode {
  try {
    return localStorage.getItem(MODE_KEY(campaignId)) === "each" ? "each" : "split";
  } catch {
    return "split";
  }
}

export default function QuestPayoutModal({
  campaignId,
  quest,
  heroes,
  onClose,
}: {
  campaignId: string;
  quest: Quest;
  /** The seated heroes of the table. */
  heroes: Character[];
  onClose: () => void;
}) {
  const pay = usePayOutQuest(campaignId);
  const claimants = new Set(quest.claims.map((c) => c.userId));
  const byClaim = heroes.filter((h) => claimants.has(h.ownerUserId));
  const eligible = byClaim.length > 0 ? byClaim : heroes;

  const gold = quest.rewards.filter((r) => r.type === "gold" && r.payable);
  const items = quest.rewards.filter((r) => r.type === "item" && r.payable);
  const words = quest.rewards.filter((r) => !r.payable);

  const [mode, setMode] = useState<Mode>(() => readMode(campaignId));
  // What the DM changed from the defaults — the defaults themselves follow the
  // roster, which may still be arriving when the dialog opens.
  const [left, setLeft] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const sharers = eligible.filter((h) => !left.includes(h.id)).map((h) => h.id);
  const owners: Record<string, string> = Object.fromEntries(
    items.map((r) => [r.id, picked[r.id] ?? eligible[0]?.id ?? ""]),
  );
  const [announce, setAnnounce] = useState(true);

  const toggle = (id: string) =>
    setLeft((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]));
  const ready =
    (gold.length === 0 || sharers.length > 0) && items.every((r) => owners[r.id]) && !pay.isPending;

  function chooseMode(m: Mode) {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY(campaignId), m);
    } catch {
      /* a remembered choice is a convenience, never required */
    }
  }

  function submit() {
    pay.mutate(
      {
        questId: quest.id,
        body: {
          heroIds: gold.length ? sharers : undefined,
          goldMode: gold.length ? mode : undefined,
          items: items.map((r) => ({ rewardId: r.id, heroId: owners[r.id] })),
          announce,
        },
      },
      {
        onSuccess: (paid) => {
          if (paid?.remainder) pushNotice(`${paid.remainder} was left over from the split and was not paid.`);
          onClose();
        },
      },
    );
  }

  const label = (r: Quest["rewards"][number]) =>
    r.type === "item" && (r.qty ?? 1) > 1 ? `${r.qty}× ${r.value ?? r.label}` : (r.value ?? r.label);

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">{quest.title}</div>
      <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">Pay out</h3>

      {gold.length > 0 && (
        <div className="mb-3" role="group" aria-label="Gold">
          <div className="field-label mb-1.5">Gold — {gold.map(label).join(" + ")}</div>
          <div className="mb-2 flex gap-2" role="radiogroup" aria-label="How the gold is paid">
            {(["split", "each"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => chooseMode(m)}
                className={`btn-base ${mode === m ? "btn-gold" : "btn-ghost-ink"} px-4 py-2 text-[11px]`}
              >
                {m === "split" ? "Split between them" : "Each gets it all"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {eligible.map((h) => (
              <label key={h.id} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-body">
                <input type="checkbox" checked={sharers.includes(h.id)} onChange={() => toggle(h.id)} />
                {h.name}
              </label>
            ))}
          </div>
          {mode === "split" && sharers.length > 1 && (
            <p className="font-accent m-0 mt-1.5 text-[11.5px] italic text-ink-body">
              Shared evenly, rounded down — any coin left over is not paid.
            </p>
          )}
        </div>
      )}

      {items.map((r) => (
        <label key={r.id} className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-body">
          <span className="min-w-0 flex-1 truncate font-heading font-bold text-ink">{label(r)}</span>
          <span className="whitespace-nowrap text-[11px] italic">goes to</span>
          <select
            className="input-parchment input-compact w-44 shrink-0 cursor-pointer text-[12px]"
            aria-label={`Who receives ${label(r)}`}
            value={owners[r.id] ?? ""}
            onChange={(e) => setPicked((prev) => ({ ...prev, [r.id]: e.target.value }))}
          >
            {eligible.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      ))}

      {words.length > 0 && (
        <p className="font-accent m-0 mb-3 text-[12px] italic text-ink-body">
          Stays words on the notice, to give by hand with Give:{" "}
          {words.map((r) => `${r.label}${r.value ? ` ${r.value}` : ""}`).join(", ")}.
        </p>
      )}

      <label className="mb-4 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-body">
        <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
        Tell the table in the Chronicle
      </label>

      <div className="flex items-center justify-end gap-3">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Not now
        </button>
        <button onClick={submit} disabled={!ready} className="btn-base btn-gold clip-octagon h-10 px-6 text-xs">
          {pay.isPending ? "Paying…" : "Pay out"}
        </button>
      </div>
    </ParchmentModal>
  );
}
