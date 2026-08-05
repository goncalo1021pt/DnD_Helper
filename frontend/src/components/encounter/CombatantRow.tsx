/* One combatant in the order: initiative, hit points, and who can see them. */
import { useEffect, useState } from "react";
import type { Combatant } from "../../api/client";
import { useDeleteCombatant, useRollCombatant, useUpdateCombatant } from "../../hooks";
import { IconEye, IconEyeOff, IconTrash } from "../ui/icons";
import { ConditionChips, ConditionEditor, DeathSavePips, shouldShowDeathSaves } from "./conditionParts";
import { GREEN_BTN, HP_STATE_TONE, HP_STEP, RED_BTN } from "./theme";

/* ═══ DM: the encounter tool ═══════════════════════════════════════════════ */

export function CombatantRow({
  c,
  active,
  campaignId,
  encounterId,
  showInitiative = true,
}: {
  c: Combatant;
  active: boolean;
  campaignId: string;
  encounterId: string;
  /* Initiative is a property of a fight in progress, not of a prepared one —
     the builder hides it entirely rather than showing an order that means
     nothing yet. */
  showInitiative?: boolean;
}) {
  const update = useUpdateCombatant(campaignId, encounterId);
  const roll = useRollCombatant(campaignId, encounterId);
  const del = useDeleteCombatant(campaignId, encounterId);
  const [dmg, setDmg] = useState(HP_STEP);
  const [initDraft, setInitDraft] = useState(c.initiative?.toString() ?? "");
  // Resync the typed initiative when it changes elsewhere (a roll, a re-roll).
  useEffect(() => setInitDraft(c.initiative?.toString() ?? ""), [c.initiative]);

  function commitInit() {
    const v = initDraft.trim();
    if (v === "") return;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n === c.initiative) return;
    update.mutate({ combatantId: c.id, body: { initiative: n } });
  }

  function applyHp(sign: number) {
    const n = parseInt(dmg, 10);
    if (!n) return;
    const next = Math.max(0, Math.min((c.hpMax ?? 0), (c.hpCurrent ?? 0) + sign * n));
    update.mutate({ combatantId: c.id, body: { hpCurrent: next } });
    setDmg(HP_STEP);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[3px] px-2.5 py-2"
      style={{
        background: active ? "rgba(224,169,78,.1)" : "rgba(0,0,0,.14)",
        boxShadow: active ? "inset 0 0 0 1px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.16)",
      }}
    >
      {/* initiative — type it, or roll the die. Running fights only. */}
      {showInitiative && (
        <div className="flex flex-none items-center gap-1">
          <input
            value={initDraft}
            onChange={(e) => setInitDraft(e.target.value.replace(/[^\d-]/g, ""))}
            onBlur={commitInit}
            onKeyDown={(e) => e.key === "Enter" && commitInit()}
            placeholder="—"
            title="Type an initiative"
            className="input-hall h-9 w-11 text-center font-heading text-[15px] font-bold tabular-nums"
          />
          <button
            onClick={() => roll.mutate(c.id)}
            title="Roll d20 + modifier"
            className="btn-base btn-wax h-9 w-8 text-[13px]"
          >
            🎲
          </button>
        </div>
      )}

      {/* name + hidden + facts */}
      <div className="min-w-[130px] flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-heading truncate text-[13.5px] font-semibold text-cream">{c.name}</span>
          {c.kind !== "pc" && (
            <button
              onClick={() => update.mutate({ combatantId: c.id, body: { hidden: !c.hidden } })}
              title={c.hidden ? "Hidden from players — click to reveal" : "Visible to players — click to hide"}
              className="flex-none"
              style={{ color: c.hidden ? "#9a86b8" : "#8fb15f" }}
            >
              {c.hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
          )}
        </div>
        <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-gold-muted">
          AC {c.ac} · {c.initMod >= 0 ? "+" : ""}{c.initMod} init
          {c.kind !== "pc" && <span className="ml-1.5">{c.hidden ? "· hidden" : "· shown"}</span>}
        </div>
      </div>

      {/* hp: current/max, type an amount, then damage or heal */}
      <div className="flex items-center gap-1.5">
        <span className="font-heading w-14 text-right text-[13px] font-bold tabular-nums" style={{ color: HP_STATE_TONE[c.hpState] }}>
          {c.hpCurrent}/{c.hpMax}
        </span>
        <input
          value={dmg}
          onChange={(e) => setDmg(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && applyHp(-1)}
          placeholder="0"
          title="Amount to damage or heal"
          className="input-hall h-8 w-12 text-center text-[12px]"
        />
        <button onClick={() => applyHp(-1)} disabled={!dmg} title="Damage" className="btn-base h-8 w-8 text-[15px] font-bold disabled:opacity-40" style={RED_BTN}>
          −
        </button>
        <button onClick={() => applyHp(1)} disabled={!dmg} title="Heal" className="btn-base h-8 w-8 text-[15px] font-bold disabled:opacity-40" style={GREEN_BTN}>
          +
        </button>
      </div>

      <ConditionEditor c={c} campaignId={campaignId} encounterId={encounterId} />

      <button onClick={() => del.mutate(c.id)} title="Remove from encounter" className="btn-base flex-none p-1.5" style={RED_BTN}>
        <IconTrash size={12} />
      </button>

      {/* What is happening to it, on its own line. The row above is already
          full of controls, and conditions are read far more often than they are
          set — burying them between two buttons would hide the tracker's whole
          answer to "who is poisoned". */}
      {(c.conditions.length > 0 || shouldShowDeathSaves(c)) && (
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
          <ConditionChips conditions={c.conditions} />
          {shouldShowDeathSaves(c) && (
            <DeathSavePips c={c} campaignId={campaignId} encounterId={encounterId} editable />
          )}
        </div>
      )}
    </div>
  );
}
