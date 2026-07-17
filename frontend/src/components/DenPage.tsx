import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { RulesContent } from "../api/client";
import { useCreateRules, useRules } from "../hooks";
import { ContentForm, KIND_DEFAULTS } from "./ContentForm";
import ContentEntry from "./ui/ContentEntry";
import ParchmentModal from "./ui/ParchmentModal";
import { IconPlus } from "./ui/icons";
import type { CampaignContext } from "./CampaignView";

/**
 * The Monster Den: the DM's private menagerie. SRD monsters plus the DM's own
 * homebrew — never listed in the Archives, never codex-shared, and this page
 * refuses anyone who isn't the DM. Players get their look through the
 * Bestiary, one hard-won reveal at a time.
 */

const CR_BANDS: Array<[string, (v: number) => boolean]> = [
  ["Any CR", () => true],
  ["CR 0–1", (v) => v <= 1],
  ["CR 2–4", (v) => v >= 2 && v <= 4],
  ["CR 5–10", (v) => v >= 5 && v <= 10],
  ["CR 11–16", (v) => v >= 11 && v <= 16],
  ["CR 17+", (v) => v >= 17],
];

/** The 14 creature types of the 2024 rules, for the type filter. */
const BASE_TYPES = [
  "Aberration", "Beast", "Celestial", "Construct", "Dragon", "Elemental",
  "Fey", "Fiend", "Giant", "Humanoid", "Monstrosity", "Ooze", "Plant",
  "Undead",
];

/** "Swarm of Tiny Beasts" → Beast, "Fiend (Demon)" → Fiend, "Swarm of Tiny
 * Monstrosities" → Monstrosity (y→ies plural). */
function baseTypeOf(type: string): string {
  for (const t of BASE_TYPES) {
    const plural = t.endsWith("y") ? t.slice(0, -1) + "ies" : t + "s";
    if (type.includes(t) || type.includes(plural)) return t;
  }
  return type;
}

type SortKey = "cr-asc" | "cr-desc" | "name";

const SORTS: Array<[SortKey, string]> = [
  ["cr-asc", "CR: low → high"],
  ["cr-desc", "CR: high → low"],
  ["name", "Name: A → Z"],
];

export default function DenPage() {
  const { role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: monsters, isLoading } = useRules("monster", isDM);
  const create = useCreateRules("monster");
  const [search, setSearch] = useState("");
  const [band, setBand] = useState(0);
  const [type, setType] = useState("");
  const [sort, setSort] = useState<SortKey>("cr-asc");
  const [reading, setReading] = useState<RulesContent | null>(null);
  const [scribing, setScribing] = useState(false);

  // Only offer types that actually stalk this den.
  const typeOptions = useMemo(() => {
    const present = new Set(
      (monsters ?? []).map((m) =>
        baseTypeOf((m.data as { type?: string }).type ?? ""),
      ),
    );
    return BASE_TYPES.filter((t) => present.has(t));
  }, [monsters]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inBand = CR_BANDS[band][1];
    const crOf = (m: RulesContent) =>
      (m.data as { crValue?: number }).crValue ?? 0;
    return (monsters ?? [])
      .filter((m) => {
        const d = m.data as { type?: string; crValue?: number };
        if (!inBand(d.crValue ?? 0)) return false;
        if (type && baseTypeOf(d.type ?? "") !== type) return false;
        if (q && !m.name.toLowerCase().includes(q) && !(d.type ?? "").toLowerCase().includes(q))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        const ca = sort === "cr-desc" ? crOf(b) - crOf(a) : crOf(a) - crOf(b);
        return ca !== 0 ? ca : a.name.localeCompare(b.name);
      });
  }, [monsters, search, band, type, sort]);

  if (!isDM) {
    return (
      <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          The Den is the DM's alone — what stalks these pages, your heroes must
          discover at the table.
        </div>
      </div>
    );
  }

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
            The Monster Den
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {monsters
              ? `${monsters.length} creatures in the dark — yours alone to see.`
              : "Yours alone to see."}
          </div>
        </div>
        <button
          onClick={() => setScribing(true)}
          className="btn-base btn-gold clip-octagon h-10 whitespace-nowrap px-5 text-[13px]"
        >
          <IconPlus size={15} strokeWidth={2} />
          Scribe a Monster
        </button>
      </div>

      {/* filters — all combinable: search + type + CR band + sort */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or type…"
          className="input-hall min-w-0 flex-1 basis-[220px] sm:max-w-[300px]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="input-hall w-[150px]"
        >
          <option value="">All types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={band}
          onChange={(e) => setBand(Number(e.target.value))}
          className="input-hall w-[120px]"
        >
          {CR_BANDS.map(([label], i) => (
            <option key={label} value={i}>{label}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="input-hall w-[160px]"
        >
          {SORTS.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>
      <div className="label-stamp mb-4 text-[10px] tracking-[1.5px] text-gold-muted">
        {filtered.length} of {monsters?.length ?? 0} creatures
        {(search || type || band !== 0) && (
          <button
            onClick={() => { setSearch(""); setType(""); setBand(0); }}
            className="ml-2 cursor-pointer border-none bg-transparent p-0 text-[10px] tracking-[1.5px] text-ember-bright underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Listening at the cave mouth…
        </div>
      ) : filtered.length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Nothing answers that call.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(270px,100%),1fr))] gap-3">
          {filtered.map((m) => {
            const d = m.data as { cr?: string; size?: string; type?: string };
            return (
              <button
                key={m.id}
                onClick={() => setReading(m)}
                className="parchment cursor-pointer px-4 pb-3 pt-2.5 text-left transition hover:-translate-y-0.5"
              >
                <div className="font-display text-[14.5px] font-bold leading-tight text-ink">
                  {m.name}
                  {m.source === "homebrew" && (
                    <span className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-ink-label">
                      Homebrew
                    </span>
                  )}
                </div>
                <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-ink-label">
                  CR {(d.cr ?? "?").split(" ")[0]} · {d.size} {d.type}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {reading && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[600px]">
          <ContentEntry entry={reading} />
        </ParchmentModal>
      )}

      {scribing && (
        <ParchmentModal onClose={() => setScribing(false)} maxWidth="max-w-[620px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Monster Den
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Scribe a Monster
          </h3>
          <ContentForm
            kind="monster"
            initial={{ name: "", summary: "", data: { ...KIND_DEFAULTS.monster } }}
            isPending={create.isPending}
            errorText={
              create.isError
                ? ((create.error as { error?: string } | null)?.error ??
                  "The quill snapped — check the fields.")
                : undefined
            }
            classNames={[]}
            onSubmit={(body) => create.mutate(body, { onSuccess: () => setScribing(false) })}
            onCancel={() => setScribing(false)}
          />
        </ParchmentModal>
      )}
    </div>
  );
}
