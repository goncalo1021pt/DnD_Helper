import { useMemo, useState } from "react";
import type { Combatant } from "../../api/client";
import { useCharacters, useRules } from "../../hooks";
import {
  encounterDifficulty,
  type DifficultyBand,
} from "../../lib/encounterDifficulty";

/* ═══ Will this flatten them? (#110) ═══════════════════════════════════════
   A DM building a fight had no signal about its weight until the table found
   out. Everything needed was already on screen — each creature carries its XP,
   and the seated party's levels are known — so this is a bar that moves as
   monsters go in and out.

   It sits in the builder rather than the tracker on purpose: once the fight is
   running, the answer is no longer useful and the screen has better things to
   show. */

const BAND_TONE: Record<DifficultyBand, { label: string; colour: string }> = {
  trivial: { label: "Trivial", colour: "#6f7f57" },
  low: { label: "Low", colour: "#7ea63f" },
  moderate: { label: "Moderate", colour: "#c99a3f" },
  high: { label: "High", colour: "#8b2520" },
};

export function DifficultyMeter({
  campaignId,
  combatants,
}: {
  campaignId: string;
  combatants: Combatant[];
}) {
  const { data: monsters } = useRules("monster");
  const { data: party } = useCharacters(campaignId);

  // Who is actually turning up. Not everyone shows up on the night, and a
  // budget that assumes a full table is the wrong budget — so the DM can drop
  // anyone out and watch the bar move. Absent by id, so a hero joining the
  // roster later is included rather than silently missing.
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const coming = (party ?? []).filter((c) => !absent.has(c.id));

  const byId = useMemo(
    () => new Map((monsters ?? []).map((m) => [m.id, m])),
    [monsters],
  );

  const difficulty = useMemo(() => {
    const creatures = combatants
      .filter((c) => c.kind === "monster" && c.contentId)
      .map((c) => ({ monster: byId.get(c.contentId as string), count: 1 }));
    return encounterDifficulty(creatures, coming.map((c) => c.level));
  }, [combatants, byId, coming]);

  const tone = BAND_TONE[difficulty.band];
  const hasParty = coming.length > 0;

  return (
    // Named as a group so the band, the numbers and the roster read as one
    // thing — and so "Low" here is never confused with the Den's "CR: low →
    // high" sort sitting a few hundred pixels to the left.
    <div
      role="group"
      aria-label="Encounter difficulty"
      className="mb-3 rounded-[4px] p-3"
      style={{ background: "rgba(0,0,0,.14)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.14)" }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="label-stamp text-[10px] tracking-[2px] text-gold-muted">Difficulty</div>
        <div className="font-heading text-sm font-bold tabular-nums" style={{ color: tone.colour }}>
          {hasParty ? tone.label : "—"}
        </div>
      </div>

      {/* The bar runs to the party's High budget, so "full" means the top of
          the band rather than an arbitrary ceiling. */}
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(0,0,0,.35)" }}
        role="meter"
        aria-label="XP against the party's budget"
        aria-valuenow={difficulty.totalXP}
        aria-valuemin={0}
        aria-valuemax={difficulty.budget.high || undefined}
      >
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${difficulty.fraction * 100}%`, background: tone.colour }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-cream-muted">
        <span className="tabular-nums">
          <span className="font-heading font-bold text-ember-bright">
            {difficulty.totalXP.toLocaleString()}
          </span>{" "}
          XP in the fight
        </span>
        {hasParty && (
          <span className="tabular-nums text-gold-muted">
            budget {difficulty.budget.low.toLocaleString()} / {difficulty.budget.moderate.toLocaleString()} /{" "}
            {difficulty.budget.high.toLocaleString()}
          </span>
        )}
      </div>

      {/* Who is counted. A hero the DM drops out is struck through rather than
          removed, so it reads as "not tonight" rather than "not at this table". */}
      {(party ?? []).length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(party ?? []).map((c) => {
            const here = !absent.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() =>
                  setAbsent((prev) => {
                    const next = new Set(prev);
                    if (here) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  })
                }
                aria-pressed={here}
                title={here ? `${c.name} is here — click if they are not` : `${c.name} is not coming`}
                className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[9px] tracking-[1px]"
                style={{
                  color: here ? "#e6d2a0" : "#8a7b60",
                  background: here ? "rgba(201,162,39,.1)" : "transparent",
                  boxShadow: `inset 0 0 0 1px rgba(201,162,39,${here ? ".3" : ".12"})`,
                  textDecoration: here ? "none" : "line-through",
                }}
              >
                {c.name} {c.level}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="font-accent mt-2 text-[11px] italic text-cream-muted">
          Seat some heroes at the table and their budget appears here.
        </div>
      )}
    </div>
  );
}
