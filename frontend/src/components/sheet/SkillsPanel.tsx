/* The eighteen skills, each with its proficiency pip and the modifier it rolls
   at. Proficiency is the hero's list; the modifier is the ability behind the
   skill plus the bonus if they have it. */

import type { Character } from "../../api/client";
import { abilityMod } from "../ui/AbilityRow";
import SectionLabel from "./SectionLabel";
import { SKILL_ABILITY } from "./skills";

export default function SkillsPanel({
  sheet,
  prof,
}: {
  sheet: NonNullable<Character["sheet"]>;
  prof: number;
}) {
  return (
  <section>
    <SectionLabel>Skills</SectionLabel>
    <div className="parchment grid grid-cols-2 gap-x-5 gap-y-1 px-4 py-3.5 sm:grid-cols-3">
      {Object.keys(SKILL_ABILITY).map((sk) => {
        const proficient = sheet.skills.includes(sk);
        const mod =
          abilityMod(sheet.abilities[SKILL_ABILITY[sk] as keyof typeof sheet.abilities]) +
          (proficient ? prof : 0);
        return (
          <div
            key={sk}
            className={`flex items-baseline justify-between text-[12.5px] ${proficient ? "font-semibold text-ink" : "text-ink-body"}`}
          >
            <span>
              {proficient ? "● " : "○ "}
              {sk}
            </span>
            <span className="tabular-nums">{mod >= 0 ? `+${mod}` : mod}</span>
          </div>
        );
      })}
    </div>
  </section>
  );
}
