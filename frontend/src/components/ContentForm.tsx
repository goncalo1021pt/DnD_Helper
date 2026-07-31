import { useState } from "react";
import type { RulesContentInput, RulesKind } from "../api/client";
import type { DataObj } from "./content/constants";
import { input } from "./content/fields/shared";
import BackgroundFields from "./content/fields/BackgroundFields";
import ClassFields from "./content/fields/ClassFields";
import FeatFields from "./content/fields/FeatFields";
import ItemFields from "./content/fields/ItemFields";
import SpeciesFields from "./content/fields/SpeciesFields";
import SpellFields from "./content/fields/SpellFields";
import SubclassFields from "./content/fields/SubclassFields";

/**
 * The shared content form: kind-aware guided fields plus the Raw Scroll JSON
 * tab. The Archives uses it for scribing new entries and amending old ones.
 */

/* Which field set a kind gets. Each one lives in content/fields/ — they share
   three helpers and nothing else, which is why they were one function for far
   too long. */
function GuidedFields({
  kind,
  data,
  setData,
  classNames,
}: {
  kind: RulesKind;
  data: DataObj;
  setData: (d: DataObj) => void;
  classNames: string[];
}) {
  const props = {
    data,
    set: (key: string, value: unknown) => setData({ ...data, [key]: value }),
    strArr: (key: string): string[] =>
      Array.isArray(data[key]) ? (data[key] as string[]) : [],
    classNames,
  };
  switch (kind) {
    case "class":
      return <ClassFields {...props} />;
    case "species":
      return <SpeciesFields {...props} />;
    case "background":
      return <BackgroundFields {...props} />;
    case "subclass":
      return <SubclassFields {...props} />;
    case "spell":
      return <SpellFields {...props} />;
    case "item":
      return <ItemFields {...props} />;
    default:
      return <FeatFields {...props} />;
  }
}

export const KIND_DEFAULTS: Record<RulesKind, DataObj> = {
  class: {
    hitDie: 8,
    saves: [],
    skillChoices: { choose: 2, from: [] },
    features: [],
    subclassLevel: 3,
  },
  species: { size: "Medium", speed: 30, traits: [] },
  background: { abilityScores: [], skills: [], feat: "", equipment: "" },
  subclass: { class: "", features: [] },
  feat: { category: "general" },
  spell: { level: 1, school: "", classes: [] },
  item: { type: "gear" },
  monster: {
    size: "Medium", type: "Beast", alignment: "Unaligned",
    ac: 12, hp: 11, speed: "30 ft.", cr: "1/4", crValue: 0.25,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    description: "",
  },
};

export function ContentForm({
  kind,
  initial,
  isPending,
  errorText,
  classNames,
  onSubmit,
  onCancel,
}: {
  kind: RulesKind;
  initial: { name: string; summary: string; data: DataObj };
  isPending: boolean;
  errorText?: string;
  classNames: string[];
  onSubmit: (body: RulesContentInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [summary, setSummary] = useState(initial.summary);
  const [data, setData] = useState<DataObj>(initial.data);
  const [tab, setTab] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");

  function openJson() {
    setJsonText(JSON.stringify(data, null, 2));
    setJsonError("");
    setTab("json");
  }
  function onJsonChange(text: string) {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setJsonError("the scroll must be a JSON object");
        return;
      }
      setData(parsed as DataObj);
      setJsonError("");
    } catch {
      setJsonError("the scroll does not parse — fix the JSON to save");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (jsonError) return;
        onSubmit({ name: name.trim(), summary: summary.trim(), data });
      }}
      className="flex flex-col gap-4 text-ink-strong"
    >
      <div className="flex flex-wrap gap-4">
        <label className="flex min-w-44 flex-1 flex-col gap-1.5">
          <span className="field-label">Name</span>
          <input
            className={`${input} font-heading font-semibold`}
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Summary</span>
        <input
          className={input}
          placeholder="One line of flavor for the pickers"
          value={summary}
          maxLength={300}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>

      {/* form / scroll tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("form")}
          className={`btn-base px-4 py-2 text-[10.5px] ${tab === "form" ? "btn-wax" : "btn-ghost-ink"}`}
        >
          Guided
        </button>
        <button
          type="button"
          onClick={openJson}
          className={`btn-base px-4 py-2 text-[10.5px] ${tab === "json" ? "btn-wax" : "btn-ghost-ink"}`}
        >
          The Raw Scroll
        </button>
      </div>

      {tab === "form" ? (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Source book (optional)</span>
            <input
              className="input-parchment input-compact"
              placeholder="e.g. Player's Handbook (2024), page 274"
              value={(data.book as string) ?? ""}
              onChange={(e) => setData({ ...data, book: e.target.value })}
            />
          </label>
          <GuidedFields kind={kind} data={data} setData={setData} classNames={classNames} />
        </div>
      ) : (
        <div>
          <textarea
            className={`${input} min-h-64 w-full font-mono text-[12px] leading-relaxed`}
            value={jsonText}
            spellCheck={false}
            onChange={(e) => onJsonChange(e.target.value)}
          />
          {jsonError && (
            <p className="font-body m-0 mt-1.5 text-[12.5px] italic text-[#8b2520]">{jsonError}</p>
          )}
        </div>
      )}

      {errorText && (
        <p className="font-body m-0 text-sm italic text-[#8b2520]">{errorText}</p>
      )}

      <div className="mt-1 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !!jsonError || !name.trim()}
          className="btn-base btn-gold clip-octagon h-11 px-6 text-sm"
        >
          {isPending ? "Scribing…" : "Scribe It"}
        </button>
      </div>
    </form>
  );
}
