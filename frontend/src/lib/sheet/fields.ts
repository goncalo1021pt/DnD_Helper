/**
 * Every box on the 2024 character sheet, named once.
 *
 * This catalogue is the seam between the three halves of the exporter: the
 * value builder fills it from a hero, the coordinate layout says where each
 * box sits on the page, and the AcroForm mapper matches it against whatever
 * a fillable PDF happens to call its fields. Add a field here and all three
 * pick it up — the layout by needing a box, the mapper by needing a match.
 *
 * Ids are ours, not Wizards'. Nothing here reproduces the sheet; it only
 * describes the shape of one, the way a stencil describes a page.
 */

export type FieldKind = "text" | "para" | "check";

export interface FieldDef {
  id: string;
  /** What a human calls this box — shown in the calibrator and the mapper. */
  label: string;
  kind: FieldKind;
  /** 1-based page of the official sheet this belongs to. */
  page: number;
  /** Grouping for the UI, so a hundred fields read as a dozen sections. */
  group: string;
  /**
   * Extra words to match against a fillable PDF's own field names. The label
   * is always tried first; these catch the abbreviations sheets actually use.
   */
  aliases?: string[];
}

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = (typeof ABILITIES)[number];

export const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

/** The eighteen skills in the order the sheet prints them, with their ability. */
export const SKILLS: Array<{ name: string; ability: AbilityKey }> = [
  { name: "Acrobatics", ability: "dex" },
  { name: "Animal Handling", ability: "wis" },
  { name: "Arcana", ability: "int" },
  { name: "Athletics", ability: "str" },
  { name: "Deception", ability: "cha" },
  { name: "History", ability: "int" },
  { name: "Insight", ability: "wis" },
  { name: "Intimidation", ability: "cha" },
  { name: "Investigation", ability: "int" },
  { name: "Medicine", ability: "wis" },
  { name: "Nature", ability: "int" },
  { name: "Perception", ability: "wis" },
  { name: "Performance", ability: "cha" },
  { name: "Persuasion", ability: "cha" },
  { name: "Religion", ability: "int" },
  { name: "Sleight of Hand", ability: "dex" },
  { name: "Stealth", ability: "dex" },
  { name: "Survival", ability: "wis" },
];

/** How many weapon/cantrip rows the attacks table gives us. */
export const ATTACK_ROWS = 6;

/** A stable key for a skill's boxes: "Sleight of Hand" -> "sleightOfHand". */
export function skillKey(name: string): string {
  const [first, ...rest] = name.split(/[^A-Za-z]+/).filter(Boolean);
  return first.toLowerCase() + rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function f(
  id: string,
  label: string,
  kind: FieldKind,
  page: number,
  group: string,
  aliases?: string[],
): FieldDef {
  return { id, label, kind, page, group, aliases };
}

const identity: FieldDef[] = [
  f("charName", "Character Name", "text", 1, "Identity", ["name", "charactername"]),
  // Sheets that carry a single "Wizard 7" line name it ClassLevel; sheets with
  // two boxes name them plainly, and the exact match on "Level" wins there.
  f("class", "Class", "text", 1, "Identity", ["classname", "classlevel"]),
  f("level", "Level", "text", 1, "Identity", ["charlevel"]),
  f("background", "Background", "text", 1, "Identity"),
  f("species", "Species", "text", 1, "Identity", ["race", "ancestry"]),
  f("subclass", "Subclass", "text", 1, "Identity", ["archetype"]),
  f("xp", "XP", "text", 1, "Identity", ["experience", "experiencepoints", "exp"]),
  f("playerName", "Player Name", "text", 1, "Identity", ["player"]),
];

const abilityFields: FieldDef[] = ABILITIES.flatMap((a) => [
  f(`${a}Score`, `${ABILITY_LABEL[a]} Score`, "text", 1, "Abilities", [a, `${a}score`]),
  f(`${a}Mod`, `${ABILITY_LABEL[a]} Modifier`, "text", 1, "Abilities", [`${a}mod`, `${a}modifier`]),
]);

const saveFields: FieldDef[] = ABILITIES.flatMap((a) => [
  f(`${a}Save`, `${ABILITY_LABEL[a]} Save`, "text", 1, "Saving Throws", [
    `${a}save`,
    `${a}savingthrow`,
    `st${a}`,
  ]),
  // A checkbox never competes with a text box (the matcher gates on kind), so
  // the bare "strsave" spelling is safe to claim here as well.
  f(`${a}SaveProf`, `${ABILITY_LABEL[a]} Save Proficient`, "check", 1, "Saving Throws", [
    `${a}saveprof`,
    `${a}save`,
    `st${a}`,
    `st${a}prof`,
    `check${a}save`,
    `savingthrow${a}`,
  ]),
]);

const skillFields: FieldDef[] = SKILLS.flatMap(({ name }) => {
  const k = skillKey(name);
  return [
    f(`${k}`, name, "text", 1, "Skills", [k, `${k}mod`]),
    f(`${k}Prof`, `${name} Proficient`, "check", 1, "Skills", [k, `${k}prof`, `check${k}`]),
  ];
});

const coreFields: FieldDef[] = [
  f("armorClass", "Armor Class", "text", 1, "Core Stats", ["ac", "armour class"]),
  f("initiative", "Initiative", "text", 1, "Core Stats", ["init", "initiativebonus"]),
  f("speed", "Speed", "text", 1, "Core Stats", ["walkingspeed"]),
  f("size", "Size", "text", 1, "Core Stats"),
  f("profBonus", "Proficiency Bonus", "text", 1, "Core Stats", ["pb", "profbonus", "proficiencybonus"]),
  f("passivePerception", "Passive Perception", "text", 1, "Core Stats", ["passive", "passiveperception"]),
  f("heroicInspiration", "Heroic Inspiration", "check", 1, "Core Stats", ["inspiration"]),
  f("hpMax", "Hit Point Maximum", "text", 1, "Hit Points", ["maxhp", "hitpointmaximum"]),
  f("hpCurrent", "Current Hit Points", "text", 1, "Hit Points", ["currenthp", "hpcurrent"]),
  f("hpTemp", "Temporary Hit Points", "text", 1, "Hit Points", ["temphp", "temporaryhitpoints"]),
  f("hitDiceMax", "Hit Dice Max", "text", 1, "Hit Points", [
    "hitdice",
    "hdtotal",
    "totalhitdice",
    "hitdicetotal",
    "hd",
  ]),
  f("hitDiceSpent", "Hit Dice Spent", "text", 1, "Hit Points", ["hdspent", "hitdicespent"]),
];

const attackFields: FieldDef[] = Array.from({ length: ATTACK_ROWS }, (_, i) => i + 1).flatMap((n) => {
  // The weapons table is where sheets disagree most: Wpn / Weapon / Atk, and a
  // first row that often carries no number at all.
  const first = n === 1 ? ["wpnname", "wpnatkbonus", "wpndamage"] : [];
  return [
    f(`atk${n}Name`, `Attack ${n} Name`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}`, `atk${n}`, `wpn${n}`, `wpnname${n}`, ...first.slice(0, 1),
    ]),
    f(`atk${n}Bonus`, `Attack ${n} Bonus`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}atk`, `atk${n}bonus`, `wpn${n}atkbonus`, ...first.slice(1, 2),
    ]),
    f(`atk${n}Damage`, `Attack ${n} Damage`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}damage`, `atk${n}damage`, `wpn${n}damage`, ...first.slice(2, 3),
    ]),
    f(`atk${n}Notes`, `Attack ${n} Notes`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}notes`, `wpn${n}notes`,
    ]),
  ];
});

const proseFields: FieldDef[] = [
  f("classFeatures", "Class Features", "para", 1, "Features", ["features", "featurestraits"]),
  f("speciesTraits", "Species Traits", "para", 1, "Features", ["racialtraits", "traits"]),
  f("feats", "Feats", "para", 1, "Features", ["feat"]),
  f("armorTraining", "Armor Training", "para", 1, "Training", [
    "armorproficiency",
    "armorproficiencies",
  ]),
  f("weaponProfs", "Weapon Proficiencies", "para", 1, "Training", [
    "weaponproficiency",
    "weaponproficiencies",
    "weapons",
  ]),
  f("toolProfs", "Tools", "para", 1, "Training", [
    "toolproficiency",
    "toolproficiencies",
    "tools",
  ]),
  f("equipment", "Equipment", "para", 1, "Equipment", ["gear", "inventory"]),
  f("coinGP", "Gold", "text", 1, "Equipment", ["gp", "gold"]),
  f("coinSP", "Silver", "text", 1, "Equipment", ["sp", "silver"]),
  f("coinCP", "Copper", "text", 1, "Equipment", ["cp", "copper"]),
  f("coinEP", "Electrum", "text", 1, "Equipment", ["ep", "electrum"]),
  f("coinPP", "Platinum", "text", 1, "Equipment", ["pp", "platinum"]),
  f("armorLight", "Light Armor Trained", "check", 1, "Training", ["lightarmor"]),
  f("armorMedium", "Medium Armor Trained", "check", 1, "Training", ["mediumarmor"]),
  f("armorHeavy", "Heavy Armor Trained", "check", 1, "Training", ["heavyarmor"]),
  f("armorShields", "Shields Trained", "check", 1, "Training", ["shield", "shields"]),
];

const spellFields: FieldDef[] = [
  f("spellAbility", "Spellcasting Ability", "text", 3, "Spellcasting", ["spellcastingability"]),
  f("spellMod", "Spellcasting Modifier", "text", 3, "Spellcasting", ["spellmod", "spellcastingmodifier"]),
  f("spellSaveDC", "Spell Save DC", "text", 3, "Spellcasting", ["savedc", "spellsavedc"]),
  f("spellAtkBonus", "Spell Attack Bonus", "text", 3, "Spellcasting", ["spellattack", "spellatkbonus"]),
  f("cantrips", "Cantrips", "para", 3, "Spellcasting", ["cantrip"]),
  ...Array.from({ length: 9 }, (_, i) => i + 1).flatMap((lvl) => [
    f(`lvl${lvl}Slots`, `Level ${lvl} Slots`, "text", 3, "Spell Slots", [
      `slots${lvl}`,
      `slotstotal${lvl}`,
      `spellslots${lvl}`,
      `sslots${lvl}`,
    ]),
    f(`lvl${lvl}Spells`, `Level ${lvl} Spells`, "para", 3, "Spell Slots", [`spells${lvl}`, `spelllevel${lvl}`]),
  ]),
];

export const FIELDS: FieldDef[] = [
  ...identity,
  ...abilityFields,
  ...saveFields,
  ...skillFields,
  ...coreFields,
  ...attackFields,
  ...proseFields,
  ...spellFields,
];

export const FIELD_BY_ID: Record<string, FieldDef> = Object.fromEntries(
  FIELDS.map((d) => [d.id, d]),
);

/**
 * Fields gathered under their group, in first-appearance order. A group's
 * fields need not be adjacent in the catalogue — Training's checkboxes sit
 * apart from its prose — so this collects rather than runs, and every group
 * name comes back exactly once.
 */
export function fieldGroups(page?: number): Array<{ group: string; fields: FieldDef[] }> {
  const out: Array<{ group: string; fields: FieldDef[] }> = [];
  const seen = new Map<string, FieldDef[]>();
  for (const def of FIELDS) {
    if (page !== undefined && def.page !== page) continue;
    let fields = seen.get(def.group);
    if (!fields) {
      fields = [];
      seen.set(def.group, fields);
      out.push({ group: def.group, fields });
    }
    fields.push(def);
  }
  return out;
}

/** Every value the exporter can print, keyed by field id. */
export type SheetValues = Record<string, string | boolean | undefined>;
