import { describe, expect, it } from "vitest";
import { moldPatch, moldSeed } from "./creatures";

// The SRD Wolf, as the sheet plays it before anyone touches it.
const wolf = {
  ac: 12,
  hp: 11,
  speed: "40 ft.",
  cr: "1/4 (XP 50; PB +2)",
  abilities: { str: 15, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
};

describe("molding a creature", () => {
  it("sends nothing when the form is opened and closed untouched", () => {
    const seed = moldSeed(wolf);
    expect(moldPatch({}, seed, seed)).toEqual({});
  });

  it("records only the field that moved", () => {
    const seed = moldSeed(wolf);
    expect(moldPatch({}, seed, { ...seed, ac: "14" })).toEqual({ ac: 14 });
  });

  /*
  The bug this file exists for. The editor's inputs show the *merged* block, so
  a previously molded AC of 14 reads as "14" on open — identical to a book
  value. Rebuilding the patch by comparing inputs to the block therefore found
  no change and sent no override, silently handing the houseruled number back
  to the book the next time anything else was edited.
  */
  it("keeps an existing override the player did not touch", () => {
    const played = { ...wolf, ac: 14 };
    const seed = moldSeed(played);
    const patch = moldPatch({ ac: 14 }, seed, { ...seed, hp: "20" });
    expect(patch).toEqual({ ac: 14, hp: 20 });
  });

  it("hands a number back to the book when its field is cleared", () => {
    const played = { ...wolf, ac: 14 };
    const seed = moldSeed(played);
    expect(moldPatch({ ac: 14 }, seed, { ...seed, ac: "" })).toEqual({});
  });

  it("molds one ability without freezing the other five", () => {
    const seed = moldSeed(wolf);
    const patch = moldPatch({}, seed, { ...seed, str: "18" });
    expect(patch).toEqual({ abilities: { str: 18 } });
  });

  it("keeps prose fields as prose and everything else as numbers", () => {
    const seed = moldSeed(wolf);
    const patch = moldPatch({}, seed, { ...seed, speed: "60 ft.", cr: "1/2", hp: "30" });
    expect(patch).toEqual({ speed: "60 ft.", cr: "1/2", hp: 30 });
  });

  it("drops an ability override when its field is cleared", () => {
    const played = { ...wolf, abilities: { ...wolf.abilities, str: 18 } };
    const seed = moldSeed(played);
    const patch = moldPatch({ abilities: { str: 18 } }, seed, { ...seed, str: "" });
    expect(patch).toEqual({});
  });

  it("seeds a hand-written creature from whatever few stats it has", () => {
    expect(moldSeed({ ac: 13, hp: 7 })).toEqual({
      ac: "13", hp: "7", speed: "", cr: "",
      str: "", dex: "", con: "", int: "", wis: "", cha: "",
    });
  });
});
