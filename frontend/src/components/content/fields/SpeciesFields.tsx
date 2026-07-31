import type { FieldProps } from "./shared";
import { input } from "./shared";
import FeatureListEditor from "../FeatureListEditor";
import { featuresOf } from "../constants";

export default function SpeciesFields({ data, set }: FieldProps) {
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
