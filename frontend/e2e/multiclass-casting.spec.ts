import { test, expect, type APIRequestContext } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
Casting across two classes (#190, part 3).

Two pools that never merge, and one rounding rule that changed between
editions. Both are the sort of thing that looks right in a spreadsheet and is
wrong at the table, so they are tested on the numbers the book prints.
*/

async function classIdNamed(request: APIRequestContext, want: string) {
  const list = (await (await request.get("/api/rules/class")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const hit = list.find((c) => c.name === want);
  expect(hit, `${want} should be in the class library`).toBeTruthy();
  return hit!.id;
}

async function sheetOf(request: APIRequestContext, heroId: string) {
  const res = await request.get(`/api/characters/${heroId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as {
    character: {
      level: number;
      sheet?: {
        spellSlots?: Array<{ level: number; max: number; used: number }>;
        pactSlots?: { level: number; max: number; used: number };
      };
    };
    casters?: Array<{ className: string; ability: string; spellIds: string[]; maxSpellLevel?: number }>;
  };
}

const slotsAt = (sheet: Awaited<ReturnType<typeof sheetOf>>, level: number) =>
  sheet.character.sheet?.spellSlots?.find((s) => s.level === level)?.max ?? 0;

/*
The rounding that changed. Half-casters round UP in 2024, so a Paladin 1 is
already caster level 1 and pairs with a Wizard 1 to make caster level 2 —
three level 1 slots. Under 2014's round-down they would be caster level 1 and
have two. One slot, and it is the difference between the editions.
*/
test("a half-caster's levels round up into the shared pool", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("cast1"));
  const heroId = await forgeHero(page.request, {
    name: unique("Oathwright "),
    className: "Paladin",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 13, dex: 10, con: 14, int: 13, wis: 10, cha: 13 },
    skills: ["Athletics", "Persuasion"],
  });

  // Alone, the Paladin reads their own (slower) table: two level 1 slots.
  expect(slotsAt(await sheetOf(page.request, heroId), 1)).toBe(2);

  const wizard = await classIdNamed(page.request, "Wizard");
  const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: wizard },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  const after = await sheetOf(page.request, heroId);
  expect(
    slotsAt(after, 1),
    "Paladin 1 (rounded up) + Wizard 1 = caster level 2, which is three slots",
  ).toBe(3);
});

/*
Pact Magic is not in the shared pool. A Warlock 1 / Wizard 1 has the Wizard's
slots off the Multiclass Spellcaster table AND a pact slot beside them; adding
the Warlock level into the table would give three shared slots and no pact.
*/
test("Pact Magic stands beside the shared pool, not inside it", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("cast2"));
  const heroId = await forgeHero(page.request, {
    name: unique("Bargainer "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 12, con: 14, int: 13, wis: 10, cha: 15 },
    skills: ["Arcana", "Deception"],
  });

  const wizard = await classIdNamed(page.request, "Wizard");
  const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: wizard },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  const sheet = await sheetOf(page.request, heroId);
  expect(slotsAt(sheet, 1), "only the Wizard level counts toward the shared pool").toBe(2);

  const pact = sheet.character.sheet?.pactSlots;
  expect(pact, "the Warlock keeps a pact slot of their own").toBeTruthy();
  expect(pact!.max).toBe(1);
  expect(pact!.level).toBe(1);
});

// An hour returns the pact pool and nothing else; the night returns both.
test("a short rest refills Pact Magic alone", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("cast3"));
  const heroId = await forgeHero(page.request, {
    name: unique("Hourkeeper "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 12, con: 14, int: 13, wis: 10, cha: 15 },
    skills: ["Arcana", "Deception"],
  });
  const wizard = await classIdNamed(page.request, "Wizard");
  await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: wizard },
  });

  // Spend both pools.
  const spend = await page.request.put(`/api/characters/${heroId}/slots`, {
    data: { used: [1], pactUsed: 1 },
  });
  expect(spend.ok(), await spend.text()).toBeTruthy();

  const short = await page.request.post(`/api/characters/${heroId}/rest`, {
    data: { kind: "short" },
  });
  expect(short.ok(), await short.text()).toBeTruthy();

  const after = await sheetOf(page.request, heroId);
  expect(after.character.sheet?.pactSlots?.used, "the pact slot came back").toBe(0);
  expect(
    after.character.sheet?.spellSlots?.find((s) => s.level === 1)?.used,
    "the Wizard slot waits for the night",
  ).toBe(1);

  const long = await page.request.post(`/api/characters/${heroId}/rest`, { data: { kind: "long" } });
  expect(long.ok(), await long.text()).toBeTruthy();
  const rested = await sheetOf(page.request, heroId);
  expect(rested.character.sheet?.spellSlots?.find((s) => s.level === 1)?.used).toBe(0);
});

/*
"You determine what spells you can prepare for each class individually … each
spell is associated with one of your classes, and you use the spellcasting
ability of that class." Two classes, two abilities, and every spell on one
side or the other.
*/
test("each class keeps its own spells and its own casting ability", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("cast4"));
  const heroId = await forgeHero(page.request, {
    name: unique("Twinsource "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 12, con: 14, int: 13, wis: 10, cha: 15 },
    skills: ["Arcana", "Deception"],
  });
  // A Wizard cantrip, taken with the Wizard level, belongs to the Wizard.
  const spells = (await (await page.request.get("/api/rules/spell")).json()) as Array<{
    id: string;
    name: string;
    data: { level?: number; classes?: string[] };
  }>;
  const cantrip = spells.find(
    (s) => s.data.level === 0 && (s.data.classes ?? []).includes("Wizard"),
  );
  expect(cantrip, "the library should hold a Wizard cantrip").toBeTruthy();

  const wizard = await classIdNamed(page.request, "Wizard");
  const up = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: wizard, spells: [cantrip!.id] },
  });
  expect(up.ok(), await up.text()).toBeTruthy();

  const sheet = await sheetOf(page.request, heroId);
  const casters = sheet.casters ?? [];
  expect(casters.map((c) => c.className).sort()).toEqual(["Warlock", "Wizard"]);

  const warlock = casters.find((c) => c.className === "Warlock")!;
  const wiz = casters.find((c) => c.className === "Wizard")!;
  expect(warlock.ability, "a Warlock casts off Charisma").toBe("CHA");
  expect(wiz.ability, "a Wizard casts off Intelligence").toBe("INT");

  expect(wiz.spellIds, "the cantrip was taken with the Wizard level").toContain(cantrip!.id);
  expect(warlock.spellIds, "and so is not the Warlock's").not.toContain(cantrip!.id);

  const overlap = warlock.spellIds.filter((id) => wiz.spellIds.includes(id));
  expect(overlap, "a spell belongs to exactly one class").toHaveLength(0);
});

/*
The caps of a class are its own (#241): counted against that class's spells at
the hero's level IN that class — never the total level or the whole grimoire.
Before the fix a full-loaded Cleric 1 was refused a Warlock level ("knows at
most 2 cantrips at level 2"), ANY cantrip-owner was refused a Ranger dip
("at most 0 cantrips"), and a spell-less hero was over-granted.
*/
test("a full-loaded Cleric dips Warlock and Ranger; a Warlock 1 prepares like a Warlock 1", async ({
  page,
}) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("caps"));

  const byName = async (kind: string, want: string) => {
    const list = (await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    return list.find((e) => e.name === want)!.id;
  };
  const spellIds = async (names: string[]) => {
    const list = (await (await page.request.get("/api/rules/spell")).json()) as Array<{
      id: string;
      name: string;
    }>;
    return names.map((n) => list.find((s) => s.name === n)!.id);
  };

  // The Cleric leaves the forge with a FULL load: 3 cantrips + 4 spells.
  const fullLoad = await spellIds([
    "Guidance", "Light", "Sacred Flame", "Bless", "Cure Wounds", "Bane", "Command",
  ]);
  const forged = await page.request.post("/api/me/characters/forge", {
    data: {
      name: unique("Capwright "),
      classId: await byName("class", "Cleric"),
      speciesId: await byName("species", "Dwarf"),
      backgroundId: await byName("background", "Acolyte"),
      abilities: { str: 8, dex: 13, con: 14, int: 10, wis: 16, cha: 15 },
      skills: ["History", "Medicine"],
      spells: fullLoad,
    },
  });
  expect(forged.ok(), await forged.text()).toBeTruthy();
  const hero = (await forged.json()).id as string;

  // The Warlock dip lands, with the Warlock's OWN allowance: 2 cantrips + 2
  // spells at Warlock 1 — the Cleric's picks eat none of it.
  const [eldritchBlast, chillTouch, hexSpell, charm] = await spellIds([
    "Eldritch Blast", "Chill Touch", "Hex", "Charm Person",
  ]);
  const dip = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: {
      hpMode: "average",
      classId: await byName("class", "Warlock"),
      spells: [eldritchBlast, chillTouch, hexSpell, charm],
    },
  });
  expect(dip.ok(), "a legal Warlock dip with a legal Warlock-1 load: " + (await dip.text())).toBeTruthy();

  // A third Warlock-1 leveled spell would have passed under the old
  // total-level read (Warlock 2 prepares 3); the class's own level refuses it.
  const [hellish, unseen] = await spellIds(["Hellish Rebuke", "Comprehend Languages"]);
  const over = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: await byName("class", "Warlock"), spells: [hellish, unseen] },
  });
  expect(over.status(), "Warlock 2 has room for exactly one more leveled spell, not two").toBe(400);
  expect(await over.text(), "refused for the cap, not the list").toContain("prepares at most");

  // And the Ranger dip — a class with no cantrip column — no longer chokes on
  // the hero's Cleric cantrips.
  const ranger = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: await byName("class", "Ranger") },
  });
  expect(ranger.ok(), "a cantrip-owning caster may dip Ranger: " + (await ranger.text())).toBeTruthy();
});

/*
A subclass's always-prepared spells are granted (#361). The Fiend's four
level-3 spells arrive with the subclass, marked on the sheet; they cost no
pick — a Warlock 4 prepares five spells of their own beside them — and a
granted spell cannot be picked again.
*/
test("a Fiend Warlock's patron spells are always prepared and cost no pick (#361)", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("fiend"));
  const heroId = await forgeHero(page.request, {
    name: unique("Pactkeeper "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 12, con: 14, int: 13, wis: 10, cha: 15 },
    skills: ["Arcana", "Deception"],
  });
  const warlock = await classIdNamed(page.request, "Warlock");
  const subs = (await (await page.request.get("/api/rules/subclass")).json()) as Array<{ id: string; name: string }>;
  const fiend = subs.find((s) => s.name === "Fiend Patron")!.id;
  for (const level of [2, 3]) {
    const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
      data: { hpMode: "average", classId: warlock, ...(level === 3 ? { subclassId: fiend } : {}) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  type Detail = {
    spells: Array<{ id: string; name: string }>;
    casters?: Array<{ classId: string; alwaysPreparedIds?: string[]; spellIds: string[] }>;
  };
  const detailOf = async () => (await (await page.request.get(`/api/characters/${heroId}`)).json()) as Detail;
  const granted = ["Burning Hands", "Command", "Scorching Ray", "Suggestion"];
  const d3 = await detailOf();
  expect(d3.spells.map((s) => s.name).sort()).toEqual(granted);
  expect(d3.casters![0].alwaysPreparedIds).toHaveLength(4);
  expect(d3.casters![0].spellIds, "granted, not picked").toHaveLength(0);

  // A granted spell is not a pick.
  const command = d3.spells.find((s) => s.name === "Command")!.id;
  const again = await page.request.post(`/api/characters/${heroId}/levelup`, {
    // Warlock 4 is an ability-score level, so the increase rides along.
    data: { hpMode: "average", classId: warlock, asi: { cha: 2 }, spells: [command] },
  });
  expect(again.status()).toBe(400);
  expect(await again.text()).toContain("always prepared");

  // Warlock 4 prepares five of their own, beside the four granted ones.
  const library = (await (await page.request.get("/api/rules/spell")).json()) as Array<{
    id: string;
    name: string;
    data: { level?: number; classes?: string[] };
  }>;
  const own = library
    .filter((s) => (s.data.classes ?? []).includes("Warlock"))
    .filter((s) => (s.data.level ?? 0) >= 1 && (s.data.level ?? 0) <= 2)
    .filter((s) => !granted.includes(s.name))
    .slice(0, 5)
    .map((s) => s.id);
  expect(own).toHaveLength(5);
  const four = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: warlock, asi: { cha: 2 }, spells: own },
  });
  expect(four.ok(), await four.text()).toBeTruthy();
  const d4 = await detailOf();
  expect(d4.spells).toHaveLength(9);
  expect(d4.casters![0].spellIds).toHaveLength(5);

  // The sheet marks what the patron keeps prepared, and nothing else.
  await page.goto(`/questboard/heroes/${heroId}`);
  await expect(page.getByText("always prepared")).toHaveCount(4, { timeout: 20_000 });
});

/*
Mystic Arcanum (#362). At Warlock 11 one level-6 spell may be learned above
the pact ceiling — one, not two, and not a level 7 yet — with a pool that
counts its once-a-Long-Rest cast. On gaining a level it may be traded for
another spell of its own level, never for a lower one. The sheet says what
it is.
*/
test("a Warlock 11 learns one Mystic Arcanum and may trade it on the way up (#362)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("arcanum"));
  const heroId = await forgeHero(page.request, {
    name: unique("Archfey-sworn "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 12, con: 14, int: 13, wis: 10, cha: 15 },
    skills: ["Arcana", "Deception"],
  });
  const warlock = await classIdNamed(page.request, "Warlock");
  const subs = (await (await page.request.get("/api/rules/subclass")).json()) as Array<{ id: string; name: string }>;
  const fiend = subs.find((s) => s.name === "Fiend Patron")!.id;
  const library = (await (await page.request.get("/api/rules/spell")).json()) as Array<{ id: string; name: string }>;
  const spell = (n: string) => library.find((s) => s.name === n)!.id;
  const levelUp = (extra: Record<string, unknown> = {}) =>
    page.request.post(`/api/characters/${heroId}/levelup`, { data: { hpMode: "average", classId: warlock, ...extra } });

  // Up to Warlock 10: the patron at 3, an ability increase at 4 and 8.
  for (let level = 2; level <= 10; level++) {
    const extra = level === 3 ? { subclassId: fiend } : level === 4 || level === 8 ? { asi: { cha: 1, con: 1 } } : {};
    const res = await levelUp(extra);
    expect(res.ok(), `level ${level}: ${await res.text()}`).toBeTruthy();
  }

  // At 11: not two of level 6, not a level 7 — one level 6.
  const two = await levelUp({ spells: [spell("Circle of Death"), spell("Eyebite")] });
  expect(two.status()).toBe(400);
  expect(await two.text()).toContain("one per level");
  const seven = await levelUp({ spells: [spell("Finger of Death")] });
  expect(seven.status()).toBe(400);
  const eleven = await levelUp({ spells: [spell("Circle of Death")] });
  expect(eleven.ok(), await eleven.text()).toBeTruthy();

  type Detail = {
    spells: Array<{ id: string; name: string }>;
    character: { sheet?: { pools?: Array<{ name: string; max: number }> } };
  };
  const detailOf = async () => (await (await page.request.get(`/api/characters/${heroId}`)).json()) as Detail;
  const d11 = await detailOf();
  expect(d11.spells.map((s) => s.name)).toContain("Circle of Death");
  const pools = d11.character.sheet?.pools ?? [];
  expect(pools.find((p) => p.name === "Mystic Arcanum (6th level)")?.max).toBe(1);
  expect(pools.find((p) => p.name === "Mystic Arcanum (7th level)"), "not before Warlock 13").toBeFalsy();

  // At 12 (an ability level): the arcanum trades for another level 6, not a 5.
  const down = await levelUp({
    asi: { cha: 2 },
    spellSwaps: [{ replace: spell("Circle of Death"), with: spell("Hold Monster") }],
  });
  expect(down.status()).toBe(400);
  expect(await down.text()).toContain("arcanum");
  const twelve = await levelUp({
    asi: { cha: 2 },
    spellSwaps: [{ replace: spell("Circle of Death"), with: spell("Eyebite") }],
  });
  expect(twelve.ok(), await twelve.text()).toBeTruthy();
  const d12 = await detailOf();
  expect(d12.spells.map((s) => s.name)).toContain("Eyebite");
  expect(d12.spells.map((s) => s.name)).not.toContain("Circle of Death");

  await page.goto(`/questboard/heroes/${heroId}`);
  await expect(page.getByText("arcanum · 1/long rest")).toHaveCount(1, { timeout: 20_000 });
});
