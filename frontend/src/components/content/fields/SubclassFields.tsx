import type { FieldProps } from "./shared";
import { input } from "./shared";
import FeatureListEditor from "../FeatureListEditor";
import { featuresOf } from "../constants";

export default function SubclassFields({ data, set, classNames }: FieldProps) {
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
