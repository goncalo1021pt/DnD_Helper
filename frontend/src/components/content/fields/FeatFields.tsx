import type { FieldProps } from "./shared";
import { input } from "./shared";

export default function FeatFields({ data, set }: FieldProps) {
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
