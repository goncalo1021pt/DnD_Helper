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
