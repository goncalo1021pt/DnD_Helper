import { describe, expect, it } from "vitest";
import type { RulesContent } from "../api/client";
import { copyName, copyOf, sourceLabel } from "./content";

/*
Copying a creature (#127).

The naming is the whole of it. The server refuses a second homebrew entry with
the same kind and name, so a copy that suggested the original's name fails on
the first press — and the DM's reaction to "you already have a homebrew monster
named Goblin Warrior" is that the feature is broken, not that they need to
rename it first.
*/

const entry = (over: Partial<RulesContent> = {}): RulesContent =>
  ({
    id: "x",
    kind: "monster",
    source: "homebrew",
    name: "Goblin Warrior",
    summary: "A small, mean thing.",
    data: { cr: "1/4 (XP 50; PB +2)", crValue: 0.25, hp: 10, ac: 15 },
    mine: true,
    ...over,
  }) as RulesContent;

describe("naming a copy", () => {
  it("suggests a name nobody is using", () => {
    expect(copyName("Goblin Warrior", [])).toBe("Goblin Warrior (copy)");
  });

  it("steps past a copy that already exists", () => {
    expect(copyName("Goblin Warrior", ["Goblin Warrior", "Goblin Warrior (copy)"])).toBe(
      "Goblin Warrior (copy 2)",
    );
    expect(
      copyName("Goblin Warrior", [
        "Goblin Warrior",
        "Goblin Warrior (copy)",
        "Goblin Warrior (copy 2)",
      ]),
    ).toBe("Goblin Warrior (copy 3)");
  });

  // Otherwise a DM iterating on a creature ends up with "Goblin (copy) (copy)
  // (copy)" by the third pass.
  it("copies a copy without stacking the suffix", () => {
    expect(copyName("Goblin Warrior (copy)", ["Goblin Warrior (copy)"])).toBe(
      "Goblin Warrior (copy 2)",
    );
    expect(copyName("Goblin Warrior (copy 4)", [])).toBe("Goblin Warrior (copy)");
  });

  it("does not care about case or stray spacing when checking what is taken", () => {
    expect(copyName("Goblin Warrior", ["  goblin warrior (COPY)  "])).toBe(
      "Goblin Warrior (copy 2)",
    );
  });
});

describe("what comes across in a copy", () => {
  it("brings the whole stat block — a copy is a starting position", () => {
    const { data } = copyOf(entry(), []);
    expect(data).toMatchObject({ cr: "1/4 (XP 50; PB +2)", crValue: 0.25, hp: 10, ac: 15 });
  });

  // sourceLabel reads data.book, so a kept `book` would file a creature you
  // wrote under someone else's book.
  it("does not claim to be from the book it was copied out of", () => {
    const packed = entry({ data: { book: "Rime of the Frostmaiden", hp: 10 } });
    expect(sourceLabel(packed)).toBe("Rime of the Frostmaiden");

    const copy = copyOf(packed, []);
    expect(copy.data.book).toBeUndefined();
    expect(copy.data.hp).toBe(10);
    expect(sourceLabel({ ...packed, data: copy.data } as RulesContent)).toBe("Homebrew");
  });

  it("carries the summary over, and survives an entry that has none", () => {
    expect(copyOf(entry(), []).summary).toBe("A small, mean thing.");
    expect(copyOf(entry({ summary: undefined }), []).summary).toBe("");
    expect(copyOf(entry({ data: undefined }), []).data).toEqual({});
  });

  it("copies an SRD creature into something of your own", () => {
    const srd = entry({ source: "srd", mine: false });
    const copy = copyOf(srd, ["Goblin Warrior"]);
    expect(copy.name).toBe("Goblin Warrior (copy)");
    expect(copy.data).toMatchObject({ crValue: 0.25 });
  });
});
