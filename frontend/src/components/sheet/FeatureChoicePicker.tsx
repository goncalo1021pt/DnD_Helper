/*
The one picker behind every class feature's choice (#382) — on the sheet, in the
Forge and at level-up — so a Fighting Style reads the same wherever it is made.

Controlled: the caller holds the picks. `locked` are picks already made that
this choice may not give up (it declares no swap); they show as chosen and
cannot be cleared, and the rest of the count is free.
*/

import { useState } from "react";
import type { FeatureChoice } from "../../api/client";
import type { PoolEntry } from "../../lib/featureChoices";
import { useSetFeatureChoice } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";

const NOUN: Record<FeatureChoice["type"], [string, string]> = {
  feat: ["option", "options"],
  expertise: ["skill", "skills"],
  mastery: ["weapon", "weapons"],
  option: ["option", "options"],
};

export function choicePrompt(choice: FeatureChoice): string {
  const [one, many] = NOUN[choice.type];
  return `Choose ${choice.count} ${choice.count === 1 ? one : many}`;
}

export function FeatureChoicePicker({
  choice,
  pool,
  value,
  onChange,
  locked = [],
}: {
  choice: FeatureChoice;
  pool: PoolEntry[];
  value: string[];
  onChange: (picks: string[]) => void;
  locked?: string[];
}) {
  const [filter, setFilter] = useState("");
  const toggle = (name: string) => {
    if (locked.includes(name)) return;
    if (value.includes(name)) return onChange(value.filter((v) => v !== name));
    if (choice.count === 1 && locked.length === 0) return onChange([name]);
    if (value.length < choice.count) onChange([...value, name]);
  };
  const q = filter.trim().toLowerCase();
  const shown = pool.filter((p) => !q || p.name.toLowerCase().includes(q) || value.includes(p.name));

  return (
    <div data-choice={choice.key}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="label-stamp text-[9px] tracking-[1.5px] text-ink-label">
          {choicePrompt(choice)}
        </span>
        <span className="label-stamp text-[9px] tracking-[1px] text-ink-label">
          {value.length}/{choice.count}
        </span>
      </div>
      {pool.length > 12 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search…"
          className="input-parchment input-compact mb-1.5 w-full text-[12px]"
        />
      )}
      <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-1">
        {shown.map((p) => {
          const on = value.includes(p.name);
          const blocked = !on && (!!p.disabled || value.length >= choice.count && choice.count > 1);
          return (
            <button
              key={p.name}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={blocked || locked.includes(p.name)}
              onClick={() => toggle(p.name)}
              className="cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-left text-[12.5px] text-ink-body disabled:cursor-default"
              style={{
                background: on ? "rgba(139,37,32,.12)" : "rgba(120,86,42,.08)",
                boxShadow: `inset 0 0 0 1px ${on ? "rgba(139,37,32,.45)" : "rgba(120,80,30,.2)"}`,
                opacity: blocked ? 0.45 : 1,
              }}
            >
              <strong className="font-heading text-ink">{p.name}</strong>
              {(p.disabled || locked.includes(p.name)) && (
                <span className="label-stamp ml-2 text-[8.5px] tracking-[1px] text-ink-label">
                  {locked.includes(p.name) ? "chosen" : p.disabled}
                </span>
              )}
              {p.summary && <div className="line-clamp-2 text-[11.5px] italic">{p.summary}</div>}
            </button>
          );
        })}
        {pool.length === 0 && (
          <div className="font-accent px-4 py-6 text-center text-[13px] italic text-ink-body">
            {choice.type === "expertise"
              ? "No skill proficiency to sharpen yet."
              : "Nothing in the library answers this choice."}
          </div>
        )}
      </div>
    </div>
  );
}

/** The sheet's door to one choice: make it, finish it, or change it. */
export function FeatureChoiceModal({
  characterId,
  choice,
  pool,
  onClose,
}: {
  characterId: string;
  choice: FeatureChoice;
  pool: PoolEntry[];
  onClose: () => void;
}) {
  // A choice that may not change keeps what it has and fills the rest.
  const locked = choice.swap ? [] : choice.picked;
  const [picks, setPicks] = useState<string[]>(choice.picked);
  const save = useSetFeatureChoice(characterId);
  const ready = picks.length === choice.count;
  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[520px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        {choice.source} {choice.level}
      </div>
      <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">{choice.name}</h3>
      <FeatureChoicePicker choice={choice} pool={pool} value={picks} onChange={setPicks} locked={locked} />
      {choice.swap && choice.picked.length > 0 && (
        <p className="font-body m-0 mt-2 text-[12px] italic text-ink-label">
          {choice.swap === "rest"
            ? "The rules let this change when you finish a Long Rest."
            : "The rules let this change when you gain a level in the class."}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-3">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        <button
          disabled={!ready || save.isPending}
          onClick={() => save.mutate({ key: choice.key, picks }, { onSuccess: onClose })}
          className="btn-base btn-gold clip-octagon h-10 px-6 text-xs"
        >
          Save
        </button>
      </div>
    </ParchmentModal>
  );
}
