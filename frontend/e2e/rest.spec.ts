import { expect, test } from "@playwright/test";
import { newAccount, registerViaAPI, unique } from "./helpers";

/*
The two rests (#118).

They existed only as reference text: nothing reset a slot, restored a hit
point, or spent a hit die. After a night at the table a player un-clicked every
spent slot by hand, clicked HP up to max, and then tapped the spell swap —
three chores standing in for one action, and three chances to forget one.

So the assertions are the three numbers, together, from one press. A rest that
restored HP and quietly left the slots spent would have passed "a rest button
exists", and the player would have found out mid-fight.
*/

async function forgeCleric(page: import("@playwright/test").Page, name: string): Promise<string> {
  const byName = async (kind: string, want: string) => {
    const list = (await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    const hit = list.find((e) => e.name === want);
    expect(hit, `${want} should be in the ${kind} library`).toBeTruthy();
    return hit!.id;
  };
  const res = await page.request.post("/api/me/characters/forge", {
    data: {
      name,
      classId: await byName("class", "Cleric"),
      speciesId: await byName("species", "Dwarf"),
      backgroundId: await byName("background", "Acolyte"),
      abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 8 },
      skills: ["History", "Medicine"],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

test("a long rest does in one press what took three chores", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("rest"));
  const id = await forgeCleric(page, unique("Durnan "));

  // Spend the day: wounded, and two first-level slots gone. PATCH (the PUT
  // this spec once used answered 405, unasserted, and the damage never landed
  // — #251), echoing the stored identity; class absent means unchanged.
  const { character: hero } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as { character: { name: string; hpMax: number; level: number } };
  const wound = await page.request.patch(`/api/characters/${id}`, {
    data: { name: hero.name, level: hero.level, hpCurrent: 1, hpMax: hero.hpMax },
  });
  expect(wound.ok(), await wound.text()).toBeTruthy();
  const slots = await page.request.put(`/api/characters/${id}/slots`, {
    data: { used: [2, 0, 0, 0, 0, 0, 0, 0, 0] },
  });
  expect(slots.ok(), await slots.text()).toBeTruthy();

  await page.goto(`/questboard/heroes/${id}`);
  const longRest = page.getByRole("button", { name: "Long Rest" });
  await expect(longRest).toBeVisible({ timeout: 20_000 });
  await longRest.click();

  // One press, and all three chores are done — read back from the server, not
  // from the panel that just claimed it.
  await expect(page.getByRole("status")).toContainText(/Whole again/, { timeout: 20_000 });
  const { character: after } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as {
    character: { hpCurrent: number; hpMax: number; sheet: { spellSlots: Array<{ used: number }> } };
  };
  expect(after.hpCurrent, "a long rest restores every hit point").toBe(after.hpMax);
  expect(
    after.sheet.spellSlots.every((s) => s.used === 0),
    "a long rest returns every spell slot",
  ).toBe(true);
});

test("a short rest spends hit dice, and cannot spend more than the hero has", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("short"));
  const id = await forgeCleric(page, unique("Brenna "));

  const { character: hero } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as { character: { name: string; hpMax: number; level: number } };
  const wound = await page.request.patch(`/api/characters/${id}`, {
    data: { name: hero.name, level: hero.level, hpCurrent: 1, hpMax: hero.hpMax },
  });
  expect(wound.ok(), await wound.text()).toBeTruthy();

  await page.goto(`/questboard/heroes/${id}`);
  // A level 1 hero has exactly one hit die, so the stepper cannot offer two.
  await expect(page.getByText(/Hit dice 1 \/ 1/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /One more d\d+ hit die/ })).toBeDisabled();

  await page.getByRole("button", { name: "Short Rest" }).click();
  await expect(page.getByRole("status")).toContainText(/Caught your breath/, { timeout: 20_000 });

  // The die is spent and the hero is no worse off than they were.
  await expect(page.getByText(/Hit dice 0 \/ 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Short Rest" })).toBeDisabled();

  const { character: after } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as { character: { hpCurrent: number } };
  expect(after.hpCurrent, "a spent hit die heals at least nothing").toBeGreaterThanOrEqual(1);
});

/*
The rests read every class the hero holds (#243, #244): a multiclass
Warlock's pact slot returns over the hour like a pure Warlock's, and a long
rest — PHB 2024 — returns EVERY spent hit die, not 2014's half.
*/
test("a Cleric/Warlock's pact slot returns on a short rest; a long rest returns every die", async ({
  page,
}) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mcrest"));
  const classes = (await (await page.request.get("/api/rules/class")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const idOf = (n: string) => classes.find((c) => c.name === n)!.id;

  const species = (await (await page.request.get("/api/rules/species")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const backgrounds = (await (await page.request.get("/api/rules/background")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const forged = await page.request.post("/api/me/characters/forge", {
    data: {
      name: unique("Pactwright "),
      classId: idOf("Cleric"),
      speciesId: species.find((s) => s.name === "Dwarf")!.id,
      backgroundId: backgrounds.find((b) => b.name === "Acolyte")!.id,
      abilities: { str: 8, dex: 13, con: 14, int: 10, wis: 16, cha: 15 },
      skills: ["History", "Medicine"],
    },
  });
  expect(forged.ok(), await forged.text()).toBeTruthy();
  const hero = (await forged.json()).id as string;
  for (const cls of ["Warlock", "Cleric"]) {
    const res = await page.request.post(`/api/characters/${hero}/levelup`, {
      data: { hpMode: "average", classId: idOf(cls) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  // Spend the pact slot and three hit dice's worth of a bad day.
  const slots = await page.request.put(`/api/characters/${hero}/slots`, {
    data: { used: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 1 },
  });
  expect(slots.ok(), await slots.text()).toBeTruthy();

  const sheetOf = async () =>
    ((await (await page.request.get(`/api/characters/${hero}`)).json()) as {
      character: {
        hitDice?: Array<{ die: number; max: number; used: number }>;
        sheet?: { pactSlots?: { used: number } };
      };
    }).character;

  // A short rest with no dice: the MULTICLASS pact slot still returns (#243).
  const short = await page.request.post(`/api/characters/${hero}/rest`, {
    data: { kind: "short" },
  });
  expect(short.ok(), await short.text()).toBeTruthy();
  expect((await sheetOf()).sheet?.pactSlots?.used, "the pact slot came back over the hour").toBe(0);

  // Spend three dice over short rests, then sleep: 2024 says ALL return (#244).
  const spendAll = await page.request.post(`/api/characters/${hero}/rest`, {
    data: { kind: "short", hitDice: { "8": 3 } },
  });
  expect(spendAll.ok(), await spendAll.text()).toBeTruthy();
  const spentNow = ((await sheetOf()).hitDice ?? []).reduce((n, d) => n + d.used, 0);
  expect(spentNow, "three dice spent before the night").toBeGreaterThanOrEqual(1);

  const long = (await (
    await page.request.post(`/api/characters/${hero}/rest`, { data: { kind: "long" } })
  ).json()) as { hitDiceRegained: number };
  expect(long.hitDiceRegained, "every spent die returns (PHB 2024)").toBe(spentNow);
  const after = ((await sheetOf()).hitDice ?? []).reduce((n, d) => n + d.used, 0);
  expect(after, "no die stays spent through a long rest").toBe(0);
});
