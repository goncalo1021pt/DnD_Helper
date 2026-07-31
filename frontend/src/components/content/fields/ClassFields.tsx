import type { FieldProps } from "./shared";
import { input } from "./shared";
import { ABILITIES } from "../constants";
import { SKILLS } from "../constants";
import FeatureListEditor from "../FeatureListEditor";
import { featuresOf } from "../constants";

export default function ClassFields({ data, set, strArr }: FieldProps) {
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
