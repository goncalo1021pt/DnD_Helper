import { useMemo, useState } from "react";
import type { ImportReport, RulesContent, RulesKind } from "../api/client";
import {
  useCreateRules,
  useDeleteRules,
  useImportPack,
  useRules,
  useUpdateRules,
} from "../hooks";
import ParchmentModal from "./ui/ParchmentModal";
import ContentEntry, { FEAT_CATEGORY_LABEL } from "./ui/ContentEntry";
import { SpellFlags } from "./ui/SpellEntry";
import { ContentForm, KIND_DEFAULTS } from "./ContentForm";
import { IconPencil, IconPlus, IconTrash } from "./ui/icons";

/**
 * The Archives: the whole rules library on one page — every kind on its own
 * shelf, searchable and readable in full. Scribing (create, amend, strike,
 * packs) is a feature of the shelves, not a separate desk.
 */

const SHELVES: Array<[RulesKind, string, string]> = [
  ["spell", "Spells", "Spell"],
  ["class", "Classes", "Class"],
  ["subclass", "Subclasses", "Subclass"],
  ["species", "Species", "Species"],
  ["background", "Backgrounds", "Background"],
  ["feat", "Feats", "Feat"],
  ["item", "Items", "Item"],
];

const FEAT_ORDER = ["origin", "general", "fighting-style", "invocation", "metamagic", "epic-boon"];
const ITEM_ORDER = ["armor", "shield", "weapon", "gear"];
const ITEM_LABEL: Record<string, string> = {
  armor: "Armor",
  shield: "Shields",
  weapon: "Weapons",
  gear: "Gear",
};

type DataObj = Record<string, unknown>;

/** One line under the card's name — the kind's vital facts. */
function cardTagline(kind: RulesKind, e: RulesContent): string {
  const d = e.data as DataObj;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as string[]) : []);
  const parts: string[] = [];
  switch (kind) {
    case "spell":
      parts.push(str("school"));
      break;
    case "class":
      if (d.hitDie) parts.push(`d${d.hitDie as number}`);
      if (arr("primaryAbility").length) parts.push(arr("primaryAbility").join("/"));
      if (arr("saves").length) parts.push(`saves ${arr("saves").join("/")}`);
      break;
    case "subclass":
      parts.push(str("class") || "—");
      break;
    case "species":
      if (str("size")) parts.push(str("size"));
      if (d.speed) parts.push(`${d.speed as number} ft`);
      break;
    case "background":
      if (arr("abilityScores").length) parts.push(arr("abilityScores").join("/"));
      if (str("feat")) parts.push(str("feat"));
      break;
    case "feat":
      parts.push(FEAT_CATEGORY_LABEL[str("category")] ?? "General");
      if (str("prerequisite")) parts.push(str("prerequisite"));
      break;
    case "item":
      if (str("type") === "armor") parts.push(`${str("category")} armor · AC ${d.ac as number}`);
      else if (str("type") === "shield") parts.push(`Shield · +${(d.acBonus as number) ?? 2} AC`);
      else if (str("type") === "weapon")
        parts.push(`${str("category")} · ${str("damage")} ${str("damageType")}`);
      else parts.push("Gear");
      break;
  }
  if (str("book")) parts.push(str("book"));
  return parts.filter(Boolean).join(" · ");
}

export default function ArchivesPage() {
  const [kind, setKind] = useState<RulesKind>("spell");
  const { data: entries, isLoading } = useRules(kind);
  const { data: classes } = useRules("class");
  const create = useCreateRules(kind);
  const update = useUpdateRules(kind);
  const del = useDeleteRules(kind);
  const importPack = useImportPack();

  const [search, setSearch] = useState("");
  const [chip, setChip] = useState(""); // subclass: class · feat: category · item: type
  const [spellLevel, setSpellLevel] = useState("");
  const [reading, setReading] = useState<RulesContent | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RulesContent | null>(null);
  const [packReport, setPackReport] = useState<ImportReport | null>(null);
  const [packError, setPackError] = useState("");

  function switchShelf(k: RulesKind) {
    setKind(k);
    setSearch("");
    setChip("");
    setSpellLevel("");
  }

  const classNames = useMemo(() => (classes ?? []).map((c) => c.name), [classes]);
  const kindLabel = SHELVES.find(([k]) => k === kind)?.[2] ?? kind;

  // chips row per shelf: the "submenu" — parent class, feat category, item type
  const chips: Array<[string, string]> = useMemo(() => {
    if (kind === "subclass") {
      const present = new Set(
        (entries ?? []).map((e) => ((e.data as DataObj).class as string) ?? ""),
      );
      return [...present].filter(Boolean).sort().map((c) => [c, c]);
    }
    if (kind === "feat")
      return FEAT_ORDER.map((c) => [c, FEAT_CATEGORY_LABEL[c]]);
    if (kind === "item") return ITEM_ORDER.map((t) => [t, ITEM_LABEL[t]]);
    if (kind === "spell") return classNames.map((c) => [c, c]);
    return [];
  }, [kind, entries, classNames]);

  // classes that claim spells by name (data.spellList) — the class chips on
  // the spell shelf must honor those claims too
  const classSpellLists = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of classes ?? []) {
      const list = (c.data as { spellList?: string[] }).spellList;
      if (Array.isArray(list)) m.set(c.name, new Set(list.map((n) => n.toLowerCase())));
    }
    return m;
  }, [classes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      const d = e.data as DataObj;
      if (kind === "spell") {
        if (spellLevel !== "" && String(d.level ?? "") !== spellLevel) return false;
        if (
          chip &&
          !((d.classes as string[]) ?? []).includes(chip) &&
          !classSpellLists.get(chip)?.has(e.name.toLowerCase())
        )
          return false;
      }
      if (kind === "subclass" && chip && (d.class as string) !== chip) return false;
      if (kind === "feat" && chip && ((d.category as string) ?? "general") !== chip) return false;
      if (kind === "item" && chip && ((d.type as string) ?? "gear") !== chip) return false;
      if (!q) return true;
      const hay = [
        e.name,
        e.summary,
        d.school,
        d.class,
        d.book,
        kind === "feat" ? d.prerequisite : "",
      ]
        .filter((v) => typeof v === "string")
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, kind, search, chip, spellLevel, classSpellLists]);

  // group the shelf: spells by level, feats by category, subclasses by class,
  // items by type; the rest flat
  const groups = useMemo((): Array<[string, RulesContent[]]> => {
    const by = (label: (e: RulesContent) => string, order?: (a: string, b: string) => number) => {
      const m = new Map<string, RulesContent[]>();
      for (const e of filtered) {
        const l = label(e);
        m.set(l, [...(m.get(l) ?? []), e]);
      }
      return [...m.entries()].sort((a, b) => (order ? order(a[0], b[0]) : a[0].localeCompare(b[0])));
    };
    switch (kind) {
      case "spell": {
        const m = new Map<number, RulesContent[]>();
        for (const e of filtered) {
          const lvl = ((e.data as DataObj).level as number) ?? 0;
          m.set(lvl, [...(m.get(lvl) ?? []), e]);
        }
        return [...m.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([lvl, list]) => [lvl === 0 ? "Cantrips" : `Level ${lvl}`, list]);
      }
      case "feat":
        return by(
          (e) => FEAT_CATEGORY_LABEL[((e.data as DataObj).category as string) ?? "general"] ?? "General",
          (a, b) =>
            FEAT_ORDER.findIndex((c) => FEAT_CATEGORY_LABEL[c] === a) -
            FEAT_ORDER.findIndex((c) => FEAT_CATEGORY_LABEL[c] === b),
        );
      case "subclass":
        return by((e) => ((e.data as DataObj).class as string) || "Unassigned");
      case "item":
        return by(
          (e) => ITEM_LABEL[((e.data as DataObj).type as string) ?? "gear"],
          (a, b) =>
            ITEM_ORDER.findIndex((t) => ITEM_LABEL[t] === a) -
            ITEM_ORDER.findIndex((t) => ITEM_LABEL[t] === b),
        );
      default:
        return filtered.length ? [["", filtered]] : [];
    }
  }, [filtered, kind]);

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
      const packEntries = (parsed as { entries?: unknown[] })?.entries;
      if (!Array.isArray(packEntries) || packEntries.length === 0) {
        setPackError("No entries in that pack — expected { \"entries\": [...] }.");
        return;
      }
      importPack.mutate(
        packEntries,
        {
          onSuccess: (report) => setPackReport(report),
          onError: (e) =>
            setPackError(
              (e as { error?: string } | null)?.error ?? "The crate would not open.",
            ),
        },
      );
    });
  }

  function exportPack() {
    fetch("/api/content/pack", { credentials: "include" })
      .then((r) => r.json())
      .then((pack) => {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(pack, null, 1)], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "questboard-homebrew-pack.json";
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  const apiError = (e: unknown) =>
    (e as { error?: string } | null)?.error ?? "The quill snapped — check the fields.";

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
            The Archives
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            Every rule on these shelves — SRD carved in stone, your books scribed beside it.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={exportPack}
            className="label-stamp cursor-pointer border-none bg-transparent text-[11px] font-semibold text-gold-muted transition hover:text-ember-bright"
          >
            Export my homebrew
          </button>
          <label className="label-stamp cursor-pointer text-[11px] font-semibold text-gold-muted transition hover:text-ember-bright">
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
            onClick={() => setAdding(true)}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
          >
            <IconPlus size={15} strokeWidth={2} />
            Scribe a {kindLabel}
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

      {/* shelf tabs */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {SHELVES.map(([k, label]) => (
          <button
            key={k}
            onClick={() => switchShelf(k)}
            className={`label-stamp cursor-pointer rounded-[2px] border-none px-3 py-2 text-[10px] font-semibold tracking-[1.5px] ${
              k === kind ? "text-ember-bright" : "text-gold-muted hover:text-gold-hair"
            }`}
            style={{
              background: k === kind ? "rgba(201,162,39,.12)" : "rgba(16,9,5,.35)",
              boxShadow: `inset 0 0 0 1px rgba(201,162,39,${k === kind ? ".45" : ".2"})`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* search + shelf filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${SHELVES.find(([k]) => k === kind)?.[1].toLowerCase()}…`}
          className="input-hall min-w-0 flex-1 sm:max-w-[300px]"
        />
        {kind === "spell" && (
          <select
            value={spellLevel}
            onChange={(e) => setSpellLevel(e.target.value)}
            className="input-hall w-36"
          >
            <option value="">Any level</option>
            <option value="0">Cantrips</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
              <option key={l} value={l}>
                Level {l}
              </option>
            ))}
          </select>
        )}
      </div>
      {chips.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {chips.map(([value, label]) => {
            const active = chip === value;
            return (
              <button
                key={value}
                onClick={() => setChip(active ? "" : value)}
                className="label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[9.5px] font-semibold tracking-[1.2px]"
                style={{
                  background: active ? "linear-gradient(180deg,#8b2520,#5e1611)" : "rgba(16,9,5,.35)",
                  color: active ? "#f3d9c0" : "#cdba93",
                  boxShadow: `inset 0 0 0 1px ${active ? "#3f0f0e" : "rgba(201,162,39,.25)"}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Dusting off the tomes…
        </div>
      ) : filtered.length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Nothing on this shelf answers that call.
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map(([label, list]) => (
            <section key={label || "all"}>
              {label && (
                <div className="label-stamp mb-2.5 text-[10px] tracking-[2.5px] text-gold-muted">
                  {label} · {list.length}
                </div>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(270px,100%),1fr))] gap-3">
                {list.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setReading(e)}
                    className="parchment cursor-pointer px-4 pb-3 pt-2.5 text-left transition hover:-translate-y-0.5"
                  >
                    <div className="font-display text-[14.5px] font-bold leading-tight text-ink">
                      {e.name}
                      {kind === "spell" && <SpellFlags spell={e} />}
                      {e.source === "homebrew" && (
                        <span className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-ink-label">
                          Homebrew
                        </span>
                      )}
                    </div>
                    <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-ink-label">
                      {cardTagline(kind, e)}
                    </div>
                    <p className="font-body m-0 mt-1 text-[12px] italic leading-snug text-ink-body">
                      {e.summary}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {reading && (
        <ParchmentModal onClose={() => setReading(null)} maxWidth="max-w-[560px]">
          <ContentEntry entry={reading} />
          {reading.mine && (
            <div
              className="mt-4 flex items-center justify-end gap-2 border-t pt-3"
              style={{ borderColor: "rgba(90,60,20,.25)" }}
            >
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
                  if (confirm(`Strike "${reading.name}" from the library?`)) {
                    del.mutate(reading.id);
                    setReading(null);
                  }
                }}
                className="btn-base btn-ghost-red px-4 py-2 text-[11px]"
              >
                <IconTrash size={13} strokeWidth={1.8} />
                Strike
              </button>
            </div>
          )}
        </ParchmentModal>
      )}

      {packReport && (
        <ParchmentModal onClose={() => setPackReport(null)} maxWidth="max-w-[520px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Archives
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

      {adding && (
        <ParchmentModal onClose={() => setAdding(false)} maxWidth="max-w-[640px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Archives
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Scribe a {kindLabel}
          </h3>
          <ContentForm
            kind={kind}
            initial={{ name: "", summary: "", data: { ...KIND_DEFAULTS[kind] } }}
            isPending={create.isPending}
            errorText={create.isError ? apiError(create.error) : undefined}
            classNames={classNames}
            onCancel={() => setAdding(false)}
            onSubmit={(body) => create.mutate(body, { onSuccess: () => setAdding(false) })}
          />
        </ParchmentModal>
      )}

      {editing && (
        <ParchmentModal onClose={() => setEditing(null)} maxWidth="max-w-[640px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Archives
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Amend the Entry
          </h3>
          <ContentForm
            kind={kind}
            initial={{
              name: editing.name,
              summary: editing.summary,
              data: (editing.data ?? {}) as DataObj,
            }}
            isPending={update.isPending}
            errorText={update.isError ? apiError(update.error) : undefined}
            classNames={classNames}
            onCancel={() => setEditing(null)}
            onSubmit={(body) =>
              update.mutate(
                { contentId: editing.id, body },
                { onSuccess: () => setEditing(null) },
              )
            }
          />
        </ParchmentModal>
      )}
    </div>
  );
}
