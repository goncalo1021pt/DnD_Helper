/*
 * The data layer, one module per domain.
 *
 * This was a single 1,906-line hooks.ts that every feature had to touch, which
 * made it both the biggest merge-conflict surface in the repo and the fastest-
 * growing file in it (#107).
 *
 * The barrel is deliberate: `from "../hooks"` keeps resolving, so splitting the
 * file changed no component. Import from a domain module directly in new code if
 * you like — both work.
 */

export * from "./auth";
export * from "./campaigns";
export * from "./members";
export * from "./quests";
export * from "./locations";
export * from "./party";
export * from "./heroes";
export * from "./rules";
export * from "./vendors";
export * from "./chronicle";
export * from "./packs";
export * from "./codex";
export * from "./trees";
export * from "./maps";
export * from "./encounters";
export * from "./bestiary";
