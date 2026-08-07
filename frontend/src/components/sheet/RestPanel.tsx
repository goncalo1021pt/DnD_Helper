import { useState } from "react";
import type { Character } from "../../api/client";
import { useRest } from "../../hooks";

/* ═══ The two rests (#118) ══════════════════════════════════════════════════
   They existed only as reference text. After a night at the table a player
   un-clicked every spent slot by hand, clicked HP up to max, and separately
   tapped the spell swap — three chores standing in for one action, and three
   chances to forget one.

   The report afterwards is the point of the panel, not decoration: a rest that
   silently changed four numbers is a rest you have to go and verify. This says
   what it did, including what each hit die rolled. */

type Report = {
  hpRestored: number;
  hitDiceSpent: number;
  hitDiceRegained: number;
  hitDiceLeft: number;
  slotsRestored: boolean;
  rolls: number[];
  canSwapSpells: boolean;
  poolsRestored: string[];
};

/**
 * What a rest just did, in the order a player checks it.
 *
 * `hasSlots` because the server restores slots on every long rest and says so,
 * which is true and useless to a Fighter — a report that lists something the
 * hero does not have reads as boilerplate, and boilerplate is what stops people
 * reading the line that matters.
 */
function restLine(kind: "long" | "short", r: Report, hasSlots: boolean): string {
  const parts: string[] = [];
  if (r.hpRestored > 0) parts.push(`${r.hpRestored} HP back`);
  if (r.slotsRestored && hasSlots) parts.push("spell slots restored");
  // The server names only the pools that actually moved, so a Fighter's report
  // never mentions pools they do not have.
  if ((r.poolsRestored ?? []).length > 0) parts.push(`${r.poolsRestored.join(", ")} restored`);
  if (r.hitDiceRegained > 0) {
    parts.push(`${r.hitDiceRegained} hit ${r.hitDiceRegained === 1 ? "die" : "dice"} regained`);
  }
  if (r.hitDiceSpent > 0) {
    parts.push(`${r.hitDiceSpent} spent (rolled ${r.rolls.join(", ")})`);
  }
  if (parts.length === 0) {
    return kind === "long" ? "Rested — nothing left to restore." : "An hour's breath, nothing spent.";
  }
  return `${parts.join(" · ")}.`;
}

export default function RestPanel({
  character,
  canEdit,
  onSpellSwap,
}: {
  character: Character;
  canEdit: boolean;
  /** Opened after a long rest for classes that re-prepare on one. */
  onSpellSwap: () => void;
}) {
  const rest = useRest(character.id);
  const [spend, setSpend] = useState(1);
  const [report, setReport] = useState<{ kind: "long" | "short"; r: Report } | null>(null);

  const total = character.level;
  const left = total - (character.hitDiceUsed ?? 0);
  const hasSlots = (character.sheet?.spellSlots ?? []).some((s) => s.max > 0);

  if (!canEdit) return null;

  const take = (kind: "long" | "short", hitDice?: number) =>
    rest.mutate(
      { kind, hitDice },
      {
        onSuccess: (data) => {
          const r = data as unknown as Report;
          setReport({ kind, r });
          setSpend(1);
          // The trigger the swap has been waiting for: it used to be a button
          // the player pressed whenever they decided a rest had happened.
          if (kind === "long" && r.canSwapSpells) onSpellSwap();
        },
      },
    );

  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label-stamp text-[10px] tracking-[3px] text-gold-muted">Rest</span>
        <span className="label-stamp text-[9px] tracking-[1px] text-gold-muted tabular-nums">
          Hit dice {left} / {total}
        </span>
      </div>

      <div className="parchment flex flex-col gap-3 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => take("long")}
            disabled={rest.isPending}
            title="Full HP, every spell slot back, and half your hit dice"
            className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px] disabled:opacity-40"
          >
            Long Rest
          </button>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => take("short", spend)}
              disabled={rest.isPending || left <= 0}
              title={
                left > 0
                  ? "Spend hit dice to heal — a pact caster's slots return too"
                  : "No hit dice left to spend — take a long rest"
              }
              className="btn-base btn-ghost-ink h-9 px-3 text-[12px] disabled:opacity-40"
            >
              Short Rest
            </button>
            {/* The stepper is beside the button rather than in a modal: at the
                table this is one decision — how many dice — and it is made in
                the same breath as taking the rest. */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSpend((n) => Math.max(0, n - 1))}
                disabled={spend <= 0}
                aria-label="One fewer hit die"
                className="btn-base btn-ghost-ink h-7 w-7 p-0 text-[13px] disabled:opacity-30"
              >
                −
              </button>
              <span
                className="font-heading w-6 text-center text-[13px] font-bold text-ink tabular-nums"
                aria-label="Hit dice to spend"
              >
                {Math.min(spend, Math.max(left, 0))}
              </span>
              <button
                onClick={() => setSpend((n) => Math.min(Math.max(left, 0), n + 1))}
                disabled={spend >= left}
                aria-label="One more hit die"
                className="btn-base btn-ghost-ink h-7 w-7 p-0 text-[13px] disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {report && (
          <div className="font-body text-[12.5px] italic text-ink-body" role="status">
            <span className="font-heading not-italic font-bold text-ink">
              {report.kind === "long" ? "Whole again" : "Caught your breath"}
            </span>{" "}
            — {restLine(report.kind, report.r, hasSlots)}
          </div>
        )}
      </div>
    </section>
  );
}
