import { ABILITIES, ATTACK_ROWS, SKILLS_BY_ABILITY, SPELL_ROWS, skillKey } from "./fields";

/**
 * Where the ink goes on the official 2024 character sheet.
 *
 * These are measurements, not guesses. Every number below was read off the
 * sheet Wizards publishes: the ruled write-on lines and the proficiency
 * circles were found by scanning the page, and the panels were measured
 * against a coordinate grid laid over it. The sheet's own page box is
 * 603 × 774 points — a little under US Letter — and that is the frame these
 * coordinates live in; the renderer rescales if you feed it a backdrop of a
 * different size.
 *
 * Coordinates are points from the *top* left, because that is how a person
 * reads a page and how the calibrator reports a drag; the renderer flips to
 * PDF's bottom-left origin on the way out. Nothing of Wizards' artwork is
 * reproduced here — these are only the positions our text lands on when it is
 * printed over a copy the user already has.
 *
 * Printers still drift, so every position can be nudged and dragged in the
 * exporter and the result saved per browser — see `prefs.ts`.
 */

export const PAGE = { width: 603, height: 774 } as const;

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

const mid = { align: "center" as Align };

/**
 * A value written on one of the sheet's ruled lines: the box sits just above
 * the rule so the text rests on it the way handwriting would.
 */
function onRule(page: number, x: number, ruleY: number, w: number, extra: Partial<FieldBox> = {}) {
  return box(page, x, ruleY - 13, w, 13, extra);
}

/** A diamond or circle to tick. The sheet's are 6.5–8pt across. */
function tick(page: number, cx: number, cy: number, size = 7) {
  return box(page, cx - size / 2, cy - size / 2, size, size);
}

const layout: SheetLayout = {
  // ── page 1, the header band ──────────────────────────────────────────────
  charName: onRule(1, 25, 29.8, 225, { size: 15 }),
  background: onRule(1, 25, 51.0, 117),
  class: onRule(1, 149, 51.0, 97),
  species: onRule(1, 25, 72.8, 117),
  subclass: onRule(1, 149, 72.8, 106),
  level: onRule(1, 259, 46.2, 30, { ...mid, size: 13 }),
  xp: onRule(1, 257, 67.8, 38, { ...mid, size: 9 }),

  // Armour class sits inside the shield; the little diamond below it is the
  // sheet's "am I carrying a shield" tick.
  armorClass: box(1, 315, 32, 47, 28, { size: 20, ...mid }),
  shield: tick(1, 340, 76, 8),

  // Hit points: a tall CURRENT on the left, TEMP over MAX on the right.
  hpCurrent: onRule(1, 383, 71, 45, { size: 15, ...mid }),
  hpTemp: box(1, 437, 28, 44, 20, { size: 12, ...mid }),
  hpMax: onRule(1, 437, 71, 44, { size: 12, ...mid }),
  hitDiceSpent: box(1, 494, 28, 40, 20, { size: 11, ...mid }),
  hitDiceMax: onRule(1, 493, 71, 38, { size: 11, ...mid }),

  // ── the four titled boxes under the banner ───────────────────────────────
  // Each has its title underlined, and the value is written in the open area
  // below that rule.
  initiative: box(1, 226.5, 130, 72, 19, { size: 14, ...mid }),
  speed: box(1, 318, 130, 78, 19, { size: 13, ...mid }),
  size: box(1, 415.5, 130, 72, 19, { size: 12, ...mid }),
  passivePerception: box(1, 507, 130, 80, 19, { size: 14, ...mid }),
  profBonus: box(1, 40, 136, 33, 30, { size: 16, ...mid }),

  heroicInspiration: tick(1, 57.3, 592, 9),

  // ── equipment training & proficiencies ───────────────────────────────────
  armorLight: tick(1, 63, 649),
  armorMedium: tick(1, 97, 649),
  armorHeavy: tick(1, 141.5, 649),
  armorShields: tick(1, 178.5, 649),
  weaponProfs: box(1, 18, 668, 189, 46, { para: true, size: 8 }),
  toolProfs: box(1, 18, 729, 189, 30, { para: true, size: 8 }),

  // ── the right-hand panels ────────────────────────────────────────────────
  classFeatures: box(1, 231, 352, 172, 196, { para: true, size: 7.5 }),
  classFeatures2: box(1, 411, 352, 172, 196, { para: true, size: 7.5 }),
  speciesTraits: box(1, 231, 593, 158, 158, { para: true, size: 7.5 }),
  feats: box(1, 415, 593, 170, 158, { para: true, size: 7.5 }),

  // ── page 2, spellcasting ─────────────────────────────────────────────────
  spellAbility: onRule(2, 25, 32.5, 108, { size: 11 }),
  spellMod: box(2, 14, 48, 33, 22, { size: 13, ...mid }),
  spellSaveDC: box(2, 14, 75, 33, 22, { size: 13, ...mid }),
  spellAtkBonus: box(2, 14, 102, 33, 22, { size: 13, ...mid }),

  // ── page 2, equipment and coins ──────────────────────────────────────────
  equipment: box(2, 414, 427, 171, 172, { para: true, size: 8 }),
  // The five coin cells, measured between their own borders.
  coinCP: box(2, 413, 704, 30.5, 19, { size: 11, ...mid }),
  coinSP: box(2, 448.6, 704, 31, 19, { size: 11, ...mid }),
  coinEP: box(2, 484.3, 704, 31.4, 19, { size: 11, ...mid }),
  coinGP: box(2, 519.7, 704, 31, 19, { size: 11, ...mid }),
  coinPP: box(2, 553.6, 704, 32, 19, { size: 11, ...mid }),
};

/**
 * The six ability blocks: a big modifier in the ring, the score in the folded
 * tab beside it. Three run down the far-left column, three down the second,
 * and their vertical positions are the measured ring centres.
 */
const ABILITY_RING: Record<string, { cx: number; cy: number; scoreX: number }> = {
  str: { cx: 43, cy: 223, scoreX: 63 },
  dex: { cx: 43, cy: 341, scoreX: 63 },
  con: { cx: 43, cy: 487, scoreX: 63 },
  int: { cx: 149.5, cy: 144.5, scoreX: 169.5 },
  wis: { cx: 149.5, cy: 318.5, scoreX: 169.5 },
  cha: { cx: 149.5, cy: 493, scoreX: 169.5 },
};

for (const a of ABILITIES) {
  const { cx, cy, scoreX } = ABILITY_RING[a];
  layout[`${a}Mod`] = box(1, cx - 18, cy - 15, 36, 30, { size: 19, ...mid });
  layout[`${a}Score`] = box(1, scoreX, cy - 9, 27, 22, { size: 11, ...mid });
}

/**
 * Saving throws and skills. Each row is a proficiency circle and a short rule
 * for the modifier; the circle centres below were found by scanning the page,
 * and the rule sits 3.7pt under each one.
 */
const SAVE_ROW: Record<string, number> = {
  str: 265.2, dex: 383.2, con: 529.2, int: 188.0, wis: 361.8, cha: 535.8,
};
const SKILL_ROWS: Record<string, number[]> = {
  str: [284.8],
  dex: [402.8, 416.8, 430.8],
  con: [],
  int: [207.5, 221.8, 235.8, 249.8, 263.8],
  wis: [381.5, 395.8, 409.8, 423.8, 437.8],
  cha: [555.2, 569.2, 583.2, 597.5],
};
/** Left-hand column for STR/DEX/CON, second column for INT/WIS/CHA. */
const ROW_X: Record<string, { circle: number; rule: number }> = {
  str: { circle: 21.25, rule: 27.5 },
  dex: { circle: 21.25, rule: 27.5 },
  con: { circle: 21.25, rule: 27.5 },
  int: { circle: 127.75, rule: 134 },
  wis: { circle: 127.75, rule: 134 },
  cha: { circle: 127.75, rule: 134 },
};

for (const a of ABILITIES) {
  const { circle, rule } = ROW_X[a];
  const modBox = (cy: number) => box(1, rule, cy - 6.5, 17.5, 11, { size: 9, ...mid });
  layout[`${a}SaveProf`] = tick(1, circle, SAVE_ROW[a], 6.5);
  layout[`${a}Save`] = modBox(SAVE_ROW[a]);
  SKILLS_BY_ABILITY[a].forEach((name, i) => {
    const cy = SKILL_ROWS[a][i];
    const k = skillKey(name);
    layout[`${k}Prof`] = tick(1, circle, cy, 6.5);
    layout[k] = modBox(cy);
  });
}

// Weapons & damage cantrips: six ruled rows across the upper right.
const ATTACK_RULE_Y = [212.2, 232.0, 251.2, 270.8, 290.2, 309.8];
for (let n = 1; n <= ATTACK_ROWS; n++) {
  const y = ATTACK_RULE_Y[n - 1];
  layout[`atk${n}Name`] = onRule(1, 228.5, y, 103, { size: 8.5 });
  layout[`atk${n}Bonus`] = onRule(1, 337, y, 42.5, { size: 8.5, ...mid });
  layout[`atk${n}Damage`] = onRule(1, 384.5, y, 73.5, { size: 8 });
  layout[`atk${n}Notes`] = onRule(1, 462.5, y, 123, { size: 7.5 });
}

// Spell slots: three columns of three, each a short "Total" rule.
const SLOT_X = [182, 270, 348.5];
const SLOT_Y = [94, 108, 122];
for (let lvl = 1; lvl <= 9; lvl++) {
  const col = Math.floor((lvl - 1) / 3);
  const row = (lvl - 1) % 3;
  layout[`lvl${lvl}Slots`] = onRule(2, SLOT_X[col], SLOT_Y[row], 14.5, { size: 9, ...mid });
}

/**
 * Cantrips & prepared spells: thirty ruled rows, each with the spell's level,
 * name, casting time and range, diamonds for Concentration and Ritual, and a
 * notes column. The first rule sits at 192.2 and they step 19.45pt apart.
 */
const SPELL_ROW_0 = 192.2;
const SPELL_ROW_PITCH = 19.45;
for (let n = 1; n <= SPELL_ROWS; n++) {
  const y = SPELL_ROW_0 + (n - 1) * SPELL_ROW_PITCH;
  layout[`spell${n}Level`] = onRule(2, 19, y, 21, { size: 8, ...mid });
  layout[`spell${n}Name`] = onRule(2, 42.5, y, 107.5, { size: 8 });
  layout[`spell${n}Time`] = onRule(2, 155, y, 29, { size: 7, ...mid });
  layout[`spell${n}Range`] = onRule(2, 189, y, 40.5, { size: 7, ...mid });
  // The row's diamonds sit 7.2pt above its rule, at these measured centres.
  layout[`spell${n}Conc`] = tick(2, 243, y - 7.2, 8);
  layout[`spell${n}Ritual`] = tick(2, 265, y - 7.2, 8);
  layout[`spell${n}Notes`] = onRule(2, 305, y, 85.5, { size: 7 });
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
