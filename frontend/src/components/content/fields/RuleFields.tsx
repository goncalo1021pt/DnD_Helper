import type { FieldProps } from "./shared";
import { input } from "./shared";

export default function RuleFields({ data, set }: FieldProps) {
  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Category</span>
        <select
          className={`${input} w-52 cursor-pointer`}
          value={(data.category as string) ?? "glossary"}
          onChange={(e) => set("category", e.target.value)}
        >
          <option value="glossary">Rules glossary</option>
          <option value="condition">Condition</option>
          <option value="weapon-property">Weapon property</option>
          <option value="mastery">Weapon mastery</option>
          <option value="action">Action</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">The rule (full text)</span>
        <textarea
          rows={8}
          className={`${input} min-h-[160px] leading-relaxed`}
          placeholder="Exactly what the rule says — paragraphs, **bold** and _italics_ welcome. The name is the keyword a card or chip will open this from."
          value={(data.description as string) ?? ""}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
    </>
  );
}
