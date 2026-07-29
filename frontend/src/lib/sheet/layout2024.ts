import { ATTACK_ROWS, SKILLS, skillKey, ABILITIES } from "./fields";

/**
 * Where the ink goes on the 2024 sheet.
 *
 * Coordinates are points on US Letter (612 × 792) measured from the *top*
 * left, because that is how a person reads a page and how the calibrator
 * reports a drag; the renderer flips to PDF's bottom-left origin on the way
 * out. Nothing of Wizards' sheet is reproduced here — these are only the
 * positions our text lands on when it is printed over a copy the user
 * already has.
 *
 * The numbers below are a starting alignment. Printers drift, and different
 * releases of the sheet shift a box or two, so every position can be nudged
 * and dragged in the exporter and the result saved per browser — see
 * `prefs.ts`. A tuned map exported from the calibrator can be pasted back
 * over `LAYOUT_2024` to become the new default for everyone.
 */

export const PAGE = { width: 612, height: 792 } as const;

export type Align = "left" | "center" | "right";

export interface FieldBox {
  /** 1-based page of the sheet. */
  page: number;
  /** Left edge, points from the page's left. */
  x: number;
  /** Top edge, points from the page's top. */
  y: number;
  w: number;
  h: number;
  size?: number;
  align?: Align;
  /** Wrap across lines and shrink to fit, rather than sitting on one line. */
  para?: boolean;
}

export type SheetLayout = Record<string, FieldBox>;

function box(
  page: number,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<FieldBox> = {},
): FieldBox {
  return { page, x, y, w, h, ...extra };
}

const centred = { align: "center" as Align };

const layout: SheetLayout = {
  // — the header band —
  charName: box(1, 30, 38, 206, 24, { size: 15 }),
  class: box(1, 250, 32, 100, 16),
  background: box(1, 360, 32, 110, 16),
  playerName: box(1, 480, 32, 100, 16),
  species: box(1, 250, 64, 100, 16),
  subclass: box(1, 360, 64, 110, 16),
  level: box(1, 480, 64, 40, 16, centred),
  xp: box(1, 528, 64, 54, 16, centred),

  // — core stats, the middle column's top block —
  armorClass: box(1, 262, 116, 48, 26, { size: 14, ...centred }),
  initiative: box(1, 316, 116, 48, 26, { size: 14, ...centred }),
  speed: box(1, 370, 116, 56, 26, { size: 12, ...centred }),
  size: box(1, 262, 158, 60, 16, centred),
  profBonus: box(1, 330, 158, 44, 16, centred),
  heroicInspiration: box(1, 392, 158, 12, 12),

  // — hit points —
  hpCurrent: box(1, 262, 206, 52, 22, { size: 13, ...centred }),
  hpTemp: box(1, 320, 206, 52, 22, { size: 13, ...centred }),
  hpMax: box(1, 378, 206, 48, 22, { size: 13, ...centred }),
  hitDiceMax: box(1, 262, 248, 52, 16, centred),
  hitDiceSpent: box(1, 320, 248, 52, 16, centred),

  // — passive perception sits at the foot of the skills column —
  passivePerception: box(1, 118, 528, 40, 16, centred),

  // — the lower half —
  classFeatures: box(1, 264, 418, 320, 74, { para: true, size: 8 }),
  speciesTraits: box(1, 264, 498, 320, 52, { para: true, size: 8 }),
  feats: box(1, 264, 556, 320, 34, { para: true, size: 8 }),
  armorTraining: box(1, 30, 598, 220, 26, { para: true, size: 8 }),
  weaponProfs: box(1, 30, 632, 220, 26, { para: true, size: 8 }),
  toolProfs: box(1, 30, 666, 220, 26, { para: true, size: 8 }),
  equipment: box(1, 264, 598, 320, 92, { para: true, size: 8 }),
  coinCP: box(1, 264, 706, 44, 16, centred),
  coinSP: box(1, 326, 706, 44, 16, centred),
  coinEP: box(1, 388, 706, 44, 16, centred),
  coinGP: box(1, 450, 706, 44, 16, centred),
  coinPP: box(1, 512, 706, 44, 16, centred),

  // — the spell page —
  spellAbility: box(3, 60, 108, 100, 18, centred),
  spellMod: box(3, 180, 108, 60, 18, centred),
  spellSaveDC: box(3, 260, 108, 60, 18, centred),
  spellAtkBonus: box(3, 340, 108, 70, 18, centred),
  cantrips: box(3, 40, 158, 250, 80, { para: true, size: 9 }),
};

// The six ability blocks down the left edge: a big modifier over a small score.
ABILITIES.forEach((a, i) => {
  const top = 116 + i * 74;
  layout[`${a}Mod`] = box(1, 26, top, 74, 28, { size: 17, ...centred });
  layout[`${a}Score`] = box(1, 40, top + 34, 46, 14, { size: 10, ...centred });
});

// Saving throws: a proficiency pip and a modifier, six rows deep.
ABILITIES.forEach((a, i) => {
  const top = 134 + i * 15;
  layout[`${a}SaveProf`] = box(1, 118, top + 2, 9, 9);
  layout[`${a}Save`] = box(1, 132, top, 26, 13, { size: 9, align: "right" });
});

// Skills: the same two boxes, eighteen rows deep.
SKILLS.forEach(({ name }, i) => {
  const k = skillKey(name);
  const top = 256 + i * 15;
  layout[`${k}Prof`] = box(1, 118, top + 2, 9, 9);
  layout[k] = box(1, 132, top, 26, 13, { size: 9, align: "right" });
});

// Weapons and damage cantrips, a wide table across the lower middle.
for (let n = 1; n <= ATTACK_ROWS; n++) {
  const top = 298 + (n - 1) * 19;
  layout[`atk${n}Name`] = box(1, 264, top, 120, 14, { size: 9 });
  layout[`atk${n}Bonus`] = box(1, 388, top, 34, 14, { size: 9, ...centred });
  layout[`atk${n}Damage`] = box(1, 426, top, 78, 14, { size: 9 });
  layout[`atk${n}Notes`] = box(1, 508, top, 78, 14, { size: 8 });
}

// Nine spell-slot blocks, five down the left of the page and four down the right.
for (let lvl = 1; lvl <= 9; lvl++) {
  const col = lvl <= 5 ? 0 : 1;
  const row = (lvl - 1) % 5;
  const x = 40 + col * 280;
  const top = 260 + row * 100;
  layout[`lvl${lvl}Slots`] = box(3, x, top, 30, 16, centred);
  layout[`lvl${lvl}Spells`] = box(3, x, top + 20, 250, 74, { para: true, size: 9 });
}

export const LAYOUT_2024: SheetLayout = layout;

/** The pages the layout actually writes on, in order. */
export function layoutPages(l: SheetLayout = LAYOUT_2024): number[] {
  return [...new Set(Object.values(l).map((b) => b.page))].sort((a, b) => a - b);
}

/** Merge the calibrator's saved per-field nudges over the shipped layout. */
export function applyOverrides(
  layout: SheetLayout,
  overrides: Record<string, Partial<FieldBox>>,
): SheetLayout {
  if (!overrides || Object.keys(overrides).length === 0) return layout;
  const out: SheetLayout = { ...layout };
  for (const [id, patch] of Object.entries(overrides)) {
    if (out[id]) out[id] = { ...out[id], ...patch };
  }
  return out;
}
