import { crValueOfLabel } from "../../../lib/monsters";
import type { FieldProps } from "./shared";
import { input } from "./shared";

/*
The stat block a DM actually edits (#127).

Monsters had no field set at all — the switch in ContentForm fell through to
`default`, which is the *feat* form, so scribing or copying a dragon offered a
Category dropdown, a Prerequisite box and a rules-text area, and writing in them
put `category` and `prerequisite` on the creature. The only real way to edit a
monster was the Raw Scroll JSON tab.

Two things here are load-bearing rather than cosmetic:

  - **Numbers are stored as numbers.** `ac` or `hp` arriving as a string blanks
    the whole stat card in the Den and seats the creature at AC 0 in an
    encounter, and nothing says so — the card just renders empty.
  - **crValue follows the written CR.** `cr` is prose ("1/4 (XP 50; PB +2)")
    and `crValue` is what the Den sorts on, the band filter reads, and the
    difficulty meter falls back to. Left to drift they disagree silently: a CR 5
    homebrew sorts among the rats and weighs a fight as 50 XP.
*/

const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const ABILITIES: Array<[string, string]> = [
  ["str", "STR"], ["dex", "DEX"], ["con", "CON"],
  ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"],
];

export default function MonsterFields({ data, set, patch }: FieldProps) {
  const num = (key: string, fallback = 0): number =>
    typeof data[key] === "number" ? (data[key] as number) : fallback;
  const str = (key: string, fallback = ""): string =>
    typeof data[key] === "string" ? (data[key] as string) : fallback;

  // Stored as a number, always. An empty box reads as 0 rather than "".
  const setNum = (key: string, raw: string) => {
    const n = Number(raw);
    set(key, Number.isFinite(n) ? n : 0);
  };

  const abilities = (data.abilities ?? {}) as Record<string, unknown>;
  const setAbility = (key: string, raw: string) => {
    const n = Number(raw);
    set("abilities", { ...abilities, [key]: Number.isFinite(n) ? n : 10 });
  };

  const cr = str("cr");
  const derived = crValueOfLabel(cr);

  return (
    <>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Size</span>
          <select
            className={`${input} w-32 cursor-pointer`}
            value={str("size", "Medium")}
            onChange={(e) => set("size", e.target.value)}
          >
            {SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1.5">
          <span className="field-label">Type</span>
          <input
            className={input}
            placeholder="e.g. Dragon (Chromatic)"
            value={str("type")}
            onChange={(e) => set("type", e.target.value)}
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1.5">
          <span className="field-label">Alignment</span>
          <input
            className={input}
            placeholder="e.g. Chaotic Evil"
            value={str("alignment")}
            onChange={(e) => set("alignment", e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">AC</span>
          <input
            type="number"
            className={`${input} w-20`}
            value={num("ac", 10)}
            onChange={(e) => setNum("ac", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Hit points</span>
          <input
            type="number"
            className={`${input} w-24`}
            value={num("hp", 1)}
            onChange={(e) => setNum("hp", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">HP formula</span>
          <input
            className={`${input} w-32`}
            placeholder="3d6"
            value={str("hpFormula")}
            onChange={(e) => set("hpFormula", e.target.value)}
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1.5">
          <span className="field-label">Speed</span>
          <input
            className={input}
            placeholder="30 ft., Fly 60 ft."
            value={str("speed")}
            onChange={(e) => set("speed", e.target.value)}
          />
        </label>
      </div>

      {/* The derived note sits OUTSIDE the label on purpose — inside, it would
          become part of the field's accessible name, so a screen reader (and
          any test) would hear "Challenge sorts and weighs as CR 2" as the name
          of the box. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Challenge</span>
          <input
            className={`${input} w-56`}
            placeholder="1/4 (XP 50; PB +2)"
            value={cr}
            // Both in one write: two `set` calls would spread the same stale
            // data and the second would drop the first, leaving the written CR
            // unchanged while crValue moved.
            onChange={(e) =>
              patch({ cr: e.target.value, crValue: crValueOfLabel(e.target.value) })
            }
          />
        </label>
        {/* Shown because it is derived: the DM should see what the Den will
            sort and weigh this creature by, not discover it later. */}
        <span className="font-body pb-2 text-[12px] italic text-ink-body">
          sorts and weighs as CR {derived}
          {/XP\s*[\d,]+|[\d,]+\s*XP/i.test(cr) ? "" : " · state an XP to override the CR's default"}
        </span>
      </div>

      <div>
        <span className="field-label">Ability scores</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ABILITIES.map(([key, label]) => (
            <label key={key} className="flex flex-col items-center gap-1">
              <span className="label-stamp text-[8px] tracking-[1px] text-ink-label">{label}</span>
              <input
                type="number"
                className={`${input} w-[62px] text-center`}
                value={typeof abilities[key] === "number" ? (abilities[key] as number) : 10}
                onChange={(e) => setAbility(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="field-label">Saving throws (optional)</span>
        <input
          className={input}
          placeholder="STR +8, DEX +6, CON +7"
          value={str("saves")}
          onChange={(e) => set("saves", e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="field-label">The stat block (traits, actions, lore)</span>
        <textarea
          rows={8}
          className={`${input} min-h-[150px] leading-relaxed`}
          placeholder="Traits and actions — paragraphs, **bold** and _italics_ welcome."
          value={str("description")}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
    </>
  );
}
