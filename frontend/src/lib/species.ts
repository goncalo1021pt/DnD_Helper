/**
 * Species data as the UI reads it. Mirrors backend/internal/http/species.go —
 * the server is the authority on whether a set of picks is legal; these types
 * only let the Forge render a real picker and the Archives show what a species
 * actually asks of you.
 */

export const ALL_SKILLS = [
  "Acrobatics",
  "Animal Handling",
  "Arcana",
  "Athletics",
  "Deception",
  "History",
  "Insight",
  "Intimidation",
  "Investigation",
  "Medicine",
  "Nature",
  "Perception",
  "Performance",
  "Persuasion",
  "Religion",
  "Sleight of Hand",
  "Stealth",
  "Survival",
] as const;

export interface SpeciesTrait {
  name: string;
  summary?: string;
  /** The choices entry this trait asks the player to answer, if any. */
  choice?: string;
}

export interface SpeciesChoiceOption {
  name: string;
  summary?: string;
  /** Spells a lineage grants later, e.g. Drow's Faerie Fire at level 3. */
  spells?: Array<{ level: number; name: string }>;
}

/** Types that put something on the sheet rather than just being recorded. */
export type SpeciesChoiceType = "lineage" | "skill" | "tool" | "feat" | "size" | "ability";

export interface SpeciesChoice {
  id: string;
  name: string;
  type: SpeciesChoiceType;
  choose?: number;
  summary?: string;
  /** "*" = any skill or tool, "origin" = any Origin feat. */
  from?: string;
  options?: SpeciesChoiceOption[];
}

export interface SpeciesData {
  creatureType?: string;
  size?: string;
  sizeNote?: string;
  speed?: number;
  book?: string;
  description?: string;
  traits?: SpeciesTrait[];
  choices?: SpeciesChoice[];
}

/** Picks keyed by choice id, matching the API's SpeciesChoices shape. */
export type SpeciesPicks = Record<string, string[]>;

export function choiceCount(choice: SpeciesChoice): number {
  return Math.max(1, choice.choose ?? 1);
}

/**
 * The option names a choice offers. Open picks ("any skill", "any Origin
 * feat") have no explicit list, so the caller supplies the pool.
 */
export function choiceOptions(
  choice: SpeciesChoice,
  pools: { skills?: readonly string[]; feats?: readonly string[] } = {},
): SpeciesChoiceOption[] {
  if (choice.options && choice.options.length > 0) return choice.options;
  if (choice.type === "skill" && choice.from === "*") {
    return (pools.skills ?? ALL_SKILLS).map((name) => ({ name }));
  }
  if (choice.type === "feat") {
    return (pools.feats ?? []).map((name) => ({ name }));
  }
  return [];
}

/** Every choice answered with exactly as many picks as it asks for. */
export function picksComplete(data: SpeciesData | undefined, picks: SpeciesPicks): boolean {
  return (data?.choices ?? []).every((c) => (picks[c.id]?.length ?? 0) === choiceCount(c));
}

/** The skills a species' picks grant — they join the character's proficiencies. */
export function grantedSkills(data: SpeciesData | undefined, picks: SpeciesPicks): string[] {
  return (data?.choices ?? [])
    .filter((c) => c.type === "skill")
    .flatMap((c) => picks[c.id] ?? []);
}

/** The feats a species' picks grant (a Human's Versatile). */
export function grantedFeats(data: SpeciesData | undefined, picks: SpeciesPicks): string[] {
  return (data?.choices ?? [])
    .filter((c) => c.type === "feat")
    .flatMap((c) => picks[c.id] ?? []);
}
