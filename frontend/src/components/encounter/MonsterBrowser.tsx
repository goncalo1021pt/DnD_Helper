
import { useMemo, useState } from "react";
import type { RulesContent } from "../../api/client";
import {
  BASE_TYPES,
  baseTypeOf,
  CR_BANDS,
  crLabel,
  crValueOf,
  MONSTER_SORTS,
  type MonsterSort,
} from "../../lib/monsters";
import { sourceLabel } from "../../lib/content";
import { useAddCombatant, useRules } from "../../hooks";
import ContentEntry from "../ui/ContentEntry";
import { IconPlus } from "../ui/icons";
import { QtyStepper } from "./QtyStepper";

/* ═══ The Den browser — the DM's monster picker while building ═════════════
   A filterable, sortable table of every creature in the Den; each row unfolds
   to its full stat card so the DM can read a monster before committing it to
   the fight. Monsters join hidden — revealed in the tracker when players spot
   them. */
export function MonsterBrowser({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
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

export function MonsterRow({ m, add }: { m: RulesContent; add: ReturnType<typeof useAddCombatant> }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const d = m.data as { type?: string; size?: string };

  // Count > 1 arrives as one mob; add singly if you want independent monsters.
  function addIt() {
    add.mutate({ kind: "monster", contentId: m.id, hidden: true, count });
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
        <div className="flex flex-none items-center gap-1.5">
          <QtyStepper value={count} onChange={setCount} />
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
