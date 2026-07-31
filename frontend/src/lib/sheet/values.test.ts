import { describe, expect, it } from "vitest";
import type { CharacterDetail, RulesContent } from "../../api/client";
import { buildSheetValues } from "./values";

/*
What gets printed onto the official sheet (#125).

values.ts is 304 lines of pure derivation and had no tests, in a frontend that
had no unit runner at all. Its own header says the problem out loud: everything
in it is derivation the hero sheet already does elsewhere, "done once more in
one place". That is #112 again, one implementation further along — the same AC
computed by Go, by derive.ts for the screen, and here for paper.

A divergence here is quiet and lands on paper. A player prints a sheet, brings
it to the table, and its AC disagrees with the app. Nobody notices until a hit
lands that should have missed.

So these are golden heroes: fully specified in, exact strings out. The numbers
are worked out in the comments rather than copied from a run, because a test
that records what the code did cannot tell you the code is wrong.
*/

const CHAIN_MAIL: RulesContent = {
  id: "item-chain", kind: "item", name: "Chain Mail", source: "srd", summary: "", mine: false,
  data: { type: "armor", category: "Heavy", ac: 16 },
};

const SHIELD: RulesContent = {
  id: "item-shield", kind: "item", name: "Shield", source: "srd", summary: "", mine: false,
  data: { type: "shield", acBonus: 2 },
};

const FIGHTER: RulesContent = {
  id: "cls-fighter", kind: "class", name: "Fighter", source: "srd", summary: "", mine: false,
  data: { hitDie: 10, saves: ["str", "con"] },
};

const DWARF: RulesContent = {
  id: "sp-dwarf", kind: "species", name: "Dwarf", source: "srd", summary: "", mine: false,
  data: { speed: 30 },
};

const SOLDIER: RulesContent = {
  id: "bg-soldier", kind: "background", name: "Soldier", source: "srd", summary: "", mine: false,
  data: {},
};

/** A hero, assembled the way the sheet endpoint hands one over. */
function hero(over: {
  level?: number;
  abilities?: Record<string, number>;
  skills?: string[];
  items?: Array<{ name: string; contentId?: string; slot?: string; content?: RulesContent }>;
}): CharacterDetail {
  return {
    character: {
      id: "hero-1",
      name: "Thora Hammerfall",
      class: "Dwarf Fighter",
      level: over.level ?? 5,
      hpCurrent: 44,
      hpMax: 44,
      xp: 6500,
      mine: true,
      tableBorn: false,
      ownerUserId: "u1",
      ownerName: "player",
      pendingLevels: 0,
      createdAt: "2026-07-31T00:00:00Z",
      sheet: {
        classId: FIGHTER.id,
        speciesId: DWARF.id,
        backgroundId: SOLDIER.id,
        abilities: over.abilities ?? { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
        skills: over.skills ?? ["Athletics", "Perception"],
        feats: [],
      },
    },
    items: (over.items ?? []).map((it, i) => ({
      id: `item-${i}`,
      name: it.name,
      qty: 1,
      equipped: !!it.slot,
      slot: it.slot,
      content: it.content,
    })),
  } as unknown as CharacterDetail;
}

const build = (detail: CharacterDetail) =>
  buildSheetValues({
    detail,
    classes: [FIGHTER],
    subclasses: [],
    species: [DWARF],
    backgrounds: [SOLDIER],
  });

describe("buildSheetValues", () => {
  it("prints the identity the sheet's boxes ask for", () => {
    const v = build(hero({}));
    expect(v.charName).toBe("Thora Hammerfall");
    // The real library entry wins over the Forge's freeform "Dwarf Fighter".
    expect(v.class).toBe("Fighter");
    expect(v.species).toBe("Dwarf");
    expect(v.background).toBe("Soldier");
    expect(v.level).toBe("5");
    expect(v.speed).toBe("30 ft.");
    // Level 5 of a d10 class.
    expect(v.hitDiceMax).toBe("5d10");
  });

  it("signs every ability modifier, and adds proficiency only to the saves the class has", () => {
    const v = build(hero({}));
    // STR 16 → +3, DEX 14 → +2, CHA 8 → −1. Level 5 → proficiency +3.
    expect(v.strMod).toBe("+3");
    expect(v.dexMod).toBe("+2");
    expect(v.chaMod).toBe("-1");
    expect(v.profBonus).toBe("+3");
    // A Fighter is proficient in STR and CON saves and nothing else.
    expect(v.strSave).toBe("+6");
    expect(v.conSave).toBe("+5");
    expect(v.dexSave).toBe("+2");
    expect(v.strSaveProf).toBe(true);
    expect(v.dexSaveProf).toBe(false);
  });

  it("adds proficiency to the skills the hero has, and not the rest", () => {
    const v = build(hero({}));
    // Athletics is STR (+3) and proficient (+3). Acrobatics is DEX (+2), not.
    expect(v.athletics).toBe("+6");
    expect(v.athleticsProf).toBe(true);
    expect(v.acrobatics).toBe("+2");
    expect(v.acrobaticsProf).toBe(false);
  });

  it("derives passive Perception from the skill, not from the raw ability", () => {
    const v = build(hero({}));
    // WIS 12 → +1, and Perception is proficient at level 5 → +4. 10 + 4 = 14.
    // Reading the ability alone would print 11, which is the bug worth catching.
    expect(v.passivePerception).toBe("14");
  });

  it("counts worn armour, and stops counting DEX when the armour says so", () => {
    const bare = build(hero({}));
    // Unarmoured: 10 + DEX 2.
    expect(bare.armorClass).toBe("12");

    const armoured = build(
      hero({ items: [{ name: "Chain Mail", slot: "armor", content: CHAIN_MAIL }] }),
    );
    // Chain Mail is AC 16 flat — heavy armour ignores DEX entirely.
    expect(armoured.armorClass).toBe("16");

    const withShield = build(
      hero({
        items: [
          { name: "Chain Mail", slot: "armor", content: CHAIN_MAIL },
          { name: "Shield", slot: "offhand", content: SHIELD },
        ],
      }),
    );
    // A shield adds its bonus on top: 16 + 2.
    expect(withShield.armorClass).toBe("18");
  });

  it("leaves armour in the pack out of it — carried is not worn", () => {
    const carried = build(hero({ items: [{ name: "Chain Mail", content: CHAIN_MAIL }] }));
    // No slot, so it is in the pack. Still 10 + DEX.
    expect(carried.armorClass).toBe("12");
  });

  it("moves proficiency with level, which is what makes a printed sheet go stale", () => {
    const l4 = build(hero({ level: 4 }));
    const l5 = build(hero({ level: 5 }));
    expect(l4.profBonus).toBe("+2");
    expect(l5.profBonus).toBe("+3");
    expect(l4.athletics).toBe("+5");
    expect(l5.athletics).toBe("+6");
  });

  it("gives a hero with no sheet nothing to print rather than NaN", () => {
    const freeform = hero({});
    // A quick-added hero: a name and hit points, no forged sheet behind them.
    (freeform.character as { sheet?: unknown }).sheet = undefined;
    const v = build(freeform);
    expect(v.charName).toBe("Thora Hammerfall");
    // Falls back to the freeform line the roster form captured.
    expect(v.class).toBe("Dwarf Fighter");
    expect(v.armorClass).toBe("");
    expect(v.strMod).toBeUndefined();
  });
});
