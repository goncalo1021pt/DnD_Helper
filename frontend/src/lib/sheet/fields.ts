/**
 * Every box on the official 2024 character sheet, named once.
 *
 * This catalogue is the seam between the three halves of the exporter: the
 * value builder fills it from a hero, the coordinate layout says where each
 * box sits on the page, and the AcroForm mapper matches it against whatever
 * a fillable PDF happens to call its fields. Add a field here and all three
 * pick it up — the layout by needing a box, the mapper by needing a match.
 *
 * The shape of it follows the real sheet: skills grouped under the ability
 * that governs them rather than alphabetically, six weapon rows, thirty rows
 * of spells with their casting time and range, and diamonds for the things
 * the sheet asks you to tick. Ids are ours, not Wizards'. Nothing here
 * reproduces the sheet; it only describes the shape of one.
 */

export type FieldKind = "text" | "para" | "check";

export interface FieldDef {
  id: string;
  /** What a human calls this box — shown in the calibrator and the mapper. */
  label: string;
  kind: FieldKind;
  /** 1-based page of the official sheet this belongs to. */
  page: number;
  /** Grouping for the UI, so hundreds of fields read as a dozen sections. */
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

/**
 * The eighteen skills, filed under the ability that governs them and in the
 * order the sheet prints them — Strength's one, Dexterity's three, and so on
 * down the two columns.
 */
export const SKILLS_BY_ABILITY: Record<AbilityKey, string[]> = {
  str: ["Athletics"],
  dex: ["Acrobatics", "Sleight of Hand", "Stealth"],
  con: [],
  int: ["Arcana", "History", "Investigation", "Nature", "Religion"],
  wis: ["Animal Handling", "Insight", "Medicine", "Perception", "Survival"],
  cha: ["Deception", "Intimidation", "Performance", "Persuasion"],
};

export const SKILLS: Array<{ name: string; ability: AbilityKey }> = ABILITIES.flatMap((a) =>
  SKILLS_BY_ABILITY[a].map((name) => ({ name, ability: a })),
);

/** Weapon rows on the sheet's Weapons & Damage Cantrips table. */
export const ATTACK_ROWS = 6;

/** Rows in the Cantrips & Prepared Spells table. */
export const SPELL_ROWS = 30;

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
  f("background", "Background", "text", 1, "Identity"),
  f("class", "Class", "text", 1, "Identity", ["classname", "classlevel"]),
  f("species", "Species", "text", 1, "Identity", ["race", "ancestry"]),
  f("subclass", "Subclass", "text", 1, "Identity", ["archetype"]),
  f("level", "Level", "text", 1, "Identity", ["charlevel"]),
  f("xp", "XP", "text", 1, "Identity", ["experience", "experiencepoints", "exp"]),
];

const abilityFields: FieldDef[] = ABILITIES.flatMap((a) => [
  f(`${a}Mod`, `${ABILITY_LABEL[a]} Modifier`, "text", 1, "Abilities", [`${a}mod`, `${a}modifier`]),
  f(`${a}Score`, `${ABILITY_LABEL[a]} Score`, "text", 1, "Abilities", [a, `${a}score`]),
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
  f("shield", "Shield", "check", 1, "Core Stats", ["hasshield"]),
  f("initiative", "Initiative", "text", 1, "Core Stats", ["init", "initiativebonus"]),
  f("speed", "Speed", "text", 1, "Core Stats", ["walkingspeed"]),
  f("size", "Size", "text", 1, "Core Stats"),
  f("profBonus", "Proficiency Bonus", "text", 1, "Core Stats", ["pb", "profbonus", "proficiencybonus"]),
  f("passivePerception", "Passive Perception", "text", 1, "Core Stats", ["passive", "passiveperception"]),
  f("heroicInspiration", "Heroic Inspiration", "check", 1, "Core Stats", ["inspiration"]),
  f("hpCurrent", "Current Hit Points", "text", 1, "Hit Points", ["currenthp", "hpcurrent"]),
  f("hpTemp", "Temporary Hit Points", "text", 1, "Hit Points", ["temphp", "temporaryhitpoints"]),
  f("hpMax", "Hit Point Maximum", "text", 1, "Hit Points", ["maxhp", "hitpointmaximum"]),
  f("hitDiceSpent", "Hit Dice Spent", "text", 1, "Hit Points", ["hdspent", "hitdicespent"]),
  f("hitDiceMax", "Hit Dice Max", "text", 1, "Hit Points", [
    "hitdice",
    "hdtotal",
    "totalhitdice",
    "hitdicetotal",
    "hd",
  ]),
];

const attackFields: FieldDef[] = Array.from({ length: ATTACK_ROWS }, (_, i) => i + 1).flatMap((n) => {
  // The weapons table is where sheets disagree most: Wpn / Weapon / Atk, and a
  // first row that often carries no number at all.
  const first = n === 1 ? ["wpnname", "wpnatkbonus", "wpndamage"] : [];
  return [
    f(`atk${n}Name`, `Weapon ${n} Name`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}`, `atk${n}`, `wpn${n}`, `wpnname${n}`, ...first.slice(0, 1),
    ]),
    f(`atk${n}Bonus`, `Weapon ${n} Atk Bonus`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}atk`, `atk${n}bonus`, `wpn${n}atkbonus`, ...first.slice(1, 2),
    ]),
    f(`atk${n}Damage`, `Weapon ${n} Damage`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}damage`, `atk${n}damage`, `wpn${n}damage`, ...first.slice(2, 3),
    ]),
    f(`atk${n}Notes`, `Weapon ${n} Notes`, "text", 1, "Weapons & Cantrips", [
      `weapon${n}notes`, `wpn${n}notes`,
    ]),
  ];
});

const panelFields: FieldDef[] = [
  // The sheet rules Class Features into two columns; the list is split to match.
  f("classFeatures", "Class Features (left)", "para", 1, "Features", ["features", "featurestraits"]),
  f("classFeatures2", "Class Features (right)", "para", 1, "Features", ["features2"]),
  f("speciesTraits", "Species Traits", "para", 1, "Features", ["racialtraits", "traits"]),
  f("feats", "Feats", "para", 1, "Features", ["feat"]),
  f("armorLight", "Light Armor Trained", "check", 1, "Training", ["lightarmor"]),
  f("armorMedium", "Medium Armor Trained", "check", 1, "Training", ["mediumarmor"]),
  f("armorHeavy", "Heavy Armor Trained", "check", 1, "Training", ["heavyarmor"]),
  f("armorShields", "Shields Trained", "check", 1, "Training", ["shieldtraining", "shields"]),
  f("weaponProfs", "Weapon Proficiencies", "para", 1, "Training", [
    "weaponproficiency",
    "weaponproficiencies",
    "weapons",
  ]),
  f("toolProfs", "Tools", "para", 1, "Training", ["toolproficiency", "toolproficiencies", "tools"]),
];

const spellcasting: FieldDef[] = [
  f("spellAbility", "Spellcasting Ability", "text", 2, "Spellcasting", ["spellcastingability"]),
  f("spellMod", "Spellcasting Modifier", "text", 2, "Spellcasting", ["spellmod", "spellcastingmodifier"]),
  f("spellSaveDC", "Spell Save DC", "text", 2, "Spellcasting", ["savedc", "spellsavedc"]),
  f("spellAtkBonus", "Spell Attack Bonus", "text", 2, "Spellcasting", ["spellattack", "spellatkbonus"]),
  ...Array.from({ length: 9 }, (_, i) => i + 1).map((lvl) =>
    f(`lvl${lvl}Slots`, `Level ${lvl} Slots`, "text", 2, "Spell Slots", [
      `slots${lvl}`,
      `slotstotal${lvl}`,
      `spellslots${lvl}`,
      `sslots${lvl}`,
    ]),
  ),
];

const spellRows: FieldDef[] = Array.from({ length: SPELL_ROWS }, (_, i) => i + 1).flatMap((n) => [
  f(`spell${n}Level`, `Spell ${n} Level`, "text", 2, "Prepared Spells", [`spelllevel${n}`]),
  f(`spell${n}Name`, `Spell ${n} Name`, "text", 2, "Prepared Spells", [`spellname${n}`, `spells${n}`]),
  f(`spell${n}Time`, `Spell ${n} Casting Time`, "text", 2, "Prepared Spells", [`castingtime${n}`]),
  f(`spell${n}Range`, `Spell ${n} Range`, "text", 2, "Prepared Spells", [`spellrange${n}`]),
  f(`spell${n}Conc`, `Spell ${n} Concentration`, "check", 2, "Prepared Spells", [`concentration${n}`]),
  f(`spell${n}Ritual`, `Spell ${n} Ritual`, "check", 2, "Prepared Spells", [`ritual${n}`]),
  f(`spell${n}Notes`, `Spell ${n} Notes`, "text", 2, "Prepared Spells", [`spellnotes${n}`]),
]);

const gearFields: FieldDef[] = [
  f("equipment", "Equipment", "para", 2, "Equipment", ["gear", "inventory"]),
  f("coinCP", "Copper", "text", 2, "Coins", ["cp", "copper"]),
  f("coinSP", "Silver", "text", 2, "Coins", ["sp", "silver"]),
  f("coinEP", "Electrum", "text", 2, "Coins", ["ep", "electrum"]),
  f("coinGP", "Gold", "text", 2, "Coins", ["gp", "gold"]),
  f("coinPP", "Platinum", "text", 2, "Coins", ["pp", "platinum"]),
];

export const FIELDS: FieldDef[] = [
  ...identity,
  ...abilityFields,
  ...saveFields,
  ...skillFields,
  ...coreFields,
  ...attackFields,
  ...panelFields,
  ...spellcasting,
  ...spellRows,
  ...gearFields,
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
