
import type { Location } from "../../api/client";

/** The place tree as a picker — the same indented list the quest board uses. */
export function PlaceSelect({
  locations,
  value,
  onChange,
  className,
}: {
  locations: Location[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`input-hall cursor-pointer ${className ?? ""}`}
      title="The place this fight is prepared for"
    >
      <option value="">— nowhere in particular —</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {"— ".repeat(l.depth)}
          {l.name}
        </option>
      ))}
    </select>
  );
}
