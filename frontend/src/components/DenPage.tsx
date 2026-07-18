import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ImportReport, RulesContent } from "../api/client";
import { useCreateRules, useImportPack, useRules } from "../hooks";
import { ContentForm, KIND_DEFAULTS } from "./ContentForm";
import ContentEntry from "./ui/ContentEntry";
import ParchmentModal from "./ui/ParchmentModal";
import { IconPlus } from "./ui/icons";
import type { CampaignContext } from "./CampaignView";

/**
 * The Monster Den: the DM's private menagerie. SRD monsters plus the DM's own
 * homebrew and imported packs — never listed in the Archives, never
 * codex-shared, and this page refuses anyone who isn't the DM. Players get
 * their look through the Bestiary, one hard-won reveal at a time.
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

/** How a monster's origin reads: SRD, its source book (carried by a pack), or
 * the DM's own hand-scribed Homebrew. */
function sourceLabel(m: RulesContent): string {
  if (m.source === "srd") return "SRD";
  const book = (m.data as { book?: string }).book;
  return book && book.trim() ? book : "Homebrew";
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
  const importPack = useImportPack();
  const [search, setSearch] = useState("");
  const [band, setBand] = useState(0);
  const [type, setType] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState<SortKey>("cr-asc");
  const [reading, setReading] = useState<RulesContent | null>(null);
  const [scribing, setScribing] = useState(false);
  const [packReport, setPackReport] = useState<ImportReport | null>(null);
  const [packError, setPackError] = useState("");

  // Only offer types that actually stalk this den.
  const typeOptions = useMemo(() => {
    const present = new Set(
      (monsters ?? []).map((m) =>
        baseTypeOf((m.data as { type?: string }).type ?? ""),
      ),
    );
    return BASE_TYPES.filter((t) => present.has(t));
  }, [monsters]);

  // Sources present, SRD first and Homebrew last, books alphabetical between.
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
    const crOf = (m: RulesContent) =>
      (m.data as { crValue?: number }).crValue ?? 0;
    return (monsters ?? [])
      .filter((m) => {
        const d = m.data as { type?: string; crValue?: number };
        if (!inBand(d.crValue ?? 0)) return false;
        if (type && baseTypeOf(d.type ?? "") !== type) return false;
        if (source && sourceLabel(m) !== source) return false;
        if (q && !m.name.toLowerCase().includes(q) && !(d.type ?? "").toLowerCase().includes(q))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        const ca = sort === "cr-desc" ? crOf(b) - crOf(a) : crOf(a) - crOf(b);
        return ca !== 0 ? ca : a.name.localeCompare(b.name);
      });
  }, [monsters, search, band, type, source, sort]);

  function onPackFile(file: File) {
    setPackError("");
    file.text().then((text) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setPackError("That file is not valid JSON.");
        return;
      }
      const entries = (parsed as { entries?: unknown[] })?.entries;
      if (!Array.isArray(entries) || entries.length === 0) {
        setPackError('No entries in that pack — expected { "entries": [...] }.');
        return;
      }
      importPack.mutate(entries, {
        onSuccess: (report) => setPackReport(report),
        onError: (e) =>
          setPackError(
            (e as { error?: string } | null)?.error ?? "The crate would not open.",
          ),
      });
    });
  }

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

  const filtersActive = search || type || source || band !== 0;

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
        <div className="flex flex-wrap items-center gap-3">
          <label className="label-stamp cursor-pointer whitespace-nowrap text-[11px] font-semibold text-gold-muted transition hover:text-ember-bright">
            Import a pack
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPackFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={() => setScribing(true)}
            className="btn-base btn-gold clip-octagon h-10 whitespace-nowrap px-5 text-[13px]"
          >
            <IconPlus size={15} strokeWidth={2} />
            Scribe a Monster
          </button>
        </div>
      </div>

      {packError && (
        <div className="font-body mb-4 text-sm italic text-[#c96a5a]">{packError}</div>
      )}
      {importPack.isPending && (
        <div className="font-accent mb-4 text-sm italic text-cream-muted">
          Unpacking the crate…
        </div>
      )}

      {/* filters — all combinable: search + type + source + CR band + sort */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or type…"
          className="input-hall min-w-0 flex-1 basis-[220px] sm:max-w-[280px]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="input-hall w-[140px]"
        >
          <option value="">All types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {sourceOptions.length > 1 && (
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="input-hall w-[170px]"
          >
            <option value="">All sources</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
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
        {filtersActive && (
          <button
            onClick={() => { setSearch(""); setType(""); setSource(""); setBand(0); }}
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
                </div>
                <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-ink-label">
                  CR {(d.cr ?? "?").split(" ")[0]} · {d.size} {d.type}
                  {m.source !== "srd" && ` · ${sourceLabel(m)}`}
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

      {packReport && (
        <ParchmentModal onClose={() => setPackReport(null)} maxWidth="max-w-[520px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Monster Den
          </div>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
            Pack Unpacked
          </h3>
          <p className="font-body m-0 mb-4 text-center text-[13.5px] italic text-ink-body">
            {packReport.created} scribed anew · {packReport.updated} updated
            {packReport.failed > 0 && ` · ${packReport.failed} refused`}
          </p>
          {packReport.failed > 0 && (
            <div className="mb-4 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
              {packReport.results
                .filter((r) => r.status === "failed")
                .map((r, i) => (
                  <div key={i} className="text-[12.5px]">
                    <span className="font-heading font-bold">{r.name || "(unnamed)"}</span>
                    <span className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-ink-label">
                      {r.kind}
                    </span>
                    <span className="text-[#8b2520]"> — {r.error}</span>
                  </div>
                ))}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={() => setPackReport(null)}
              className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]"
            >
              Done
            </button>
          </div>
        </ParchmentModal>
      )}
    </div>
  );
}
