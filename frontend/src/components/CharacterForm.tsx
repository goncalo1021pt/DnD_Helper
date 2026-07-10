import { useState, type FormEvent } from "react";
import type { CharacterInput } from "../api/client";

export interface CharacterFormValues {
  name: string;
  class: string;
  level: number;
  hpCurrent: number;
  hpMax: number;
}

export const emptyHero: CharacterFormValues = {
  name: "",
  class: "",
  level: 1,
  hpCurrent: 10,
  hpMax: 10,
};

export default function CharacterForm({
  initial,
  mode,
  isPending,
  errorText,
  onSubmit,
  onCancel,
}: {
  initial: CharacterFormValues;
  mode: "create" | "edit";
  isPending: boolean;
  errorText?: string;
  onSubmit: (values: CharacterInput) => void;
  onCancel: () => void;
}) {
  // Numeric fields live as raw strings while editing, so clearing a field
  // with backspace works (a controlled number input snaps "" back to 0).
  const [v, setV] = useState(() => ({
    name: initial.name,
    class: initial.class,
    level: String(initial.level),
    hpCurrent: String(initial.hpCurrent),
    hpMax: String(initial.hpMax),
  }));

  function set(key: keyof typeof v, val: string) {
    setV((prev) => ({ ...prev, [key]: val }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return;
    const hpMax = Number(v.hpMax);
    onSubmit({
      name: v.name.trim(),
      class: v.class.trim(),
      level: Number(v.level),
      // A fresh hero arrives at full health.
      hpCurrent: mode === "create" ? hpMax : Number(v.hpCurrent),
      hpMax,
    });
  }

  const input = "input-parchment input-compact";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 text-ink-strong">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Name</span>
        <input
          className={`${input} font-heading font-semibold`}
          placeholder="e.g. Thorne Ashmantle"
          value={v.name}
          maxLength={80}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="field-label">Class &amp; ancestry</span>
        <input
          className={input}
          placeholder="e.g. Dragonborn Paladin"
          value={v.class}
          maxLength={80}
          onChange={(e) => set("class", e.target.value)}
        />
      </label>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Level</span>
          <input
            type="number"
            required
            min={1}
            max={20}
            className={input}
            value={v.level}
            onChange={(e) => set("level", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Max HP</span>
          <input
            type="number"
            required
            min={1}
            max={9999}
            className={input}
            value={v.hpMax}
            onChange={(e) => set("hpMax", e.target.value)}
          />
        </label>
        {mode === "edit" && (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Current HP</span>
            <input
              type="number"
              required
              min={0}
              max={9999}
              className={input}
              value={v.hpCurrent}
              onChange={(e) => set("hpCurrent", e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="torn-divider" />

      {errorText && (
        <p className="font-body m-0 text-sm italic text-[#8b2520]">{errorText}</p>
      )}

      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={isPending || !v.name.trim()}
          className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
        >
          {mode === "create" ? "Take a seat" : "Save the hero"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
