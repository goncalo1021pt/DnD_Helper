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

export default function DenPage() {
  const { role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: monsters, isLoading } = useRules("monster", isDM);
  const create = useCreateRules("monster");
  const [search, setSearch] = useState("");
  const [band, setBand] = useState(0);
  const [reading, setReading] = useState<RulesContent | null>(null);
  const [scribing, setScribing] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inBand = CR_BANDS[band][1];
    return (monsters ?? [])
      .filter((m) => {
        const d = m.data as { type?: string; crValue?: number };
        if (!inBand(d.crValue ?? 0)) return false;
        if (q && !m.name.toLowerCase().includes(q) && !(d.type ?? "").toLowerCase().includes(q))
          return false;
        return true;
      })
      .sort((a, b) => {
        const ca = ((a.data as { crValue?: number }).crValue ?? 0) -
          ((b.data as { crValue?: number }).crValue ?? 0);
        return ca !== 0 ? ca : a.name.localeCompare(b.name);
      });
  }, [monsters, search, band]);

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

      {/* filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or type…"
          className="input-hall min-w-0 flex-1 sm:max-w-[300px]"
        />
        <select
          value={band}
          onChange={(e) => setBand(Number(e.target.value))}
          className="input-hall w-36"
        >
          {CR_BANDS.map(([label], i) => (
            <option key={label} value={i}>{label}</option>
          ))}
        </select>
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
