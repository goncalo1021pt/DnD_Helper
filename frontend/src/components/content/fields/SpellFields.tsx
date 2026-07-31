import type { FieldProps } from "./shared";
import { input } from "./shared";

export default function SpellFields({ data, set, classNames }: FieldProps) {
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
