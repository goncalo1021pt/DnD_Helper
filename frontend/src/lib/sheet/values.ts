import type { CharacterDetail, InventoryItem, RulesContent } from "../../api/client";
import { abilityMod } from "../../components/ui/AbilityRow";
import { acFromEquipment, profBonus, weaponAttacks } from "../derive";
import {
  ABILITIES,
  ABILITY_LABEL,
  ATTACK_ROWS,
  SKILLS,
  skillKey,
  type AbilityKey,
  type SheetValues,
} from "./fields";

/**
 * A hero, flattened into the boxes of a character sheet.
 *
 * Everything here is derivation the sheet already does elsewhere — AC from the
 * rig, skill mods from abilities and proficiency — done once more in one place
 * and reduced to strings. Pure by design: hand it a hero and the rules it
 * points at and it hands back a value per field id, no rendering in sight.
 */

export interface SheetSources {
  detail: CharacterDetail;
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

interface SpeciesData {
  speed?: number;
  size?: string;
  traits?: Array<{ name?: string }>;
}

interface BackgroundData {
  tool?: string;
  skills?: string[];
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

/** "Greataxe ×2" for a stack, plain name for a single. */
function itemLine(it: InventoryItem): string {
  return it.qty > 1 ? `${it.name} ×${it.qty}` : it.name;
}

/**
 * The die and type a damage cantrip rolls, read off its description — the
 * 2024 sheet lists damage cantrips beside weapons, and the rules text is the
 * only place the number lives.
 */
function cantripDamage(spell: RulesContent): { damage: string; type: string } {
  const text = String((spell.data as { description?: string }).description ?? spell.summary ?? "");
  const m = text.match(/(\d+d\d+)\s+(\w+)\s+damage/i);
  if (m) return { damage: m[1], type: m[2] };
  const die = text.match(/(\d+d\d+)/);
  return { damage: die?.[1] ?? "", type: "" };
}

export function buildSheetValues({
  detail,
  classes,
  subclasses,
  species,
  backgrounds,
}: SheetSources): SheetValues {
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
  // have one, and fall back to that freeform line for hand-rolled heroes.
  v.class = klass?.name ?? character.class;
  v.level = String(character.level);
  v.background = background?.name ?? "";
  v.species = race?.name ?? "";
  v.subclass = subclass?.name ?? "";
  v.xp = character.xp !== undefined ? String(character.xp) : "";
  v.playerName = character.ownerName;

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
  v.armorClass = abilities ? String(acFromEquipment(detail.items, abilities)) : "";
  v.initiative = abilities ? sign(abilityMod(abilities.dex)) : "";
  v.speed = speciesData.speed ? `${speciesData.speed} ft.` : "";
  v.size = speciesData.size ?? "";
  v.profBonus = sign(prof);
  v.hpMax = String(character.hpMax);
  v.hpCurrent = String(character.hpCurrent);
  v.hpTemp = "";
  v.hitDiceMax = classData.hitDie ? `${character.level}d${classData.hitDie}` : "";
  v.hitDiceSpent = "";
  v.heroicInspiration = false;

  // — weapons and damage cantrips —
  const attacks = abilities ? weaponAttacks(detail.items, abilities, character.level) : [];
  const spellMod = sheet?.spellcastingAbility
    ? abilityMod(abilities?.[sheet.spellcastingAbility.toLowerCase() as AbilityKey] ?? 10)
    : 0;
  const cantrips = (detail.spells ?? []).filter((s) => ((s.data as { level?: number }).level ?? 0) === 0);

  const rows: Array<{ name: string; bonus: string; damage: string; notes: string }> = [
    ...attacks.map((a) => ({
      name: a.name,
      bonus: sign(a.bonus),
      damage: `${a.damage} ${a.damageType}`.trim(),
      notes: "",
    })),
    ...cantrips.map((c) => {
      const { damage, type } = cantripDamage(c);
      return {
        name: c.name,
        bonus: sheet?.spellcastingAbility ? sign(spellMod + prof) : "",
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
      .map((ft) => ft.name);

  v.classFeatures = names([...featureNames(klass), ...featureNames(subclass)]);
  v.speciesTraits = names([
    ...(speciesData.traits ?? []).map((t) => t.name),
    ...Object.values(sheet?.speciesChoices ?? {}).flat(),
  ]);
  v.feats = names(sheet?.feats ?? []);

  // — training —
  const armor = classData.armor ?? [];
  const has = (kind: string) => armor.some((a) => a.toLowerCase().startsWith(kind));
  v.armorLight = has("light");
  v.armorMedium = has("medium");
  v.armorHeavy = has("heavy");
  v.armorShields = has("shield");
  v.armorTraining = names(armor);
  v.weaponProfs = names(classData.weapons ?? []);
  v.toolProfs = names([backgroundData.tool]);

  // — the pack —
  const purse = detail.items.find((i) => !i.content && i.name === "Gold Pieces");
  v.coinGP = purse ? String(purse.qty) : "";
  v.coinCP = "";
  v.coinSP = "";
  v.coinEP = "";
  v.coinPP = "";
  v.equipment = detail.items
    .filter((i) => i.id !== purse?.id)
    .map(itemLine)
    .join(", ");

  // — spellcasting —
  if (sheet?.spellcastingAbility) {
    const key = sheet.spellcastingAbility.toLowerCase() as AbilityKey;
    v.spellAbility = ABILITY_LABEL[key] ?? sheet.spellcastingAbility;
    v.spellMod = sign(spellMod);
    v.spellSaveDC = String(8 + prof + spellMod);
    v.spellAtkBonus = sign(prof + spellMod);
  }

  v.cantrips = names(cantrips.map((c) => c.name));

  const slotByLevel = new Map((sheet?.spellSlots ?? []).map((s) => [s.level, s]));
  for (let lvl = 1; lvl <= 9; lvl++) {
    const slot = slotByLevel.get(lvl);
    v[`lvl${lvl}Slots`] = slot ? String(slot.max) : "";
    v[`lvl${lvl}Spells`] = names(
      (detail.spells ?? [])
        .filter((s) => ((s.data as { level?: number }).level ?? 0) === lvl)
        .map((s) => s.name),
    );
  }

  return v;
}
