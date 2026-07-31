/* The eighteen skills and six abilities the pickers offer, and the shape of a
   feature a class or species grants at a level. */

export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
export const SKILLS = [
  "Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception",
  "History", "Insight", "Intimidation", "Investigation", "Medicine",
  "Nature", "Perception", "Performance", "Persuasion", "Religion",
  "Sleight of Hand", "Stealth", "Survival",
];


export type DataObj = Record<string, unknown>;
export interface Feature {
  level?: number;
  name?: string;
  summary?: string;
}


export function featuresOf(data: DataObj, key: string): Feature[] {
  const raw = data[key];
  return Array.isArray(raw) ? (raw as Feature[]) : [];
}

/** Small editor for a list of {level?, name, summary} entries. */
