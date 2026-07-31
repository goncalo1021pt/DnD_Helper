import { type Feature } from "./constants";
import { input } from "./fields/shared";

export default function FeatureListEditor({
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
