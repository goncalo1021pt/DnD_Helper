import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { Combatant, EncounterDetail } from "../api/client";
import {
  useActiveEncounter,
  useAddCombatant,
  useCharacters,
  useCreateEncounter,
  useDeleteCombatant,
  useDeleteEncounter,
  useEncounter,
  useEncounters,
  useRollCombatant,
  useRollInitiative,
  useRules,
  useUpdateCombatant,
  useUpdateEncounter,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import { IconEye, IconEyeOff, IconPlus, IconTrash } from "./ui/icons";

const HP_STATE_TONE: Record<string, string> = {
  healthy: "#7ea63f",
  bloodied: "#c99a3f",
  down: "#8b2520",
};

function HpStatePill({ state }: { state: string }) {
  return (
    <span
      className="label-stamp rounded-[2px] px-1.5 py-0.5 text-[8.5px] font-bold tracking-[1px]"
      style={{ color: HP_STATE_TONE[state], background: `${HP_STATE_TONE[state]}1c`, boxShadow: `inset 0 0 0 1px ${HP_STATE_TONE[state]}55` }}
    >
      {state}
    </span>
  );
}

/* ── shared: an initiative pip, current turn highlighted ──────────────── */
function TurnMark({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className="font-heading flex h-8 w-8 flex-none items-center justify-center rounded-[3px] text-[13px] font-bold tabular-nums"
      style={{
        color: active ? "#1c1108" : "#e0c890",
        background: active ? "#e0a94e" : "rgba(201,162,39,.1)",
        boxShadow: active ? "0 0 10px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.3)",
      }}
    >
      {children}
    </span>
  );
}

/* ═══ DM: the encounter tool ═══════════════════════════════════════════════ */

function CombatantRow({
  c,
  active,
  campaignId,
  encounterId,
}: {
  c: Combatant;
  active: boolean;
  campaignId: string;
  encounterId: string;
}) {
  const update = useUpdateCombatant(campaignId, encounterId);
  const roll = useRollCombatant(campaignId, encounterId);
  const del = useDeleteCombatant(campaignId, encounterId);
  const [dmg, setDmg] = useState("");

  function applyHp(sign: number) {
    const n = parseInt(dmg, 10);
    if (!n) return;
    const next = Math.max(0, Math.min((c.hpMax ?? 0), (c.hpCurrent ?? 0) + sign * n));
    update.mutate({ combatantId: c.id, body: { hpCurrent: next } });
    setDmg("");
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[3px] px-2.5 py-2"
      style={{
        background: active ? "rgba(224,169,78,.1)" : "rgba(0,0,0,.14)",
        boxShadow: active ? "inset 0 0 0 1px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.16)",
      }}
    >
      {/* initiative */}
      <button
        onClick={() => roll.mutate(c.id)}
        title="Roll this initiative"
        className="font-heading flex h-9 w-9 flex-none items-center justify-center rounded-[3px] text-[15px] font-bold tabular-nums text-ember-bright"
        style={{ background: "rgba(201,162,39,.12)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}
      >
        {c.initiative ?? "—"}
      </button>

      {/* name + hidden + hp state */}
      <div className="min-w-[130px] flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-heading truncate text-[13.5px] font-semibold text-cream">{c.name}</span>
          {c.kind !== "pc" && (
            <button
              onClick={() => update.mutate({ combatantId: c.id, body: { hidden: !c.hidden } })}
              title={c.hidden ? "Hidden from players — reveal" : "Visible to players — hide"}
              className="flex-none text-gold-muted hover:text-ember-bright"
            >
              {c.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
            </button>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-label text-gold-muted">
            AC {c.ac} · +{c.initMod} init
          </span>
        </div>
      </div>

      {/* hp */}
      <div className="flex items-center gap-1.5">
        <span className="font-heading text-[13px] font-bold tabular-nums" style={{ color: HP_STATE_TONE[c.hpState] }}>
          {c.hpCurrent}/{c.hpMax}
        </span>
        <input
          value={dmg}
          onChange={(e) => setDmg(e.target.value.replace(/\D/g, ""))}
          placeholder="0"
          className="input-hall input-compact w-12 text-center text-[12px]"
        />
        <button onClick={() => applyHp(-1)} title="Damage" className="btn-base btn-ghost-red h-7 w-7 text-[13px]">
          −
        </button>
        <button onClick={() => applyHp(1)} title="Heal" className="btn-base btn-ghost-ink h-7 w-7 text-[13px]">
          +
        </button>
      </div>

      <button
        onClick={() => del.mutate(c.id)}
        title="Remove"
        className="btn-base btn-ghost-red flex-none p-1.5"
      >
        <IconTrash size={12} />
      </button>
    </div>
  );
}

function AddCombatant({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const add = useAddCombatant(campaignId, encounterId);
  const { data: monsters } = useRules("monster");
  const { data: chars } = useCharacters(campaignId);
  const [kind, setKind] = useState<"monster" | "pc" | "custom">("monster");
  const [pick, setPick] = useState("");
  const [count, setCount] = useState("1");
  const [custom, setCustom] = useState({ label: "", hpMax: "", ac: "", initMod: "" });

  function addIt() {
    if (kind === "monster" && pick) {
      const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 12);
      for (let i = 0; i < n; i++) add.mutate({ kind: "monster", contentId: pick, hidden: true });
    } else if (kind === "pc" && pick) {
      add.mutate({ kind: "pc", characterId: pick });
    } else if (kind === "custom" && custom.label.trim()) {
      add.mutate({
        kind: "custom",
        label: custom.label.trim(),
        hpMax: parseInt(custom.hpMax, 10) || 1,
        ac: parseInt(custom.ac, 10) || 10,
        initMod: parseInt(custom.initMod, 10) || 0,
      });
      setCustom({ label: "", hpMax: "", ac: "", initMod: "" });
    }
    setPick("");
  }

  return (
    <div className="chip-hall flex flex-wrap items-center gap-2 px-3 py-2.5">
      <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPick(""); }} className="input-hall input-compact w-28 text-[12px]">
        <option value="monster">Monster</option>
        <option value="pc">Party</option>
        <option value="custom">Custom</option>
      </select>

      {kind === "monster" && (
        <>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input-hall input-compact min-w-[160px] flex-1 text-[12px]">
            <option value="">Choose a monster…</option>
            {(monsters ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} title="How many" className="input-hall input-compact w-12 text-center text-[12px]" />
        </>
      )}
      {kind === "pc" && (
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="input-hall input-compact min-w-[160px] flex-1 text-[12px]">
          <option value="">Choose a hero…</option>
          {(chars ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      {kind === "custom" && (
        <>
          <input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="Name" className="input-hall input-compact min-w-[120px] flex-1 text-[12px]" />
          <input value={custom.hpMax} onChange={(e) => setCustom({ ...custom, hpMax: e.target.value.replace(/\D/g, "") })} placeholder="HP" className="input-hall input-compact w-14 text-center text-[12px]" />
          <input value={custom.ac} onChange={(e) => setCustom({ ...custom, ac: e.target.value.replace(/\D/g, "") })} placeholder="AC" className="input-hall input-compact w-14 text-center text-[12px]" />
          <input value={custom.initMod} onChange={(e) => setCustom({ ...custom, initMod: e.target.value.replace(/[^\d-]/g, "") })} placeholder="+init" className="input-hall input-compact w-14 text-center text-[12px]" />
        </>
      )}

      <button onClick={addIt} disabled={add.isPending} className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]">
        <IconPlus size={13} /> Add
      </button>
    </div>
  );
}

function EncounterRunner({ campaign, detail }: { campaign: CampaignContext["campaign"]; detail: EncounterDetail }) {
  const enc = detail.encounter;
  const combatants = detail.combatants;
  const update = useUpdateEncounter(campaign.id);
  const rollAll = useRollInitiative(campaign.id, enc.id);
  const active = enc.status === "active";

  function step(dir: 1 | -1) {
    if (combatants.length === 0) return;
    let turn = enc.turnIndex + dir;
    let round = enc.round;
    if (turn >= combatants.length) { turn = 0; round += 1; }
    if (turn < 0) { turn = combatants.length - 1; round = Math.max(1, round - 1); }
    update.mutate({ encounterId: enc.id, body: { turnIndex: turn, round } });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => rollAll.mutate()} className="btn-base btn-wax px-4 py-2 text-[12px]">
          🎲 Roll all initiative
        </button>
        {!active ? (
          <button
            onClick={() => update.mutate({ encounterId: enc.id, body: { status: "active" } })}
            className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]"
          >
            ▶ Trigger encounter
          </button>
        ) : (
          <>
            <div className="chip-hall px-3 py-1.5">
              <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Round</span>
              <span className="font-heading text-sm font-bold text-ember-bright tabular-nums">{enc.round}</span>
            </div>
            <button onClick={() => step(-1)} className="btn-base btn-ghost-ink h-9 px-3 text-[12px]">‹ Prev</button>
            <button onClick={() => step(1)} className="btn-base btn-wax h-9 px-4 text-[12px]">Next turn ›</button>
            <button
              onClick={() => update.mutate({ encounterId: enc.id, body: { status: "ended" } })}
              className="btn-base btn-ghost-red h-9 px-3 text-[12px]"
            >
              End
            </button>
          </>
        )}
      </div>

      <AddCombatant campaignId={campaign.id} encounterId={enc.id} />

      <div className="mt-3 flex flex-col gap-1.5">
        {combatants.length === 0 ? (
          <div className="font-accent py-6 text-center text-[14px] italic text-cream-muted">
            No combatants yet — add monsters, heroes, or a custom line above.
          </div>
        ) : (
          combatants.map((c) => (
            <CombatantRow
              key={c.id}
              c={c}
              active={active && c.current}
              campaignId={campaign.id}
              encounterId={enc.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DMEncounters({ campaign }: { campaign: CampaignContext["campaign"] }) {
  const { data: list } = useEncounters(campaign.id, true);
  const create = useCreateEncounter(campaign.id);
  const del = useDeleteEncounter(campaign.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");

  // Default to whichever is running.
  const activeId = useMemo(() => (list ?? []).find((e) => e.status === "active")?.id ?? null, [list]);
  const selectedId = openId ?? activeId;
  const { data: detail } = useEncounter(selectedId ?? undefined);

  if (selectedId && detail) {
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="label-stamp mb-3 text-[11px] text-gold-muted hover:text-ember-bright">
          ← All encounters
        </button>
        <div className="mb-3 flex items-baseline gap-3">
          <h3 className="font-display m-0 text-[22px] font-black text-[#e7d3a6]">{detail.encounter.name}</h3>
          <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">{detail.encounter.status}</span>
        </div>
        <EncounterRunner campaign={campaign} detail={detail} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { create.mutate(name.trim(), { onSuccess: (enc) => { setName(""); setOpenId(enc.id); } }); } }}
          placeholder="Prepare a new encounter — name it…"
          className="input-hall min-w-0 flex-1"
        />
        <button
          onClick={() => name.trim() && create.mutate(name.trim(), { onSuccess: (enc) => { setName(""); setOpenId(enc.id); } })}
          disabled={!name.trim() || create.isPending}
          className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
        >
          <IconPlus size={14} /> Prepare
        </button>
      </div>

      {(list ?? []).length === 0 ? (
        <div className="font-accent px-5 py-[50px] text-center text-base italic text-[#9c855e]">
          No encounters yet — prepare one above, then trigger it at the table.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(list ?? []).map((e) => (
            <div key={e.id} className="parchment flex items-center justify-between px-4 py-3">
              <button onClick={() => setOpenId(e.id)} className="min-w-0 flex-1 text-left">
                <div className="font-display truncate text-[15px] font-bold text-ink">{e.name}</div>
                <div className="label-stamp mt-0.5 text-[9px] tracking-[1px] text-ink-label">
                  {e.combatantCount} combatant{e.combatantCount === 1 ? "" : "s"} · {e.status}
                </div>
              </button>
              <div className="flex flex-none items-center gap-2">
                {e.status === "active" && (
                  <span className="h-2 w-2 rounded-full bg-[#8fb15f]" style={{ boxShadow: "0 0 8px #8fb15f" }} title="Running" />
                )}
                <button onClick={() => { if (confirm(`Discard "${e.name}"?`)) del.mutate(e.id); }} className="btn-base btn-ghost-red p-1.5" title="Discard">
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Player: the read-only tracker ════════════════════════════════════════ */

function PlayerEncounter({ campaignId }: { campaignId: string }) {
  const { data: detail, isLoading } = useActiveEncounter(campaignId);
  const roll = useRollCombatant(campaignId, detail?.encounter.id ?? "");

  if (isLoading) {
    return <div className="font-accent px-5 py-[50px] text-center text-base italic text-[#9c855e]">Listening for battle…</div>;
  }
  if (!detail) {
    return (
      <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
        No encounter is running. When your DM triggers one, the initiative order appears here.
      </div>
    );
  }
  const enc = detail.encounter;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h3 className="font-display m-0 text-[22px] font-black text-[#e7d3a6]">{enc.name}</h3>
        <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">Round {enc.round}</span>
      </div>
      <div className="flex max-w-[560px] flex-col gap-1.5">
        {detail.combatants.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-[3px] px-3 py-2"
            style={{
              background: c.current ? "rgba(224,169,78,.12)" : "rgba(0,0,0,.14)",
              boxShadow: c.current ? "inset 0 0 0 1px rgba(224,169,78,.5)" : "inset 0 0 0 1px rgba(201,162,39,.16)",
            }}
          >
            <TurnMark active={c.current}>{c.initiative ?? "—"}</TurnMark>
            <span className="font-heading flex-1 truncate text-[13.5px] font-semibold text-cream">
              {c.name}
              {c.isMine && <span className="label-stamp ml-2 text-[8px] tracking-[1px] text-ember-bright">you</span>}
            </span>
            {c.isMine && c.hpCurrent != null ? (
              <span className="font-heading text-[13px] font-bold tabular-nums" style={{ color: HP_STATE_TONE[c.hpState] }}>
                {c.hpCurrent}/{c.hpMax}
              </span>
            ) : (
              <HpStatePill state={c.hpState} />
            )}
            {c.isMine && c.initiative == null && (
              <button onClick={() => roll.mutate(c.id)} className="btn-base btn-wax h-7 px-2.5 text-[10px]">
                🎲 Roll
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EncounterPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div>
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            Encounters
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {role === "dm"
              ? "Prepare battles ahead of time, then trigger them at the table."
              : "The battle at hand — initiative order and whose turn it is."}
          </div>
        </div>
      </div>
      {role === "dm" ? <DMEncounters campaign={campaign} /> : <PlayerEncounter campaignId={campaign.id} />}
    </div>
  );
}
