import { useMemo, useState } from "react";
import type { RulesContent } from "../../api/client";
import {
  ANY_SWAPS,
  maxSpellLevel,
  spellChangesFor,
  spellOnClassList,
  swapAllowance,
  type CasterData,
  type CasterSource,
} from "../../lib/spellcasting";
import ParchmentModal from "./ParchmentModal";

/**
 * Trading prepared spells. The 2024 rules split the casters: a Cleric
 * re-prepares its whole list on a Long Rest, a Paladin swaps one, and a Bard
 * waits until it gains a level — so the same picker serves both triggers and
 * takes its allowance from the class's own spellChanges rule.
 *
 * A cantrip is only ever traded for a cantrip; the replacement list is filtered
 * to match whatever is being given up. The server re-checks all of it.
 */

export interface Swap {
  replace: string;
  with: string;
}

const level = (s: RulesContent) => ((s.data as { level?: number }).level ?? 0) as number;

export function swapLimits(klass: CasterSource | undefined, trigger: "long-rest" | "level-up") {
  const changes = spellChangesFor(klass?.data as CasterData | undefined);
  return {
    prepared: swapAllowance(changes.prepared, trigger),
    cantrips: swapAllowance(changes.cantrips, trigger),
  };
}

/** Whether this caster can trade anything at all on the given trigger. */
export function canSwapOn(klass: CasterSource | undefined, trigger: "long-rest" | "level-up") {
  const { prepared, cantrips } = swapLimits(klass, trigger);
  return prepared !== 0 || cantrips !== 0;
}

export default function SpellSwapModal({
  klass,
  known,
  library,
  characterLevel,
  trigger,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  /** Where the casting is declared: the class, or {class name, subclass data}
   * when it rides on the subclass (#220) — see casterSourceFor. */
  klass: CasterSource | undefined;
  /** The hero's current spells. */
  known: RulesContent[];
  /** Every spell the viewer can see, for the replacement list. */
  library: RulesContent[];
  characterLevel: number;
  trigger: "long-rest" | "level-up";
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (swaps: Swap[]) => void;
}) {
  // A swap in progress: what's being given up, and what replaces it.
  const [pairs, setPairs] = useState<Array<{ out: string; in: string }>>([]);
  const [picking, setPicking] = useState<string | null>(null);

  const limits = swapLimits(klass, trigger);
  const casterKind = (klass?.data as CasterData | undefined)?.spellcaster ?? "full";
  const topLevel = maxSpellLevel(casterKind, characterLevel);

  const knownById = useMemo(() => new Map(known.map((s) => [s.id, s])), [known]);
  const used = (id: string) => pairs.some((p) => p.out === id);

  // How many more of each kind may still be traded.
  const spent = pairs.reduce(
    (acc, p) => {
      const s = knownById.get(p.out);
      if (s) (level(s) === 0 ? acc.cantrips++ : acc.prepared++);
      return acc;
    },
    { prepared: 0, cantrips: 0 },
  );
  const roomFor = (s: RulesContent) => {
    const allowed = level(s) === 0 ? limits.cantrips : limits.prepared;
    if (allowed === 0) return false;
    if (allowed === ANY_SWAPS) return true;
    return (level(s) === 0 ? spent.cantrips : spent.prepared) < allowed;
  };

  // Replacements: on the class list, within reach, same kind, not already held.
  const replacementsFor = (out: RulesContent) =>
    library
      .filter((s) => spellOnClassList(s, klass))
      .filter((s) => (level(out) === 0 ? level(s) === 0 : level(s) > 0 && level(s) <= topLevel))
      .filter((s) => !knownById.has(s.id))
      .filter((s) => !pairs.some((p) => p.in === s.id))
      .sort((a, b) => level(a) - level(b) || a.name.localeCompare(b.name));

  const ready = pairs.filter((p) => p.out && p.in);
  const outBeingPicked = picking ? knownById.get(picking) : undefined;

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        {trigger === "long-rest" ? "After a Long Rest" : "On gaining a level"}
      </div>
      <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">
        Change Prepared Spells
      </h3>

      {outBeingPicked ? (
        <>
          <p className="font-body m-0 mb-2.5 text-center text-[13px] italic text-ink-body">
            Replace <strong className="font-heading not-italic">{outBeingPicked.name}</strong> with…
          </p>
          <div className="mb-4 flex max-h-[46vh] flex-col gap-1 overflow-y-auto pr-1">
            {replacementsFor(outBeingPicked).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setPairs((prev) =>
                    prev.some((p) => p.out === picking)
                      ? prev.map((p) => (p.out === picking ? { ...p, in: s.id } : p))
                      : [...prev, { out: picking!, in: s.id }],
                  );
                  setPicking(null);
                }}
                className="cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-left text-[12.5px] text-ink-body"
                style={{ background: "rgba(120,86,42,.1)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.25)" }}
              >
                <strong className="font-heading text-ink">{s.name}</strong>
                <span className="label-stamp ml-2 text-[8.5px] tracking-[1px] text-ink-label">
                  {level(s) === 0 ? "Cantrip" : `Level ${level(s)}`}
                </span>
                {s.summary && <div className="text-[11.5px] italic">{s.summary}</div>}
              </button>
            ))}
            {replacementsFor(outBeingPicked).length === 0 && (
              <div className="font-accent px-4 py-8 text-center text-[13px] italic text-ink-body">
                Nothing else on the {klass?.name ?? "class"} list is within reach.
              </div>
            )}
          </div>
          <button
            onClick={() => setPicking(null)}
            className="btn-base btn-ghost-ink w-full px-4 py-2 text-[12px]"
          >
            ← Back
          </button>
        </>
      ) : (
        <>
          <div className="mb-4 flex max-h-[46vh] flex-col gap-1 overflow-y-auto pr-1">
            {known.map((s) => {
              const pair = pairs.find((p) => p.out === s.id);
              const taken = library.find((l) => l.id === pair?.in);
              const allowed = roomFor(s) || used(s.id);
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-[2px] px-2.5 py-1.5"
                  style={{
                    background: pair ? "rgba(139,37,32,.12)" : "rgba(120,86,42,.08)",
                    boxShadow: `inset 0 0 0 1px ${pair ? "rgba(139,37,32,.4)" : "rgba(120,80,30,.2)"}`,
                    opacity: allowed ? 1 : 0.45,
                  }}
                >
                  <div className="min-w-0 text-[12.5px] text-ink-body">
                    <span className={pair ? "line-through" : ""}>
                      <strong className="font-heading text-ink">{s.name}</strong>
                    </span>
                    <span className="label-stamp ml-2 text-[8.5px] tracking-[1px] text-ink-label">
                      {level(s) === 0 ? "Cantrip" : `Level ${level(s)}`}
                    </span>
                    {taken && (
                      <div className="text-[12px]">
                        → <strong className="font-heading text-ink">{taken.name}</strong>
                      </div>
                    )}
                  </div>
                  {pair ? (
                    <button
                      onClick={() => setPairs((prev) => prev.filter((p) => p.out !== s.id))}
                      className="label-stamp cursor-pointer whitespace-nowrap border-none bg-transparent p-0 text-[9px] tracking-[1px] text-[#8b2520] underline"
                    >
                      Undo
                    </button>
                  ) : (
                    // Nothing at all for a spell this class may not trade — an
                    // invisible disabled button is still in the tab order and
                    // reads as a control that does nothing.
                    allowed && (
                      <button
                        onClick={() => setPicking(s.id)}
                        className="label-stamp cursor-pointer whitespace-nowrap rounded-[2px] border-none px-2 py-1 text-[9px] tracking-[1px]"
                        style={{
                          background: "rgba(16,9,5,.4)",
                          color: "#cdba93",
                          boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)",
                        }}
                      >
                        Swap
                      </button>
                    )
                  )}
                </div>
              );
            })}
            {known.length === 0 && (
              <div className="font-accent px-4 py-8 text-center text-[13px] italic text-ink-body">
                This hero has no spells to trade yet.
              </div>
            )}
          </div>

          {error && (
            <div
              className="font-body mb-3 rounded-[3px] px-3 py-2 text-[12.5px]"
              style={{ background: "rgba(139,37,32,.14)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)", color: "#8b2520" }}
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} className="btn-base btn-ghost-ink px-4 py-2 text-[12px]">
              Cancel
            </button>
            <button
              disabled={ready.length === 0 || busy}
              onClick={() => onConfirm(ready.map((p) => ({ replace: p.out, with: p.in })))}
              className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]"
            >
              {busy ? "Changing…" : `Confirm ${ready.length || ""}`.trim()}
            </button>
          </div>
        </>
      )}
    </ParchmentModal>
  );
}
