import type { FieldProps } from "./shared";
import { input } from "./shared";
import { ABILITIES } from "../constants";
import { SKILLS } from "../constants";

export default function BackgroundFields({ data, set, strArr }: FieldProps) {
  const abilities = strArr("abilityScores");
  const skills = strArr("skills");
  return (
    <>
      <div className="flex flex-wrap gap-4">
        {[0, 1, 2].map((i) => (
          <label key={i} className="flex flex-col gap-1.5">
            <span className="field-label">Ability {i + 1}</span>
            <select
              className={`${input} w-24 cursor-pointer`}
              value={abilities[i] ?? ""}
              onChange={(e) => {
                const next = [...abilities];
                next[i] = e.target.value;
                set("abilityScores", next);
              }}
            >
              <option value="">—</option>
              {ABILITIES.map((a) => (
                <option key={a} value={a} disabled={abilities.includes(a) && abilities[i] !== a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {[0, 1].map((i) => (
          <label key={i} className="flex flex-col gap-1.5">
            <span className="field-label">Skill {i + 1}</span>
            <select
              className={`${input} w-44 cursor-pointer`}
              value={skills[i] ?? ""}
              onChange={(e) => {
                const next = [...skills];
                next[i] = e.target.value;
                set("skills", next);
              }}
            >
              <option value="">—</option>
              {SKILLS.map((sk) => (
                <option key={sk} value={sk} disabled={skills[1 - i] === sk}>{sk}</option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Origin feat</span>
          <input
            className={`${input} w-44`}
            placeholder="e.g. Tough"
            value={(data.feat as string) ?? ""}
            onChange={(e) => set("feat", e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Equipment (freeform)</span>
        <input
          className={input}
          placeholder="e.g. Spear, shield, traveler's clothes, 10 gp"
          value={(data.equipment as string) ?? ""}
          onChange={(e) => set("equipment", e.target.value)}
        />
      </label>
    </>
  );
}
