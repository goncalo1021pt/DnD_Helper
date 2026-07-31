/* Which ability each of the eighteen skills is rolled against. */


export const SKILL_ABILITY: Record<string, string> = {
  Athletics: "str",
  Acrobatics: "dex", "Sleight of Hand": "dex", Stealth: "dex",
  Arcana: "int", History: "int", Investigation: "int", Nature: "int", Religion: "int",
  "Animal Handling": "wis", Insight: "wis", Medicine: "wis", Perception: "wis", Survival: "wis",
  Deception: "cha", Intimidation: "cha", Performance: "cha", Persuasion: "cha",
};
