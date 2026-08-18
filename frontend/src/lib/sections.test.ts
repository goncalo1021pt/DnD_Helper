import { describe, expect, it } from "vitest";
import {
  CUSTOM_BODY_KEYS,
  SECTIONS,
  hallBlocks,
  railFamilies,
  screenRows,
  sectionsFor,
} from "./sections";

/*
 * The rail and the Hall drifted once — Folk shipped to one and never reached
 * the other (#231). They read one list now, and these hold that list honest.
 */

const ROLES = ["dm", "player"] as const;

describe("the campaign sections", () => {
  it("names every room once", () => {
    const keys = SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const paths = SECTIONS.map((s) => s.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it.each(ROLES)("gives %s a door on the Hall for every rail chip", (role) => {
    const rail = railFamilies(role).flatMap((g) => g.items);
    expect(rail.length).toBe(sectionsFor(role).length);

    const doors = new Set([
      ...hallBlocks(role, "left").map((s) => s.key),
      ...hallBlocks(role, "right").map((s) => s.key),
      ...screenRows(role).map((s) => s.key),
      // The Hall is its own door: you are standing in it.
      ...sectionsFor(role)
        .filter((s) => s.hall.kind === "self")
        .map((s) => s.key),
    ]);
    for (const s of rail) expect(doors).toContain(s.key);
  });

  it.each(ROLES)("shows %s exactly one role menu", (role) => {
    const rows = screenRows(role);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((s) => s.only === role)).toBe(true);
  });

  it("keeps the Hall's own chip first and alone in its family", () => {
    const [first] = railFamilies("dm");
    expect(first.family).toBe("hall");
    expect(first.items.map((s) => s.key)).toEqual(["hall"]);
    expect(first.label).toBe("");
  });

  it.each(ROLES)("heads every other family with a word for %s", (role) => {
    for (const group of railFamilies(role).slice(1)) {
      expect(group.label).not.toBe("");
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("agrees with the dashboard about which blocks it draws itself", () => {
    const custom = SECTIONS.filter(
      (s) => s.hall.kind === "block" && s.hall.body === "custom",
    ).map((s) => s.key);
    expect(custom.sort()).toEqual([...CUSTOM_BODY_KEYS].sort());
  });

  it("writes a whisper for every block it does not draw itself", () => {
    for (const s of SECTIONS) {
      if (s.hall.kind !== "block" || s.hall.body === "custom") continue;
      expect(s.hall.body.dm.length).toBeGreaterThan(20);
      expect(s.hall.body.player.length).toBeGreaterThan(20);
    }
  });
});
