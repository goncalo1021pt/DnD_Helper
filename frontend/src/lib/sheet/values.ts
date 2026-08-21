import type { CharacterDetail, InventoryItem, RulesContent } from "../../api/client";
import { coinageOf, coinCounts, type Coin } from "../money";
import { isMulticlass, multiclassLine } from "../classes";
import { abilityMod } from "../abilities";
import { acFromEquipment, featuresOf, profBonus, weaponAttacks } from "../derive";
import {
  ABILITIES,
  ABILITY_LABEL,
  ATTACK_ROWS,
  SKILLS,
  SPELL_ROWS,
  skillKey,
  type AbilityKey,
  type SheetValues,
} from "./fields";

/**
 * A hero, flattened into the boxes of the official sheet.
 *
 * Everything here is derivation the hero sheet already does elsewhere — AC
 * from the rig, skill mods from abilities and proficiency — done once more in
 * one place and reduced to strings. Pure by design: hand it a hero and the
 * rules it points at and it hands back a value per field id, no rendering in
 * sight.
 */

export interface SheetSources {
  detail: CharacterDetail;
  /** The coins this table counts in (#195); absent means the standard ones. */
  coinage?: Coin[] | null;
  classes?: RulesContent[];
  subclasses?: RulesContent[];
  species?: RulesContent[];
  backgrounds?: RulesContent[];
}

interface ClassData {
  hitDie?: number;
  saves?: string[];
  armor?: string[];
  weapons?: string[];
  features?: Array<{ level?: number; name?: string }>;
}

/** What a class grants when it is NOT the one the hero started as (#190). */
interface MulticlassData {
  multiclass?: { proficiencies?: string[] };
}

interface SpeciesData {
  speed?: number;
  size?: string;
  traits?: Array<{ name?: string }>;
}

interface BackgroundData {
  tool?: string;
  skills?: string[];
}

interface SpellData {
  level?: number;
  castingTime?: string;
  range?: string;
  concentration?: boolean;
  ritual?: boolean;
  school?: string;
  description?: string;
}

function sign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function byId(list: RulesContent[] | undefined, id: string | null | undefined) {
  return id ? list?.find((c) => c.id === id) : undefined;
}

/** "Fireball, Magic Missile" — names joined, blanks dropped. */
function names(list: Array<string | undefined | null>): string {
  return list.filter((s): s is string => !!s && s.trim() !== "").join(", ");
}

/** "Greataxe x2" for a stack, plain name for a single. */
function itemLine(it: InventoryItem): string {
  return it.qty > 1 ? `${it.name} x${it.qty}` : it.name;
}

/**
 * "Action" -> "Actn", "Bonus Action" -> "BA" — the column is 29pt wide. The
 * "or Ritual" tail goes too; the row has a diamond that already says so.
 */
function shortTime(time: string): string {
  const t = time.replace(/\s*or\s+ritual\s*$/i, "").trim();
  if (/^bonus/i.test(t)) return "BA";
  if (/^reaction/i.test(t)) return "Rxn";
  if (/^action/i.test(t)) return "Actn";
  return t.replace(/minutes?/i, "min").replace(/hours?/i, "hr");
}

/** "Self (30-foot cone)" -> "Self"; "120 feet" -> "120 ft". */
function shortRange(range: string): string {
  const r = range.trim();
  if (/^self/i.test(r)) return "Self";
  if (/^touch/i.test(r)) return "Touch";
  return r.replace(/\s*feet\b/i, " ft").replace(/\s*miles?\b/i, " mi");
}

/**
 * The die and type a damage cantrip rolls, read off its description — the
 * sheet lists damage cantrips beside weapons, and the rules text is the only
 * place the number lives.
 */
function cantripDamage(spell: RulesContent): { damage: string; type: string } {
  const text = String((spell.data as SpellData).description ?? spell.summary ?? "");
  const m = text.match(/(\d+d\d+)\s+(\w+)\s+damage/i);
  if (m) return { damage: m[1], type: m[2] };
  const die = text.match(/(\d+d\d+)/);
  return { damage: die?.[1] ?? "", type: "" };
}

/** Split a list of names down the middle, for the sheet's two-column panels. */
function halve(list: string[]): [string, string] {
  const cut = Math.ceil(list.length / 2);
  return [names(list.slice(0, cut)), names(list.slice(cut))];
}

export function buildSheetValues({
  detail,
  coinage,
  classes,
  subclasses,
  species,
  backgrounds,
}: SheetSources): SheetValues {
  const ladder = coinageOf(coinage);
  const character = detail.character;
  const sheet = character.sheet;
  const v: SheetValues = {};

  const klass = byId(classes, sheet?.classId);
  const subclass = byId(subclasses, sheet?.subclassId);
  const race = byId(species, sheet?.speciesId);
  const background = byId(backgrounds, sheet?.backgroundId);

  const classData = (klass?.data ?? {}) as ClassData;
  const speciesData = (race?.data ?? {}) as SpeciesData;
  const backgroundData = (background?.data ?? {}) as BackgroundData;

  const prof = profBonus(character.level);
  const abilities = sheet?.abilities;

  // — identity —
  v.charName = character.name;
  // The Forge writes "Half-Elf Bard" into class; prefer the real entry when we
  // have one, and fall back to that freeform line for hand-rolled heroes. A
  // multiclassed hero gets the breakdown instead (#190) — the box is labelled
  // "Class & Level" on the real sheet, and one class name there would be a lie.
  v.class = isMulticlass(character)
    ? multiclassLine(character)
    : klass?.name ?? character.class;
  v.level = String(character.level);
  v.background = background?.name ?? "";
  v.species = race?.name ?? "";
  v.subclass = subclass?.name ?? "";
  v.xp = character.xp !== undefined ? String(character.xp) : "";

  // — abilities, saves, skills —
  const proficientSaves = new Set((classData.saves ?? []).map((s) => s.toLowerCase()));
  const proficientSkills = new Set(sheet?.skills ?? []);

  for (const a of ABILITIES) {
    const score = abilities?.[a];
    if (!score) continue;
    const mod = abilityMod(score);
    v[`${a}Score`] = String(score);
    v[`${a}Mod`] = sign(mod);
    const saveProf = proficientSaves.has(a);
    v[`${a}Save`] = sign(mod + (saveProf ? prof : 0));
    v[`${a}SaveProf`] = saveProf;
  }

  const skillMod = (ability: AbilityKey, name: string) =>
    abilityMod(abilities?.[ability] ?? 10) + (proficientSkills.has(name) ? prof : 0);

  if (abilities) {
    for (const { name, ability } of SKILLS) {
      const k = skillKey(name);
      v[k] = sign(skillMod(ability, name));
      v[`${k}Prof`] = proficientSkills.has(name);
    }
    v.passivePerception = String(10 + skillMod("wis", "Perception"));
  }

  // — core stats —
  // The same features the screen reads, so an Unarmored Defense that changed
  // the AC on the sheet changes it on the printout too (#132).
  //
  // All four sheet columns, not just class and subclass: the SRD only puts an
  // unarmoredDefense on a class or a subclass, but content packs are additive,
  // and a homebrew species that shipped one used to raise the AC on screen and
  // not on the page (#153). The server derives it from the same four.
  const acFeatures = [klass, subclass, race, background].flatMap((src) =>
    featuresOf(src, character.level),
  );
  v.armorClass = abilities ? String(acFromEquipment(detail.items, abilities, acFeatures)) : "";
  v.shield = detail.items.some(
    (i) => i.equipped && ((i.content?.data ?? {}) as { type?: string }).type === "shield",
  );
  v.initiative = abilities ? sign(abilityMod(abilities.dex)) : "";
  v.speed = speciesData.speed ? `${speciesData.speed} ft.` : "";
  v.size = speciesData.size ?? "";
  v.profBonus = sign(prof);
  v.hpMax = String(character.hpMax);
  v.hpCurrent = String(character.hpCurrent);
  v.hpTemp = "";
  // Hit dice pooled per die size (#190): "5d10 + 5d8" for a Cleric/Paladin,
  // and the plain "5d10" every single-classed hero has always printed.
  const dice = character.hitDice ?? [];
  v.hitDiceMax = dice.length
    ? dice.filter((d) => d.max > 0).map((d) => `${d.max}d${d.die}`).join(" + ")
    : classData.hitDie
      ? `${character.level}d${classData.hitDie}`
      : "";
  v.hitDiceSpent = dice.some((d) => d.used > 0)
    ? dice.filter((d) => d.used > 0).map((d) => `${d.used}d${d.die}`).join(" + ")
    : "";
  v.heroicInspiration = false;

  // — weapons and damage cantrips —
  const allSpells = detail.spells ?? [];
  const attacks = abilities ? weaponAttacks(detail.items, abilities, character.level) : [];
  const castMod = sheet?.spellcastingAbility
    ? abilityMod(abilities?.[sheet.spellcastingAbility.toLowerCase() as AbilityKey] ?? 10)
    : 0;
  const cantrips = allSpells.filter((s) => ((s.data as SpellData).level ?? 0) === 0);
  const damageCantrips = cantrips.filter((c) => cantripDamage(c).damage !== "");

  const rows: Array<{ name: string; bonus: string; damage: string; notes: string }> = [
    ...attacks.map((a) => ({
      name: a.name,
      bonus: sign(a.bonus),
      damage: `${a.damage} ${a.damageType}`.trim(),
      notes: "",
    })),
    ...damageCantrips.map((c) => {
      const { damage, type } = cantripDamage(c);
      return {
        name: c.name,
        bonus: sheet?.spellcastingAbility ? sign(castMod + prof) : "",
        damage: `${damage} ${type}`.trim(),
        notes: "Cantrip",
      };
    }),
  ];

  rows.slice(0, ATTACK_ROWS).forEach((r, i) => {
    const n = i + 1;
    v[`atk${n}Name`] = r.name;
    v[`atk${n}Bonus`] = r.bonus;
    v[`atk${n}Damage`] = r.damage;
    v[`atk${n}Notes`] = r.notes;
  });

  // — features, traits, feats —
  const featureNames = (src: RulesContent | undefined) =>
    ((src?.data as ClassData)?.features ?? [])
      .filter((ft) => (ft.level ?? 1) <= character.level)
      .map((ft) => ft.name)
      .filter((n): n is string => !!n);

  const [featuresLeft, featuresRight] = halve([...featureNames(klass), ...featureNames(subclass)]);
  v.classFeatures = featuresLeft;
  v.classFeatures2 = featuresRight;
  v.speciesTraits = names([
    ...(speciesData.traits ?? []).map((t) => t.name),
    ...Object.values(sheet?.speciesChoices ?? {}).flat(),
  ]);
  v.feats = names(sheet?.feats ?? []);

  /*
    Equipment training, pooled across every class the hero holds (#190).

    A second class grants only part of its starting proficiencies, and which
    part is content — data.multiclass.proficiencies, worded as the class's own
    "As a Multiclass Character" list. The starting class grants its whole set,
    which is the one thing that makes it the starting class.

    Falls back to the single class's data for a hero whose class rows have not
    been read, so the printed sheet never comes back emptier than before.
  */
  const heldClasses = character.sheet?.classes ?? [];
  const armor = new Set<string>();
  const weapons: string[] = [];
  if (heldClasses.length) {
    for (const k of heldClasses) {
      const entry = byId(classes, k.classId);
      const d = (entry?.data ?? {}) as ClassData & MulticlassData;
      if (k.starting) {
        for (const a of d.armor ?? []) armor.add(a.toLowerCase());
        for (const w of d.weapons ?? []) if (!weapons.includes(w)) weapons.push(w);
        continue;
      }
      for (const line of d.multiclass?.proficiencies ?? []) {
        const low = line.toLowerCase();
        for (const kind of ["light", "medium", "heavy", "shield"]) {
          if (low.includes(kind)) armor.add(kind);
        }
        // "proficiency with Martial weapons" → the weapon column.
        const weapon = line.match(/\b(simple|martial)\b/i);
        if (weapon && !weapons.some((w) => w.toLowerCase() === weapon[1].toLowerCase())) {
          weapons.push(weapon[1][0].toUpperCase() + weapon[1].slice(1).toLowerCase());
        }
      }
    }
  } else {
    for (const a of classData.armor ?? []) armor.add(a.toLowerCase());
    weapons.push(...(classData.weapons ?? []));
  }
  const has = (kind: string) => [...armor].some((a) => a.startsWith(kind));
  v.armorLight = has("light");
  v.armorMedium = has("medium");
  v.armorHeavy = has("heavy");
  v.armorShields = has("shield");
  v.weaponProfs = names(weapons);
  v.toolProfs = names([backgroundData.tool]);

  // — the pack —
  //
  // The official sheet has five coin cells, printed CP/SP/EP/GP/PP on Wizards'
  // artwork, and a table may count in coins of its own (#195). They are filled
  // by RANK — smallest coin in the leftmost cell — and the printed labels are
  // left alone: a DM running glimmer and crowns knows which column is which,
  // and painting over the artwork to correct it would read as damage.
  //
  // A ladder shorter than five leaves the upper cells empty; a longer one
  // spills its largest coins into the last cell as a single count, which is
  // the only honest thing five boxes can say about six coins.
  const purse = detail.items.find((i) => i.isPurse);
  const cells: (keyof SheetValues)[] = ["coinCP", "coinSP", "coinEP", "coinGP", "coinPP"];
  for (const cell of cells) v[cell] = "";
  if (purse) {
    const counted = coinCounts(purse.qty, ladder);
    counted.slice(0, cells.length).forEach((n, i) => {
      const cell = cells[i];
      // The last cell carries whatever is left over on a long ladder.
      const carry = i === cells.length - 1 ? counted.slice(i).reduce((a, b) => a + b, 0) : n;
      v[cell] = carry > 0 ? String(carry) : "";
    });
  }
  v.equipment = detail.items
    .filter((i) => i.id !== purse?.id)
    .map(itemLine)
    .join(", ");

  // — spellcasting —
  if (sheet?.spellcastingAbility) {
    const key = sheet.spellcastingAbility.toLowerCase() as AbilityKey;
    v.spellAbility = ABILITY_LABEL[key] ?? sheet.spellcastingAbility;
    v.spellMod = sign(castMod);
    v.spellSaveDC = String(8 + prof + castMod);
    v.spellAtkBonus = sign(prof + castMod);
  }

  for (const slot of sheet?.spellSlots ?? []) {
    if (slot.level >= 1 && slot.level <= 9) v[`lvl${slot.level}Slots`] = String(slot.max);
  }

  // Cantrips first, then by level, then alphabetically — the order the table
  // reads best in, and the order a player would write them.
  const ordered = [...allSpells].sort((a, b) => {
    const la = (a.data as SpellData).level ?? 0;
    const lb = (b.data as SpellData).level ?? 0;
    return la - lb || a.name.localeCompare(b.name);
  });

  ordered.slice(0, SPELL_ROWS).forEach((spell, i) => {
    const n = i + 1;
    const data = spell.data as SpellData;
    const lvl = data.level ?? 0;
    v[`spell${n}Level`] = lvl === 0 ? "C" : String(lvl);
    v[`spell${n}Name`] = spell.name;
    v[`spell${n}Time`] = data.castingTime ? shortTime(data.castingTime) : "";
    v[`spell${n}Range`] = data.range ? shortRange(data.range) : "";
    v[`spell${n}Conc`] = !!data.concentration;
    v[`spell${n}Ritual`] = !!data.ritual;
    v[`spell${n}Notes`] = data.school ?? "";
  });

  return v;
}
