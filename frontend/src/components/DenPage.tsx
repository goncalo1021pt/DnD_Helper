import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ImportReport, RulesContent } from "../api/client";
import PackWarnings from "./ui/PackWarnings";
import { useCreateRules, useDeleteRules, useImportPack, useRules, useUpdateRules } from "../hooks";
import { ContentForm, KIND_DEFAULTS } from "./ContentForm";
import type { DataObj } from "./content/constants";
import ContentEntry from "./ui/ContentEntry";
import ParchmentModal from "./ui/ParchmentModal";
import { IconCopy, IconPencil, IconPlus, IconTrash } from "./ui/icons";
import type { CampaignContext } from "./CampaignView";
import {
  BASE_TYPES,
  baseTypeOf,
  CR_BANDS,
  MONSTER_SORTS,
  type MonsterSort,
} from "../lib/monsters";
import { copyOf, sourceLabel, sourceOptions } from "../lib/content";
import { parsePackFile } from "../lib/pack";

/**
 * The Monster Den: the DM's private menagerie. SRD monsters plus the DM's own
 * homebrew and imported packs — never listed in the Archives, never
 * codex-shared, and this page refuses anyone who isn't the DM. Players get
 * their look through the Bestiary, one hard-won reveal at a time.
 */

export default function DenPage() {
  const { role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: monsters, isLoading } = useRules("monster", isDM);
  const create = useCreateRules("monster");
  const update = useUpdateRules("monster");
  const del = useDeleteRules("monster");
  const importPack = useImportPack();
  const [search, setSearch] = useState("");
  const [band, setBand] = useState(0);
  const [type, setType] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState<MonsterSort>("cr-asc");
  const [reading, setReading] = useState<RulesContent | null>(null);
  // The scribe modal takes a seed rather than a boolean, because "Scribe" and
  // "Copy" are the same form over different starting positions (#127).
  const [scribing, setScribing] = useState<{
    seed: { name: string; summary: string; data: DataObj };
    copiedFrom?: string;
  } | null>(null);
  const [editing, setEditing] = useState<RulesContent | null>(null);
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
  const sources = useMemo(() => sourceOptions(monsters), [monsters]);

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

  async function onPackFile(file: File) {
    setPackError("");
    const parsed = await parsePackFile(file);
    if ("error" in parsed) {
      setPackError(parsed.error);
      return;
    }
    importPack.mutate(parsed, {
      onSuccess: (report) => setPackReport(report),
      onError: (e) =>
        setPackError(
          (e as { error?: string } | null)?.error ?? "The crate would not open.",
        ),
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
            onClick={() =>
              setScribing({ seed: { name: "", summary: "", data: { ...KIND_DEFAULTS.monster } } })
            }
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
        {sources.length > 1 && (
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="input-hall w-[170px]"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
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
          onChange={(e) => setSort(e.target.value as MonsterSort)}
          className="input-hall w-[160px]"
        >
          {MONSTER_SORTS.map(([key, label]) => (
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
          {/* Copy is offered on ANY creature, the SRD's included — that is the
              point of it: a Goblin Warrior is the fastest way to start writing
              a Goblin Chieftain (#127). Amending and striking stay yours. */}
          <div
            className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t pt-3"
            style={{ borderColor: "rgba(90,60,20,.25)" }}
          >
            <button
              onClick={() => {
                setScribing({
                  seed: copyOf(reading, (monsters ?? []).map((m) => m.name)),
                  copiedFrom: reading.name,
                });
                setReading(null);
              }}
              title={`Start a new creature of your own from ${reading.name}`}
              className="btn-base btn-ghost-ink px-4 py-2 text-[11px]"
            >
              <IconCopy size={13} strokeWidth={1.8} />
              Copy
            </button>
            {reading.mine && (
              <>
                <button
                  onClick={() => {
                    setEditing(reading);
                    setReading(null);
                  }}
                  className="btn-base btn-ghost-ink px-4 py-2 text-[11px]"
                >
                  <IconPencil size={13} strokeWidth={1.8} />
                  Amend
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Loose "${reading.name}" from the Den?`)) {
                      del.mutate(reading.id);
                      setReading(null);
                    }
                  }}
                  className="btn-base btn-ghost-red px-4 py-2 text-[11px]"
                >
                  <IconTrash size={13} strokeWidth={1.8} />
                  Strike
                </button>
              </>
            )}
          </div>
        </ParchmentModal>
      )}

      {editing && (
        <ParchmentModal onClose={() => setEditing(null)} maxWidth="max-w-[620px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Monster Den
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Amend {editing.name}
          </h3>
          <ContentForm
            kind="monster"
            initial={{
              name: editing.name,
              summary: editing.summary,
              data: (editing.data ?? {}) as DataObj,
            }}
            isPending={update.isPending}
            errorText={
              update.isError
                ? ((update.error as { error?: string } | null)?.error ??
                  "The quill snapped — check the fields.")
                : undefined
            }
            classNames={[]}
            onSubmit={(body) =>
              update.mutate(
                { contentId: editing.id, body },
                { onSuccess: () => setEditing(null) },
              )
            }
            onCancel={() => setEditing(null)}
          />
        </ParchmentModal>
      )}

      {scribing && (
        <ParchmentModal onClose={() => setScribing(null)} maxWidth="max-w-[620px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Monster Den
          </div>
          <h3 className="font-display m-0 mb-1 text-center text-2xl font-bold text-ink">
            {scribing.copiedFrom ? "Copy a Monster" : "Scribe a Monster"}
          </h3>
          {scribing.copiedFrom && (
            <p className="font-body m-0 mb-4 text-center text-[12.5px] italic text-ink-body">
              After {scribing.copiedFrom}. Change anything — it is yours once scribed.
            </p>
          )}
          <ContentForm
            kind="monster"
            initial={scribing.seed}
            isPending={create.isPending}
            errorText={
              create.isError
                ? ((create.error as { error?: string } | null)?.error ??
                  "The quill snapped — check the fields.")
                : undefined
            }
            classNames={[]}
            onSubmit={(body) => create.mutate(body, { onSuccess: () => setScribing(null) })}
            onCancel={() => setScribing(null)}
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
          <PackWarnings report={packReport} />
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
