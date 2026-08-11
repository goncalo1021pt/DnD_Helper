import { test, expect, type APIRequestContext } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, settled, unique } from "./helpers";

/*
Taking a level in a second class (#190, part 2).

The rules being protected are the ones a player would notice going wrong: the
prerequisite that decides whether the door opens at all, the class's own level
being what its tables are read at, and hit dice staying separate per die type
so spending a Fighter's d10 does not eat a Wizard's d6.
*/

async function classesOf(request: APIRequestContext, heroId: string) {
  const res = await request.get(`/api/characters/${heroId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as {
    character: {
      level: number;
      hitDice?: Array<{ die: number; max: number; used: number }>;
      sheet?: { classes?: Array<{ className: string; level: number; starting?: boolean }> };
    };
  };
  return body.character;
}

/** A Fighter who can afford a Wizard level: STR 15 for Fighter, INT 13 for Wizard. */
async function forgeDabbler(request: APIRequestContext, name: string) {
  return forgeHero(request, {
    name: unique(name),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 12, con: 14, int: 13, wis: 10, cha: 8 },
    skills: ["Athletics", "Perception"],
  });
}

async function classIdNamed(request: APIRequestContext, want: string) {
  const list = (await (await request.get("/api/rules/class")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const hit = list.find((c) => c.name === want);
  expect(hit, `${want} should be in the class library`).toBeTruthy();
  return hit!.id;
}

test("a Fighter who qualifies can take a Wizard level", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mc1"));
  const heroId = await forgeDabbler(page.request, "Dabbler ");
  const wizard = await classIdNamed(page.request, "Wizard");

  const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: wizard },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  const hero = await classesOf(page.request, heroId);
  expect(hero.level, "total character level is the sum").toBe(2);

  const classes = hero.sheet?.classes ?? [];
  expect(classes.map((c) => `${c.className} ${c.level}`)).toEqual(["Fighter 1", "Wizard 1"]);
  expect(classes.find((c) => c.className === "Fighter")?.starting).toBe(true);
  expect(classes.find((c) => c.className === "Wizard")?.starting).toBe(false);

  // The dice stay apart: a d10 from the Fighter, a d6 from the Wizard.
  const dice = Object.fromEntries((hero.hitDice ?? []).map((d) => [d.die, d.max]));
  expect(dice, "one d10 and one d6, not two of anything").toEqual({ 10: 1, 6: 1 });
});

test("a hero who does not meet the prerequisite is turned away, and told why", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mc2"));
  // Intelligence 8: no Wizard will have them.
  const heroId = await forgeHero(page.request, {
    name: unique("Thickskull "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 13 },
    skills: ["Athletics", "Perception"],
  });
  const wizard = await classIdNamed(page.request, "Wizard");

  const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: wizard },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("Intelligence 13");

  // And nothing happened — a refused level must not half-land.
  const hero = await classesOf(page.request, heroId);
  expect(hero.level).toBe(1);
  expect(hero.sheet?.classes).toHaveLength(1);
});

/*
Fighter is the one class whose primary ability is "Strength OR Dexterity"
(PHB 2024). Every other two-ability class means AND, so this is the case a
default reading of primaryAbility would get wrong.
*/
test("Fighter takes either Strength or Dexterity, not both", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mc3"));
  // A Wizard with Dexterity 13 and Strength 8 — Fighter should still open.
  const heroId = await forgeHero(page.request, {
    name: unique("Nimble "),
    className: "Wizard",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 13, con: 14, int: 15, wis: 10, cha: 10 },
    skills: ["Arcana", "History"],
  });
  const fighter = await classIdNamed(page.request, "Fighter");

  const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: fighter },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  const hero = await classesOf(page.request, heroId);
  expect((hero.sheet?.classes ?? []).map((c) => c.className)).toContain("Fighter");
});

// The class's own tables are read at its own level: a subclass is chosen at
// the class's level 3, whatever the hero's total has reached.
test("a second class picks its subclass at its own third level", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mc4"));
  const heroId = await forgeDabbler(page.request, "Twice ");
  const wizard = await classIdNamed(page.request, "Wizard");

  // Fighter 1 → Wizard 1 (total 2). The hero's total is now 3 next time, but
  // the Wizard is only on their second level and chooses nothing yet.
  for (const _ of [0, 1]) {
    const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
      data: { hpMode: "average", classId: wizard },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  let hero = await classesOf(page.request, heroId);
  expect(hero.level).toBe(3);
  expect(hero.sheet?.classes?.find((c) => c.className === "Wizard")?.level).toBe(2);

  // Wizard 3 is the subclass level, and it is refused without one.
  const bare = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: wizard },
  });
  expect(bare.status()).toBe(400);
  expect((await bare.json()).error).toContain("Wizard level 3");

  hero = await classesOf(page.request, heroId);
  expect(hero.level, "the refusal changed nothing").toBe(3);
});

test("the level-up offers the choice, and says what multiclassing costs", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mc5"));
  const heroId = await forgeDabbler(page.request, "Chooser ");

  await page.goto(`/questboard/heroes/${heroId}`);
  await page.getByRole("button", { name: /Level up/i }).click();
  const dialog = page.getByRole("dialog");

  const picker = dialog.getByLabel("This level goes to");
  await expect(picker).toBeVisible();
  // Their own class first, and Wizard on offer since Intelligence is 13.
  await expect(picker.locator("option", { hasText: "Fighter" })).toHaveCount(1);
  await expect(picker.locator("option", { hasText: "Wizard" })).toHaveCount(1);

  await picker.selectOption({ label: "Wizard — a new calling" });
  await expect(dialog.getByText(/Multiclassing\./)).toBeVisible();
  await expect(dialog.getByText("Gained at Wizard level 1")).toBeVisible();

  await dialog.getByRole("button", { name: /Rise to Level 2/i }).click();
  await settled(page);

  await expect(page.getByText("Fighter 1 / Wizard 1")).toBeVisible();
});
