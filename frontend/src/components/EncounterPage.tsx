import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { Combatant, EncounterDetail, RulesContent } from "../api/client";
import {
  BASE_TYPES,
  baseTypeOf,
  CR_BANDS,
  crLabel,
  crValueOf,
  MONSTER_SORTS,
  sourceLabel,
  type MonsterSort,
} from "../lib/monsters";
import ContentEntry from "./ui/ContentEntry";
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

// Button intents on the DARK encounter page. The design system's btn-ghost-*
// classes are for parchment (dark ink text) — on dark they look disabled, so we
// set explicit light-on-dark styles. The scheme, applied consistently:
//   gold  = confirm/create (Prepare, Add, Trigger)
//   wax   = the live-combat verbs (Roll, Next turn)
//   NEUTRAL = secondary (Prev, back)   RED = destructive   GREEN = heal
const NEUTRAL_BTN = { color: "#e6d2a0", background: "rgba(201,162,39,.08)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.32)" };
const RED_BTN = { color: "#d68a72", background: "rgba(139,37,32,.14)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" };
const GREEN_BTN = { color: "#8fb15f", background: "rgba(77,107,57,.14)", boxShadow: "inset 0 0 0 1px rgba(77,107,57,.5)" };

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
      {/* initiative — type it, or roll the die */}
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

      <button onClick={() => del.mutate(c.id)} title="Remove from encounter" className="btn-base flex-none p-1.5" style={RED_BTN}>
        <IconTrash size={12} />
      </button>
    </div>
  );
}

/* Type-to-search monster picker — the Den holds hundreds, a dropdown won't do. */
function MonsterSearch({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const add = useAddCombatant(campaignId, encounterId);
  const { data: monsters } = useRules("monster");
  const [q, setQ] = useState("");
  const [count, setCount] = useState("1");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return (monsters ?? []).filter((m) => m.name.toLowerCase().includes(term)).slice(0, 8);
  }, [q, monsters]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function addMonster(id: string, name: string) {
    const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 12);
    for (let i = 0; i < n; i++) add.mutate({ kind: "monster", contentId: id, hidden: true });
    setQ(name);
    setOpen(false);
  }

  return (
    <>
      <div ref={boxRef} className="relative min-w-[180px] flex-1">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search monsters by name…"
          className="input-hall h-9 w-full text-[12px]"
        />
        {open && matches.length > 0 && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[240px] overflow-y-auto rounded-[4px] py-1"
            style={{ background: "#1c1108", boxShadow: "0 12px 30px rgba(0,0,0,.6), inset 0 0 0 1px rgba(201,162,39,.35)" }}
          >
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => addMonster(m.id, m.name)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] text-cream-soft transition hover:bg-[rgba(201,162,39,.14)]"
              >
                <span className="font-heading">{m.name}</span>
                {m.source !== "srd" && <span className="label-stamp text-[8px] tracking-[1px] text-gold-muted">{(m.data as { book?: string })?.book ?? "homebrew"}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} title="How many to add" className="input-hall h-9 w-12 text-center text-[12px]" />
      <span className="label-stamp text-[9px] tracking-[1px] text-gold-muted">added hidden</span>
    </>
  );
}

/* ═══ The Den browser — the DM's monster picker while building ═════════════
   A filterable, sortable table of every creature in the Den; each row unfolds
   to its full stat card so the DM can read a monster before committing it to
   the fight. Monsters join hidden — revealed in the tracker when players spot
   them. */
function MonsterBrowser({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const { data: monsters } = useRules("monster");
  const add = useAddCombatant(campaignId, encounterId);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [band, setBand] = useState(0);
  const [source, setSource] = useState("");
  const [sort, setSort] = useState<MonsterSort>("cr-asc");

  const typeOptions = useMemo(() => {
    const present = new Set((monsters ?? []).map((m) => baseTypeOf((m.data as { type?: string }).type ?? "")));
    return BASE_TYPES.filter((t) => present.has(t));
  }, [monsters]);

  const sourceOptions = useMemo(() => {
    const present = new Set((monsters ?? []).map(sourceLabel));
    return [...present].sort((a, b) => {
      if (a === "SRD") return -1;
      if (b === "SRD") return 1;
      if (a === "Homebrew") return 1;
      if (b === "Homebrew") return -1;
      return a.localeCompare(b);
    });
  }, [monsters]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inBand = CR_BANDS[band][1];
    return (monsters ?? [])
      .filter((m) => {
        const d = m.data as { type?: string; crValue?: number };
        if (!inBand(d.crValue ?? 0)) return false;
        if (type && baseTypeOf(d.type ?? "") !== type) return false;
        if (source && sourceLabel(m) !== source) return false;
        if (q && !m.name.toLowerCase().includes(q) && !(d.type ?? "").toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        const d = sort === "cr-desc" ? crValueOf(b) - crValueOf(a) : crValueOf(a) - crValueOf(b);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      });
  }, [monsters, search, type, band, source, sort]);

  return (
    <div>
      <div className="label-stamp mb-2 text-[11px] tracking-[3px] text-gold-muted">The Den</div>
      <div className="mb-2 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search monsters…"
          className="input-hall h-9 min-w-[140px] flex-1 text-[12px]"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className="input-hall h-9 text-[12px]">
          <option value="">Any type</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={band} onChange={(e) => setBand(Number(e.target.value))} className="input-hall h-9 text-[12px]">
          {CR_BANDS.map(([label], i) => <option key={label} value={i}>{label}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="input-hall h-9 text-[12px]">
          <option value="">Any source</option>
          {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as MonsterSort)} className="input-hall h-9 text-[12px]">
          {MONSTER_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <div className="label-stamp mb-2 text-[9px] leading-tight tracking-[1.5px] text-gold-muted">
        {filtered.length} of {monsters?.length ?? 0} creatures · they join hidden, reveal them at the table
      </div>
      <div className="flex max-h-[560px] flex-col gap-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="font-accent py-8 text-center text-[13px] italic text-cream-muted">Nothing answers that call.</div>
        ) : (
          filtered.map((m) => <MonsterRow key={m.id} m={m} add={add} />)
        )}
      </div>
    </div>
  );
}

function MonsterRow({ m, add }: { m: RulesContent; add: ReturnType<typeof useAddCombatant> }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("1");
  const d = m.data as { type?: string; size?: string };

  function addIt() {
    const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 12);
    for (let i = 0; i < n; i++) add.mutate({ kind: "monster", contentId: m.id, hidden: true });
  }

  return (
    <div className="rounded-[3px]" style={{ background: "rgba(0,0,0,.14)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.16)" }}>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1.5 sm:grid-cols-[auto_1fr_6rem_3.5rem_3.5rem_auto]">
        <button
          onClick={() => setOpen((v) => !v)}
          title={open ? "Hide stat block" : "Read stat block"}
          className="flex h-6 w-6 flex-none items-center justify-center text-[11px] text-gold-muted transition hover:text-ember-bright"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          ▶
        </button>
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 text-left">
          <span className="font-heading truncate text-[13px] font-semibold text-cream">{m.name}</span>
          {m.source !== "srd" && <span className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-gold-muted">{sourceLabel(m)}</span>}
          <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-gold-muted sm:hidden">
            {baseTypeOf(d.type ?? "?")} · {d.size ?? "?"} · CR {crLabel(m)}
          </div>
        </button>
        <span className="hidden truncate text-[11px] text-cream-muted sm:block">{baseTypeOf(d.type ?? "?")}</span>
        <span className="hidden text-[11px] text-cream-muted sm:block">{d.size ?? "—"}</span>
        <span className="hidden font-heading text-[10.5px] text-gold-muted sm:block">CR {crLabel(m)}</span>
        <div className="flex flex-none items-center gap-1">
          <input
            value={count}
            onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
            title="How many to add"
            className="input-hall h-8 w-9 text-center text-[12px]"
          />
          <button onClick={addIt} disabled={add.isPending} className="btn-base btn-gold clip-octagon h-8 px-2.5 text-[11px]">
            <IconPlus size={12} /> Add
          </button>
        </div>
      </div>
      {open && (
        <div className="parchment mx-2 mb-2 px-4 py-3">
          <ContentEntry entry={m} />
        </div>
      )}
    </div>
  );
}

function AddCombatant({ campaignId, encounterId, monster = true }: { campaignId: string; encounterId: string; monster?: boolean }) {
  const add = useAddCombatant(campaignId, encounterId);
  const { data: chars } = useCharacters(campaignId);
  const [kind, setKind] = useState<"monster" | "pc" | "custom">(monster ? "monster" : "pc");
  const [pcPick, setPcPick] = useState("");
  const [custom, setCustom] = useState({ label: "", hpMax: "", ac: "", initMod: "" });

  function addIt() {
    if (kind === "pc" && pcPick) {
      add.mutate({ kind: "pc", characterId: pcPick });
      setPcPick("");
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
  }

  return (
    <div className="chip-hall flex flex-wrap items-center gap-2 px-3 py-2.5">
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="input-hall h-9 w-28 text-[12px]">
        {monster && <option value="monster">Monster</option>}
        <option value="pc">Party</option>
        <option value="custom">Custom</option>
      </select>

      {monster && kind === "monster" && <MonsterSearch campaignId={campaignId} encounterId={encounterId} />}
      {kind === "pc" && (
        <>
          <select value={pcPick} onChange={(e) => setPcPick(e.target.value)} className="input-hall h-9 min-w-[160px] flex-1 text-[12px]">
            <option value="">Choose a hero…</option>
            {(chars ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={addIt} disabled={!pcPick || add.isPending} className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]">
            <IconPlus size={13} /> Add
          </button>
        </>
      )}
      {kind === "custom" && (
        <>
          <input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="Name" className="input-hall h-9 min-w-[120px] flex-1 text-[12px]" />
          <input value={custom.hpMax} onChange={(e) => setCustom({ ...custom, hpMax: e.target.value.replace(/\D/g, "") })} placeholder="HP" className="input-hall h-9 w-14 text-center text-[12px]" />
          <input value={custom.ac} onChange={(e) => setCustom({ ...custom, ac: e.target.value.replace(/\D/g, "") })} placeholder="AC" className="input-hall h-9 w-14 text-center text-[12px]" />
          <input value={custom.initMod} onChange={(e) => setCustom({ ...custom, initMod: e.target.value.replace(/[^\d-]/g, "") })} placeholder="+init" className="input-hall h-9 w-14 text-center text-[12px]" />
          <button onClick={addIt} disabled={!custom.label.trim() || add.isPending} className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]">
            <IconPlus size={13} /> Add
          </button>
        </>
      )}
    </div>
  );
}

function EncounterRunner({ campaign, detail }: { campaign: CampaignContext["campaign"]; detail: EncounterDetail }) {
  // Two lives: while it's building, the D&D-Beyond-style two-pane builder;
  // once triggered, the full-width initiative tracker.
  return detail.encounter.status === "active" ? (
    <ActiveTracker campaign={campaign} detail={detail} />
  ) : (
    <BuildLayout campaign={campaign} detail={detail} />
  );
}

/* The running fight — round counter, turn stepper, and the live combatant list. */
function ActiveTracker({ campaign, detail }: { campaign: CampaignContext["campaign"]; detail: EncounterDetail }) {
  const enc = detail.encounter;
  const combatants = detail.combatants;
  const update = useUpdateEncounter(campaign.id);
  const rollAll = useRollInitiative(campaign.id, enc.id);

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
        <button onClick={() => rollAll.mutate()} className="btn-base btn-wax h-9 px-4 text-[12px]">
          🎲 Roll all initiative
        </button>
        <div className="chip-hall px-3 py-1.5">
          <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">Round</span>
          <span className="font-heading text-sm font-bold text-ember-bright tabular-nums">{enc.round}</span>
        </div>
        <button
          onClick={() => step(-1)}
          disabled={enc.round === 1 && enc.turnIndex === 0}
          title="Previous turn"
          className="btn-base h-9 px-3 text-[12px] disabled:opacity-40"
          style={NEUTRAL_BTN}
        >
          ‹ Prev
        </button>
        <button onClick={() => step(1)} className="btn-base btn-wax h-9 px-4 text-[12px]">Next turn ›</button>
        <button
          onClick={() => update.mutate({ encounterId: enc.id, body: { status: "ended" } })}
          title="End the encounter"
          className="btn-base h-9 px-3 text-[12px]"
          style={RED_BTN}
        >
          End
        </button>
      </div>

      <AddCombatant campaignId={campaign.id} encounterId={enc.id} />

      <div className="mt-3 flex flex-col gap-1.5">
        {combatants.map((c) => (
          <CombatantRow
            key={c.id}
            c={c}
            active={c.current}
            campaignId={campaign.id}
            encounterId={enc.id}
          />
        ))}
      </div>
    </div>
  );
}

/* Building an encounter: the Den on the left to browse and add, the fight
   being assembled on the right, ready to trigger. Stacks on a phone. */
function BuildLayout({ campaign, detail }: { campaign: CampaignContext["campaign"]; detail: EncounterDetail }) {
  const enc = detail.encounter;
  const combatants = detail.combatants;
  const update = useUpdateEncounter(campaign.id);
  const rollAll = useRollInitiative(campaign.id, enc.id);
  const canTrigger = combatants.length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      {/* LEFT — the Den */}
      <div
        className="rounded-[4px] p-3"
        style={{ background: "rgba(0,0,0,.1)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.14)" }}
      >
        <MonsterBrowser campaignId={campaign.id} encounterId={enc.id} />
      </div>

      {/* RIGHT — the fight taking shape */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <div className="label-stamp text-[11px] tracking-[3px] text-gold-muted">In this encounter</div>
          <div className="label-stamp text-[9px] tracking-[1px] text-gold-muted">
            {combatants.length} joined
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            onClick={() => rollAll.mutate()}
            disabled={!canTrigger}
            title="Roll d20 + modifier for everyone"
            className="btn-base btn-wax h-9 px-3 text-[12px] disabled:opacity-40"
          >
            🎲 Roll all
          </button>
          <button
            onClick={() => update.mutate({ encounterId: enc.id, body: { status: "active" } })}
            disabled={!canTrigger}
            title={canTrigger ? "Begin the fight" : "Add someone to the fight first"}
            className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px] disabled:opacity-40"
          >
            ▶ Trigger
          </button>
        </div>

        <AddCombatant campaignId={campaign.id} encounterId={enc.id} monster={false} />

        <div className="mt-3 flex flex-col gap-1.5">
          {combatants.length === 0 ? (
            <div className="font-accent py-6 text-center text-[13px] italic text-cream-muted">
              Empty so far — pick monsters from the Den, or add your party.
            </div>
          ) : (
            combatants.map((c) => (
              <CombatantRow key={c.id} c={c} active={false} campaignId={campaign.id} encounterId={enc.id} />
            ))
          )}
        </div>
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
