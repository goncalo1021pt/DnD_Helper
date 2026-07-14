import { useMemo, useState } from "react";
import type { RulesContent } from "../api/client";
import { useCreateRules, useRules } from "../hooks";
import SpellEntry, { SpellFlags } from "./ui/SpellEntry";
import ParchmentModal from "./ui/ParchmentModal";
import { ContentForm, KIND_DEFAULTS } from "./ScribesDesk";
import { IconPlus } from "./ui/icons";

/**
 * The Spellbook: every spell you can see (SRD + your homebrew + what your
 * campaigns admitted), searchable and readable in full.
 */

const CASTERS = ["Bard", "Cleric", "Druid", "Paladin", "Ranger", "Sorcerer", "Warlock", "Wizard"];

export default function SpellbookPage() {
  const { data: spells, isLoading } = useRules("spell");
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<string>("");
  const [klass, setKlass] = useState<string>("");
  const [reading, setReading] = useState<RulesContent | null>(null);
  const [scribing, setScribing] = useState(false);
  const create = useCreateRules("spell");
  const { data: classes } = useRules("class");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (spells ?? []).filter((s) => {
      const d = s.data as { level?: number; classes?: string[]; school?: string };
      if (level !== "" && String(d.level ?? "") !== level) return false;
      if (klass && !(d.classes ?? []).includes(klass)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !(d.school ?? "").toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [spells, search, level, klass]);

  const byLevel = useMemo(() => {
    const groups = new Map<number, RulesContent[]>();
    for (const s of filtered) {
      const lvl = ((s.data as { level?: number }).level ?? 0) as number;
      groups.set(lvl, [...(groups.get(lvl) ?? []), s]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

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
            The Spellbook
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {spells ? `${spells.length} spells on the shelves — SRD 5.2 and your table's own.` : ""}
          </div>
        </div>
        <button
          onClick={() => setScribing(true)}
          className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
        >
          <IconPlus size={15} strokeWidth={2} />
          Scribe a Spell
        </button>
      </div>

      {/* filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or school…"
          className="input-hall min-w-0 flex-1 sm:max-w-[300px]"
        />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="input-hall w-36"
        >
          <option value="">Any level</option>
          <option value="0">Cantrips</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
            <option key={l} value={l}>Level {l}</option>
          ))}
        </select>
        <select
          value={klass}
          onChange={(e) => setKlass(e.target.value)}
          className="input-hall w-40"
        >
          <option value="">Any class</option>
          {CASTERS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Dusting off the tomes…
        </div>
      ) : filtered.length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          No spell answers that call.
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {byLevel.map(([lvl, list]) => (
            <section key={lvl}>
              <div className="label-stamp mb-2.5 text-[10px] tracking-[2.5px] text-gold-muted">
                {lvl === 0 ? "Cantrips" : `Level ${lvl}`} · {list.length}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(270px,100%),1fr))] gap-3">
                {list.map((s) => {
                  const d = s.data as { school?: string };
                  return (
                    <button
                      key={s.id}
                      onClick={() => setReading(s)}
                      className="parchment cursor-pointer px-4 pb-3 pt-2.5 text-left transition hover:-translate-y-0.5"
                    >
                      <div className="font-display text-[14.5px] font-bold leading-tight text-ink">
                        {s.name}
                        <SpellFlags spell={s} />
                        {s.source === "homebrew" && (
                          <span className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-ink-label">
                            Homebrew
                          </span>
                        )}
                      </div>
                      <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-ink-label">
                        {d.school}
                      </div>
                      <p className="font-body m-0 mt-1 text-[12px] italic leading-snug text-ink-body">
                        {s.summary}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {reading && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[560px]">
          <SpellEntry spell={reading} />
        </ParchmentModal>
      )}

      {scribing && (
        <ParchmentModal onClose={() => setScribing(false)} maxWidth="max-w-[620px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Spellbook
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Scribe a Spell
          </h3>
          <ContentForm
            kind="spell"
            initial={{ name: "", summary: "", data: { ...KIND_DEFAULTS.spell } }}
            isPending={create.isPending}
            errorText={
              create.isError
                ? ((create.error as { error?: string } | null)?.error ??
                  "The quill snapped — check the fields.")
                : undefined
            }
            classNames={(classes ?? []).map((c) => c.name)}
            onSubmit={(body) =>
              create.mutate(body, { onSuccess: () => setScribing(false) })
            }
            onCancel={() => setScribing(false)}
          />
        </ParchmentModal>
      )}
    </div>
  );
}
