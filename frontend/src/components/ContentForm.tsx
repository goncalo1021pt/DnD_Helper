import { useState } from "react";
import type { RulesContentInput, RulesKind } from "../api/client";

/**
 * The shared content form: kind-aware guided fields plus the Raw Scroll JSON
 * tab. The Archives uses it for scribing new entries and amending old ones.
 */

const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const SKILLS = [
  "Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
  "History", "Insight", "Intimidation", "Investigation", "Medicine",
  "Nature", "Perception", "Performance", "Persuasion", "Religion",
  "Sleight of Hand", "Stealth", "Survival",
];

type DataObj = Record<string, unknown>;
interface Feature {
  level?: number;
  name?: string;
  summary?: string;
}

const input = "input-parchment input-compact";

function featuresOf(data: DataObj, key: string): Feature[] {
  const raw = data[key];
  return Array.isArray(raw) ? (raw as Feature[]) : [];
}

/** Small editor for a list of {level?, name, summary} entries. */
function FeatureListEditor({
  label,
  withLevel,
  items,
  onChange,
}: {
  label: string;
  withLevel: boolean;
  items: Feature[];
  onChange: (items: Feature[]) => void;
}) {
  function set(i: number, patch: Feature) {
    onChange(items.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  return (
    <div>
      <div className="field-label mb-1.5">{label}</div>
      <div className="flex flex-col gap-2">
        {items.map((f, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2">
            {withLevel && (
              <input
                type="number"
                min={1}
                max={20}
                title="Level"
                className={`${input} w-16`}
                value={f.level ?? ""}
                onChange={(e) =>
                  set(i, { level: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            )}
            <input
              placeholder="Name"
              className={`${input} w-40 flex-none`}
              value={f.name ?? ""}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <input
              placeholder="What it does"
              className={`${input} min-w-40 flex-1`}
              value={f.summary ?? ""}
              onChange={(e) => set(i, { summary: e.target.value })}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              title="Remove"
              className="btn-base btn-ghost-red h-10 w-10 flex-none"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, withLevel ? { level: 1 } : {}])}
        className="label-stamp mt-2 cursor-pointer border-none bg-transparent p-0 text-[10px] font-semibold text-ink-label hover:text-ink"
      >
        + add {label.toLowerCase().replace(/s$/, "")}
      </button>
    </div>
  );
}

/** Kind-aware guided fields, all reading/writing the same data object. */
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
  const set = (key: string, value: unknown) => setData({ ...data, [key]: value });
  const strArr = (key: string): string[] =>
    Array.isArray(data[key]) ? (data[key] as string[]) : [];

  if (kind === "class") {
    const sc = (data.skillChoices ?? {}) as { choose?: number; from?: string[] };
    const from = Array.isArray(sc.from) ? sc.from : [];
    const wildcard = from.length === 1 && from[0] === "*";
    const saves = strArr("saves");
    return (
      <>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Hit die</span>
            <select
              className={`${input} w-24 cursor-pointer`}
              value={(data.hitDie as number) ?? 8}
              onChange={(e) => set("hitDie", Number(e.target.value))}
            >
              {[6, 8, 10, 12].map((d) => (
                <option key={d} value={d}>d{d}</option>
              ))}
            </select>
          </label>
          {[0, 1].map((i) => (
            <label key={i} className="flex flex-col gap-1.5">
              <span className="field-label">Save {i + 1}</span>
              <select
                className={`${input} w-24 cursor-pointer`}
                value={saves[i] ?? ""}
                onChange={(e) => {
                  const next = [...saves];
                  next[i] = e.target.value;
                  set("saves", next);
                }}
              >
                <option value="">—</option>
                {ABILITIES.map((a) => (
                  <option key={a} value={a} disabled={saves[1 - i] === a}>{a}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Skills to choose</span>
            <input
              type="number"
              min={1}
              max={6}
              className={`${input} w-20`}
              value={sc.choose ?? 2}
              onChange={(e) =>
                set("skillChoices", { ...sc, choose: Number(e.target.value || 0), from })
              }
            />
          </label>
        </div>
        <div>
          <div className="field-label mb-1.5">
            Skill list{" "}
            <button
              type="button"
              onClick={() =>
                set("skillChoices", { ...sc, from: wildcard ? [] : ["*"] })
              }
              className={`ml-2 cursor-pointer border-none bg-transparent p-0 text-[10px] font-semibold ${wildcard ? "text-[#8b2520]" : "text-ink-label"}`}
            >
              {wildcard ? "any skill ✓ (click for a fixed list)" : "or allow any skill"}
            </button>
          </div>
          {!wildcard && (
            <div className="flex flex-wrap gap-1.5">
              {SKILLS.map((sk) => {
                const active = from.includes(sk);
                return (
                  <button
                    type="button"
                    key={sk}
                    onClick={() =>
                      set("skillChoices", {
                        ...sc,
                        from: active ? from.filter((s) => s !== sk) : [...from, sk],
                      })
                    }
                    className="label-stamp cursor-pointer rounded-[2px] border-none px-2 py-1 text-[9.5px] tracking-[1px]"
                    style={{
                      background: active ? "linear-gradient(180deg,#8b2520,#5e1611)" : "rgba(16,9,5,.08)",
                      color: active ? "#f3d9c0" : "#6b5637",
                      boxShadow: `inset 0 0 0 1px ${active ? "#3f0f0e" : "rgba(120,80,30,.35)"}`,
                    }}
                  >
                    {sk}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <FeatureListEditor
          label="Features"
          withLevel
          items={featuresOf(data, "features")}
          onChange={(items) => set("features", items)}
        />
      </>
    );
  }

  if (kind === "species") {
    return (
      <>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Size</span>
            <select
              className={`${input} w-32 cursor-pointer`}
              value={(data.size as string) ?? "Medium"}
              onChange={(e) => set("size", e.target.value)}
            >
              {["Tiny", "Small", "Medium", "Large"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Speed (ft)</span>
            <input
              type="number"
              min={5}
              max={120}
              step={5}
              className={`${input} w-24`}
              value={(data.speed as number) ?? 30}
              onChange={(e) => set("speed", Number(e.target.value || 0))}
            />
          </label>
        </div>
        <FeatureListEditor
          label="Traits"
          withLevel={false}
          items={featuresOf(data, "traits")}
          onChange={(items) => set("traits", items)}
        />
      </>
    );
  }

  if (kind === "background") {
    const abilities = strArr("abilityScores");
    const skills = strArr("skills");
    return (
      <>
        <div className="flex flex-wrap gap-4">
          {[0, 1, 2].map((i) => (
            <label key={i} className="flex flex-col gap-1.5">
              <span className="field-label">Ability {i + 1}</span>
              <select
                className={`${input} w-24 cursor-pointer`}
                value={abilities[i] ?? ""}
                onChange={(e) => {
                  const next = [...abilities];
                  next[i] = e.target.value;
                  set("abilityScores", next);
                }}
              >
                <option value="">—</option>
                {ABILITIES.map((a) => (
                  <option key={a} value={a} disabled={abilities.includes(a) && abilities[i] !== a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          {[0, 1].map((i) => (
            <label key={i} className="flex flex-col gap-1.5">
              <span className="field-label">Skill {i + 1}</span>
              <select
                className={`${input} w-44 cursor-pointer`}
                value={skills[i] ?? ""}
                onChange={(e) => {
                  const next = [...skills];
                  next[i] = e.target.value;
                  set("skills", next);
                }}
              >
                <option value="">—</option>
                {SKILLS.map((sk) => (
                  <option key={sk} value={sk} disabled={skills[1 - i] === sk}>{sk}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Origin feat</span>
            <input
              className={`${input} w-44`}
              placeholder="e.g. Tough"
              value={(data.feat as string) ?? ""}
              onChange={(e) => set("feat", e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Equipment (freeform)</span>
          <input
            className={input}
            placeholder="e.g. Spear, shield, traveler's clothes, 10 gp"
            value={(data.equipment as string) ?? ""}
            onChange={(e) => set("equipment", e.target.value)}
          />
        </label>
      </>
    );
  }

  if (kind === "subclass") {
    return (
      <>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Parent class</span>
          <select
            className={`${input} w-44 cursor-pointer`}
            value={(data.class as string) ?? ""}
            onChange={(e) => set("class", e.target.value)}
          >
            <option value="">—</option>
            {classNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <FeatureListEditor
          label="Features"
          withLevel
          items={featuresOf(data, "features")}
          onChange={(items) => set("features", items)}
        />
      </>
    );
  }

  if (kind === "spell") {
    const chosen = (data.classes as string[]) ?? [];
    return (
      <>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Spell level</span>
            <select
              className={`${input} w-36 cursor-pointer`}
              value={(data.level as number) ?? 1}
              onChange={(e) => set("level", Number(e.target.value))}
            >
              <option value={0}>Cantrip</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
                <option key={l} value={l}>Level {l}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">School</span>
            <input
              className={`${input} w-44`}
              placeholder="e.g. Evocation"
              value={(data.school as string) ?? ""}
              onChange={(e) => set("school", e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="field-label">Classes that can learn it</span>
          <div className="flex flex-wrap gap-2">
            {classNames.map((n) => {
              const active = chosen.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() =>
                    set("classes", active ? chosen.filter((c) => c !== n) : [...chosen, n])
                  }
                  className={`label-stamp cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-[10px] tracking-[1px]`}
                  style={{
                    background: active ? "linear-gradient(180deg,#8b2520,#5e1611)" : "rgba(16,9,5,.4)",
                    color: active ? "#f3d9c0" : "#cdba93",
                    boxShadow: `inset 0 0 0 1px ${active ? "#3f0f0e" : "rgba(201,162,39,.3)"}`,
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Range</span>
            <input className={input} placeholder="e.g. 60 ft"
              value={(data.range as string) ?? ""}
              onChange={(e) => set("range", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Casting time</span>
            <input className={input} placeholder="e.g. Action"
              value={(data.castingTime as string) ?? ""}
              onChange={(e) => set("castingTime", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Components</span>
            <input className={input} placeholder="e.g. V, S, M"
              value={(data.components as string) ?? ""}
              onChange={(e) => set("components", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Duration</span>
            <input className={input} placeholder="e.g. 1 minute"
              value={(data.duration as string) ?? ""}
              onChange={(e) => set("duration", e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">The entry (full rules text)</span>
          <textarea
            rows={6}
            className={`${input} min-h-[120px] leading-relaxed`}
            placeholder="Exactly what the spell does — paragraphs, **bold** and _italics_ welcome."
            value={(data.description as string) ?? ""}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-5">
          {(["concentration", "ritual"] as const).map((flag) => (
            <label key={flag} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={(data[flag] as boolean) ?? false}
                onChange={(e) => set(flag, e.target.checked)}
              />
              <span className="field-label">{flag}</span>
            </label>
          ))}
        </div>
      </>
    );
  }

  if (kind === "item") {
    const itemType = (data.type as string) ?? "gear";
    return (
      <>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Item type</span>
          <select
            className={`${input} w-44 cursor-pointer`}
            value={itemType}
            onChange={(e) => set("type", e.target.value)}
          >
            <option value="gear">Gear (anything else)</option>
            <option value="armor">Armor</option>
            <option value="shield">Shield</option>
            <option value="weapon">Weapon</option>
          </select>
        </label>
        {itemType === "armor" && (
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Category</span>
              <select className={`${input} w-36 cursor-pointer`}
                value={(data.category as string) ?? "Light"}
                onChange={(e) => set("category", e.target.value)}>
                <option>Light</option><option>Medium</option><option>Heavy</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Base AC</span>
              <input type="number" min={10} max={20} className={`${input} w-24`}
                value={(data.ac as number) ?? 11}
                onChange={(e) => set("ac", Number(e.target.value))} />
            </label>
            <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[13px]">
              <input type="checkbox"
                checked={(data.stealthDisadvantage as boolean) ?? false}
                onChange={(e) => set("stealthDisadvantage", e.target.checked)} />
              <span className="field-label">Stealth disadvantage</span>
            </label>
          </div>
        )}
        {itemType === "shield" && (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">AC bonus</span>
            <input type="number" min={1} max={3} className={`${input} w-24`}
              value={(data.acBonus as number) ?? 2}
              onChange={(e) => set("acBonus", Number(e.target.value))} />
          </label>
        )}
        {itemType === "weapon" && (
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Category</span>
              <select className={`${input} w-36 cursor-pointer`}
                value={(data.category as string) ?? "Simple"}
                onChange={(e) => set("category", e.target.value)}>
                <option>Simple</option><option>Martial</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Damage</span>
              <input className={`${input} w-24`} placeholder="1d8"
                value={(data.damage as string) ?? ""}
                onChange={(e) => set("damage", e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Damage type</span>
              <input className={`${input} w-36`} placeholder="slashing"
                value={(data.damageType as string) ?? ""}
                onChange={(e) => set("damageType", e.target.value)} />
            </label>
            <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[13px]">
              <input type="checkbox"
                checked={(data.ranged as boolean) ?? false}
                onChange={(e) => set("ranged", e.target.checked)} />
              <span className="field-label">Ranged</span>
            </label>
          </div>
        )}
      </>
    );
  }

  // feat
  return (
    <>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Category</span>
          <select
            className={`${input} w-52 cursor-pointer`}
            value={(data.category as string) ?? "general"}
            onChange={(e) => set("category", e.target.value)}
          >
            <option value="origin">Origin (background feat)</option>
            <option value="general">General (ASI-level choice)</option>
            <option value="fighting-style">Fighting style</option>
            <option value="invocation">Eldritch Invocation (Warlock)</option>
            <option value="metamagic">Metamagic (Sorcerer)</option>
            <option value="epic-boon">Epic boon (level 19+)</option>
          </select>
        </label>
        <label className="flex min-w-44 flex-1 flex-col gap-1.5">
          <span className="field-label">Prerequisite (optional)</span>
          <input
            className={input}
            placeholder="e.g. Level 4+, Strength 13+"
            value={(data.prerequisite as string) ?? ""}
            onChange={(e) => set("prerequisite", e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">The entry (full rules text)</span>
        <textarea
          rows={6}
          className={`${input} min-h-[120px] leading-relaxed`}
          placeholder="Exactly what the feat grants — paragraphs, **bold** and _italics_ welcome."
          value={(data.description as string) ?? ""}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
    </>
  );
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
