/* Conditions and death saves in the initiative order (#173).

   The two marks the tracker was missing. Everything else on a combatant row
   says where it stands in the order; these say what is happening to it — who is
   poisoned, who is concentrating, who is bleeding out — which at a real table is
   most of what the DM is being asked between turns.

   Split out of CombatantRow because the player's read-only view draws the same
   chips and the same pips, and the DM's row is not the place for a component
   the player view also imports. */
import { useState } from "react";
import type { Combatant } from "../../api/client";
import { useUpdateCombatant } from "../../hooks";
import { CONDITION_NAMES, MAX_EXHAUSTION, exhaustionLevel } from "../../lib/conditions";
import { RuleTerm } from "../ui/RulePopover";

/* Conditions read as a muted violet so they never compete with the two things
   already coloured on the row: the gold of whose turn it is, and the red/green
   of hit points. */
const COND_TONE = "#a892c4";
const SAVE_PASS = "#8fb15f";
const SAVE_FAIL = "#d68a72";

/* ── read-only: the chips anyone at the table sees ─────────────────────── */

export function ConditionChips({ conditions }: { conditions: string[] }) {
  if (conditions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {conditions.map((name) => (
        // A chip that names a rule entry opens the actual text (#199) —
        // "what does Restrained do again?" without leaving the fight.
        <RuleTerm
          key={name}
          term={name}
          className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8.5px] font-bold tracking-[1px]"
          style={{ color: COND_TONE, background: `${COND_TONE}1c`, boxShadow: `inset 0 0 0 1px ${COND_TONE}55` }}
        >
          {name}
        </RuleTerm>
      ))}
    </div>
  );
}

/* ── the DM's editor ───────────────────────────────────────────────────── */

export function ConditionEditor({
  c,
  campaignId,
  encounterId,
}: {
  c: Combatant;
  campaignId: string;
  encounterId: string;
}) {
  const update = useUpdateCombatant(campaignId, encounterId);
  const [open, setOpen] = useState(false);
  const current = c.conditions ?? [];
  const level = current.map(exhaustionLevel).find((l) => l > 0) ?? 0;

  /* The whole set is sent every time. It is fifteen names long at worst, and a
     replacement cannot half-apply the way an add/remove pair can when the DM
     toggles two chips before the first round-trip lands. */
  function commit(next: string[]) {
    update.mutate({ combatantId: c.id, body: { conditions: next } });
  }

  function toggle(name: string) {
    commit(current.includes(name) ? current.filter((n) => n !== name) : [...current, name]);
  }

  /* Exhaustion is one condition with a level, so setting a level replaces any
     level already there rather than stacking a second chip beside it. Choosing
     the level it already has clears it, which is how the DM walks it back down. */
  function setExhaustion(next: number) {
    const without = current.filter((n) => exhaustionLevel(n) === 0);
    commit(next === 0 || next === level ? without : [...without, `Exhaustion ${next}`]);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Conditions"
        className="btn-base h-8 px-2 text-[10px] tracking-[1px]"
        style={{
          color: current.length ? "#1c1108" : COND_TONE,
          background: current.length ? COND_TONE : `${COND_TONE}14`,
          boxShadow: `inset 0 0 0 1px ${COND_TONE}55`,
        }}
      >
        {current.length ? `${current.length} ✦` : "✦"}
      </button>

      {open && (
        <>
          {/* A full-screen catcher rather than a document listener: the tracker
              can hold a dozen of these, and twelve mousedown handlers fighting
              over one click is worse than one div. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-50 mt-1 w-[232px] rounded-[3px] p-2"
            style={{ background: "#150e07", boxShadow: "0 6px 24px rgba(0,0,0,.6), inset 0 0 0 1px rgba(201,162,39,.32)" }}
          >
            <div className="flex flex-wrap gap-1">
              {CONDITION_NAMES.map((name) => {
                const on = current.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggle(name)}
                    className="label-stamp rounded-[2px] px-1.5 py-1 text-[8.5px] font-bold tracking-[1px]"
                    style={{
                      color: on ? "#1c1108" : COND_TONE,
                      background: on ? COND_TONE : `${COND_TONE}14`,
                      boxShadow: `inset 0 0 0 1px ${COND_TONE}${on ? "" : "44"}`,
                    }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 border-t pt-2" style={{ borderColor: "rgba(201,162,39,.2)" }}>
              <div className="label-stamp mb-1 text-[8.5px] tracking-[1px] text-gold-muted">Exhaustion</div>
              <div className="flex gap-1">
                {Array.from({ length: MAX_EXHAUSTION }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setExhaustion(n)}
                    title={n === MAX_EXHAUSTION ? "Level 6 — death" : `Level ${n}`}
                    className="font-heading h-6 w-6 rounded-[2px] text-[11px] font-bold tabular-nums"
                    style={{
                      color: level >= n ? "#1c1108" : COND_TONE,
                      background: level >= n ? COND_TONE : `${COND_TONE}14`,
                      boxShadow: `inset 0 0 0 1px ${COND_TONE}44`,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {current.length > 0 && (
              <button
                onClick={() => commit([])}
                className="label-stamp mt-2 w-full rounded-[2px] py-1 text-[8.5px] tracking-[1px]"
                style={{ color: "#d68a72", background: "rgba(139,37,32,.14)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
              >
                Clear all
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── death saves ───────────────────────────────────────────────────────── */

/* Pips show only for a hero who is actually dying. A standing PC carries a 0/0
   tally (that is how the client tells "not dying" from "no such concept"), and
   drawing six empty circles on every party member all fight would bury the one
   row that matters. */
export function shouldShowDeathSaves(c: Combatant): boolean {
  return c.kind === "pc" && !!c.deathSaves && c.hpState === "down";
}

export function DeathSavePips({
  c,
  campaignId,
  encounterId,
  editable,
}: {
  c: Combatant;
  campaignId: string;
  encounterId: string;
  /* The player view is read-only, per the tracker's standing rule: players
     watch, the DM rules. A player still sees every pip — a friend bleeding out
     is the table's business, not a secret. */
  editable: boolean;
}) {
  const update = useUpdateCombatant(campaignId, encounterId);
  const saves = c.deathSaves;
  if (!saves) return null;

  /* Clicking the pip you are already on walks the tally back one, so a
     misclick mid-fight costs one more click and not a hero. */
  function set(field: "deathSaveSuccesses" | "deathSaveFailures", n: number, currentValue: number) {
    update.mutate({ combatantId: c.id, body: { [field]: n === currentValue ? n - 1 : n } });
  }

  function row(label: string, tone: string, filled: number, field: "deathSaveSuccesses" | "deathSaveFailures") {
    return (
      <div className="flex items-center gap-1">
        <span className="label-stamp text-[8px] tracking-[1px]" style={{ color: tone }}>
          {label}
        </span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            disabled={!editable}
            onClick={() => set(field, n, filled)}
            title={editable ? `${label} ${n}` : undefined}
            className="h-3 w-3 rounded-full disabled:cursor-default"
            style={{
              background: filled >= n ? tone : "transparent",
              boxShadow: `inset 0 0 0 1px ${tone}${filled >= n ? "" : "77"}`,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {row("saves", SAVE_PASS, saves.successes, "deathSaveSuccesses")}
      {row("fails", SAVE_FAIL, saves.failures, "deathSaveFailures")}
      {saves.failures >= 3 && (
        <span className="label-stamp text-[8.5px] font-bold tracking-[1.5px]" style={{ color: SAVE_FAIL }}>
          dead
        </span>
      )}
      {saves.successes >= 3 && saves.failures < 3 && (
        <span className="label-stamp text-[8.5px] font-bold tracking-[1.5px]" style={{ color: SAVE_PASS }}>
          stable
        </span>
      )}
    </div>
  );
}
