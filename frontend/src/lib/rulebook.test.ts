import { describe, expect, it } from "vitest";
import { linkSpellNames, spellListOf } from "./rulebook";

const SPELLS = new Map(
  ["Fire Bolt", "Light", "Fly", "Invisibility", "Detect Magic", "Misty Step", "Resistance"].map((n) => [
    n.toLowerCase(),
    n,
  ]),
);
const lookup = (name: string) => SPELLS.get(name);

describe("spellListOf", () => {
  it("reads the 2014 book's lowercase lists", () => {
    expect(spellListOf("Cantrips (at will): fire bolt, light")).toEqual({
      header: "Cantrips (at will): ",
      list: "fire bolt, light",
    });
    expect(spellListOf("1/day each: fly (self only), invisibility")?.list).toBe("fly (self only), invisibility");
    expect(spellListOf("3rd level (3 slots): fly")?.header).toBe("3rd level (3 slots): ");
  });
  it("reads a bold or indented 2024 header", () => {
    expect(spellListOf("&emsp;**At Will:** _Detect Magic_, _Light_")).toEqual({
      header: "&emsp;**At Will:** ",
      list: "_Detect Magic_, _Light_",
    });
    expect(spellListOf("**At will:** Detect Magic, Tongues")?.list).toBe("Detect Magic, Tongues");
    // A scanned "2/day" that came through as "2lday" still says "each".
    expect(spellListOf("2lday each: Detect Thoughts, Tongues")).not.toBeNull();
  });
  it("leaves every other paragraph alone", () => {
    expect(spellListOf("**Spellcasting.** The mage casts one of the following spells (spell save DC 14):")).toBeNull();
    expect(spellListOf("_Legendary Action Uses: 3 (4 in Lair). Immediately after another creature's turn._")).toBeNull();
    expect(spellListOf("Saving Throws: Dex +6, Wis +4")).toBeNull();
    expect(spellListOf("**Rend.** _Melee Attack Roll:_ +14, reach 10 ft.")).toBeNull();
    expect(spellListOf("At will:")).toBeNull();
  });
});

describe("linkSpellNames", () => {
  it("links the names it knows and keeps the rest as prose, losslessly", () => {
    const text = "fire bolt, light, mending";
    const out = linkSpellNames(text, lookup);
    expect(out).toEqual([
      { text: "fire bolt", entry: "Fire Bolt" },
      ", ",
      { text: "light", entry: "Light" },
      ", mending",
    ]);
    expect(out.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(text);
  });
  it("keeps a note in brackets and a trailing stop outside the link", () => {
    expect(linkSpellNames("fly (self only), invisibility.", lookup)).toEqual([
      { text: "fly", entry: "Fly" },
      " (self only), ",
      { text: "invisibility", entry: "Invisibility" },
      ".",
    ]);
  });
  it("reads an italic run of several names, and one joined by or", () => {
    expect(linkSpellNames("Light, Detect Magic,", lookup)).toEqual([
      { text: "Light", entry: "Light" },
      ", ",
      { text: "Detect Magic", entry: "Detect Magic" },
      ",",
    ]);
    expect(linkSpellNames("Fly or Misty Step", lookup)).toEqual([
      { text: "Fly", entry: "Fly" },
      " or ",
      { text: "Misty Step", entry: "Misty Step" },
    ]);
  });
  it("links nothing in a run that names no spell", () => {
    expect(linkSpellNames("Small Fey (Goblinoid), Chaotic Neutral", lookup)).toEqual([
      "Small Fey (Goblinoid), Chaotic Neutral",
    ]);
    expect(linkSpellNames("Melee Attack Roll:", lookup)).toEqual(["Melee Attack Roll:"]);
  });
});
