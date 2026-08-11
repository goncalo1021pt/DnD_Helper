/*
How a hero's classes read on screen (#190).

A single-classed hero keeps exactly the line they always had — the Forge's
"Half-Elf Bard", which says more than "Bard 5" does and is what every screen
has shown since the start. Only a hero who actually holds levels in more than
one class gets the per-class breakdown, because only then is one name a lie.

One helper rather than the same conditional at six call sites: the roster, the
shelf, the sheet header, both menus and the printed sheet all answer "what is
this hero" and must not answer it differently.
*/

import type { Character, CharacterClass } from "../api/client";

/** Every class a hero holds levels in, starting class first. */
export function classesOf(character: Character): CharacterClass[] {
  return character.sheet?.classes ?? [];
}

export function isMulticlass(character: Character): boolean {
  return classesOf(character).length > 1;
}

/** "Rogue 5 / Wizard 3" — the breakdown, for a hero who has one. */
export function multiclassLine(character: Character): string {
  return classesOf(character)
    .map((k) => `${k.className} ${k.level}`)
    .join(" / ");
}

/**
 * What to print where a hero's class goes.
 *
 * Multiclassed: the breakdown, which carries its own levels. Otherwise the
 * freeform line the Forge wrote, and "Adventurer" for a quick-add hero who
 * has nothing else.
 */
export function classLine(character: Character): string {
  if (isMulticlass(character)) return multiclassLine(character);
  return character.class || "Adventurer";
}
