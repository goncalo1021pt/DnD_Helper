
import { useEffect, useState } from "react";
import type { Combatant } from "../../api/client";
import {
  useDeleteCombatant,
  useDeleteCombatantGroup,
  useRollCombatant,
  useUpdateCombatant,
} from "../../hooks";
import { IconEye, IconEyeOff, IconTrash } from "../ui/icons";
import { mobName } from "./entries";
import { HpStatePill } from "./rowParts";
import { GREEN_BTN, HP_STATE_TONE, HP_STEP, RED_BTN } from "./theme";

/* A mob: monsters added together in one go. They share an initiative and act on
   one turn, so the tracker shows a SINGLE line — that's the whole point, five
   skeletons shouldn't be five things to scroll past. Expand it to damage them
   individually, because each still keeps its own HP. */
export function GroupRow({
  members,
  active,
  campaignId,
  encounterId,
  editable,
  showInitiative = true,
}: {
  members: Combatant[];
  active: boolean;
  campaignId: string;
  encounterId: string;
  editable: boolean;
  showInitiative?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const update = useUpdateCombatant(campaignId, encounterId);
  const roll = useRollCombatant(campaignId, encounterId);
  const delGroup = useDeleteCombatantGroup(campaignId, encounterId);
  const lead = members[0];
  const [initDraft, setInitDraft] = useState(lead.initiative?.toString() ?? "");
  useEffect(() => setInitDraft(lead.initiative?.toString() ?? ""), [lead.initiative]);

  // One roll, one initiative: the server spreads either to every member, so
  // acting on the lead is enough.
  function commitInit() {
    const v = initDraft.trim();
    if (v === "") return;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n === lead.initiative) return;
    update.mutate({ combatantId: lead.id, body: { initiative: n } });
  }

  const standing = members.filter((m) => (m.hpCurrent ?? 0) > 0).length;
  const hpNow = members.reduce((t, m) => t + (m.hpCurrent ?? 0), 0);
  const hpTop = members.reduce((t, m) => t + (m.hpMax ?? 0), 0);
  const state = standing === 0 ? "down" : hpNow * 2 <= hpTop ? "bloodied" : "healthy";
  const anyHidden = members.some((m) => m.hidden);

  // Reveal/hide the mob as a unit. The monster picker adds hidden, so without
  // this a grouped mob could never be shown to the party at all. If any member
  // is hidden the click reveals everything; otherwise it hides everything.
  function revealToggle() {
    const next = !anyHidden;
    for (const m of members) {
      if (m.hidden !== next) update.mutate({ combatantId: m.id, body: { hidden: next } });
    }
  }

  return (
    <div
      className="rounded-[3px]"
      style={{
        background: active ? "rgba(224,169,78,.1)" : "rgba(0,0,0,.14)",
        boxShadow: active ? "inset 0 0 0 1px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.16)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
        {showInitiative && (
          <div className="flex flex-none items-center gap-1">
            <input
              value={initDraft}
              onChange={(e) => setInitDraft(e.target.value.replace(/[^\d-]/g, ""))}
              onBlur={commitInit}
              onKeyDown={(e) => e.key === "Enter" && commitInit()}
              placeholder="—"
              disabled={!editable}
              title="Initiative for the whole group"
              className="input-hall h-9 w-11 text-center font-heading text-[15px] font-bold tabular-nums"
            />
            {editable && (
              <button onClick={() => roll.mutate(lead.id)} title="Roll once for the group" className="btn-base btn-wax h-9 w-8 text-[13px]">
                🎲
              </button>
            )}
          </div>
        )}

        <div className="min-w-[130px] flex-1">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-1.5 text-left">
              <span className="flex-none text-[10px] text-gold-muted" style={{ transform: open ? "rotate(90deg)" : "none" }}>▶</span>
              <span className="font-heading truncate text-[13.5px] font-semibold text-cream">{mobName(lead.name)}</span>
              <span className="label-stamp flex-none text-[9px] tracking-[1px] text-ember-bright">×{members.length}</span>
            </button>
            {editable && (
              <button
                onClick={revealToggle}
                title={anyHidden ? "Hidden from players — click to reveal the group" : "Visible to players — click to hide the group"}
                className="flex-none"
                style={{ color: anyHidden ? "#9a86b8" : "#8fb15f" }}
              >
                {anyHidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
            )}
          </div>
          <div className="label-stamp mt-0.5 pl-[15px] text-[8.5px] tracking-[1px] text-gold-muted">
            {standing} standing · AC {lead.ac} · {lead.initMod >= 0 ? "+" : ""}{lead.initMod} init
            {editable && <span className="ml-1.5">{anyHidden ? "· hidden" : "· shown"}</span>}
          </div>
        </div>

        <span className="font-heading w-16 text-right text-[13px] font-bold tabular-nums" style={{ color: HP_STATE_TONE[state] }}>
          {editable ? `${hpNow}/${hpTop}` : ""}
        </span>
        {!editable && <HpStatePill state={state} />}

        {editable && (
          <button onClick={() => lead.groupId && delGroup.mutate(lead.groupId)} title="Remove the whole group" className="btn-base flex-none p-1.5" style={RED_BTN}>
            <IconTrash size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-1 px-2.5 pb-2 pl-6">
          {members.map((m) => (
            <GroupMemberRow key={m.id} c={m} campaignId={campaignId} encounterId={encounterId} editable={editable} />
          ))}
        </div>
      )}
    </div>
  );
}

/* One skeleton inside the mob. No initiative control — the group owns that;
   this is where its own HP lives. */
export function GroupMemberRow({
  c,
  campaignId,
  encounterId,
  editable,
}: {
  c: Combatant;
  campaignId: string;
  encounterId: string;
  editable: boolean;
}) {
  const update = useUpdateCombatant(campaignId, encounterId);
  const del = useDeleteCombatant(campaignId, encounterId);
  const [dmg, setDmg] = useState(HP_STEP);

  function applyHp(sign: number) {
    const n = parseInt(dmg, 10);
    if (!n) return;
    const next = Math.max(0, Math.min(c.hpMax ?? 0, (c.hpCurrent ?? 0) + sign * n));
    update.mutate({ combatantId: c.id, body: { hpCurrent: next } });
    setDmg(HP_STEP);
  }

  const downed = (c.hpCurrent ?? 0) <= 0;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[3px] px-2 py-1.5"
      style={{ background: "rgba(0,0,0,.2)", opacity: downed ? 0.5 : 1 }}
    >
      <span className="font-heading min-w-[110px] flex-1 truncate text-[12px] text-cream">
        {c.name}
        {downed && <span className="label-stamp ml-1.5 text-[8px] tracking-[1px]" style={{ color: HP_STATE_TONE.down }}>down</span>}
      </span>
      {editable ? (
        <>
          <span className="font-heading w-14 text-right text-[12px] font-bold tabular-nums" style={{ color: HP_STATE_TONE[c.hpState] }}>
            {c.hpCurrent}/{c.hpMax}
          </span>
          <input
            value={dmg}
            onChange={(e) => setDmg(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && applyHp(-1)}
            placeholder="0"
            title="Amount to damage or heal"
            className="input-hall h-7 w-11 text-center text-[11px]"
          />
          <button onClick={() => applyHp(-1)} disabled={!dmg} title="Damage" className="btn-base h-7 w-7 text-[13px] font-bold disabled:opacity-40" style={RED_BTN}>−</button>
          <button onClick={() => applyHp(1)} disabled={!dmg} title="Heal" className="btn-base h-7 w-7 text-[13px] font-bold disabled:opacity-40" style={GREEN_BTN}>+</button>
          <button onClick={() => del.mutate(c.id)} title="Remove just this one" className="btn-base flex-none p-1" style={RED_BTN}>
            <IconTrash size={11} />
          </button>
        </>
      ) : (
        <HpStatePill state={c.hpState} />
      )}
    </div>
  );
}
