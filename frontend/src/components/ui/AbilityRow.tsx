import type { AbilityScores } from "../../api/client";
import { modText } from "../../lib/abilities";

const ORDER: Array<[keyof AbilityScores, string]> = [
  ["str", "STR"],
  ["dex", "DEX"],
  ["con", "CON"],
  ["int", "INT"],
  ["wis", "WIS"],
  ["cha", "CHA"],
];

/** Six compact stat tiles: label, score, modifier. */
export default function AbilityRow({ abilities }: { abilities: AbilityScores }) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {ORDER.map(([key, label]) => (
        <div
          key={key}
          className="flex flex-col items-center rounded-[2px] py-1.5"
          style={{
            background: "rgba(120,86,42,.1)",
            boxShadow: "inset 0 0 0 1px rgba(120,80,30,.3)",
          }}
        >
          <span className="label-stamp text-[8px] tracking-[1px] text-ink-label">
            {label}
          </span>
          <span className="font-heading text-[15px] font-bold leading-tight text-ink tabular-nums">
            {abilities[key] > 0 ? abilities[key] : "—"}
          </span>
          <span className="text-[10px] font-semibold text-ink-body tabular-nums">
            {abilities[key] > 0 ? modText(abilities[key]) : " "}
          </span>
        </div>
      ))}
    </div>
  );
}
