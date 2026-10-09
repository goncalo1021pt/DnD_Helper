import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  newAccount,
  registerViaAPI,
  seatHero,
  settled,
  unique,
} from "./helpers";

/*
The numbers a weapon is swung at (#379).

At the table a Monk with DEX 16 read +2 to hit with a quarterstaff — STR, and
nothing of Martial Arts — and the sheet added proficiency to every blade
whoever held it. Attacks are the browser's alone, so they are read off the
Inventory tab the way a player reads them. The fighting styles reach further:
Defense moves the AC, and the AC is also the server's, so it is read off the
tracker as well.
*/

async function equip(request: APIRequestContext, heroId: string, name: string, slot?: string) {
  const items = (await (await request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>;
  const hit = items.find((i) => i.name === name);
  expect(hit, `${name} should be in the armory`).toBeTruthy();
  const res = await request.post(`/api/characters/${heroId}/items`, { data: { contentId: hit!.id, qty: 1 } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const itemId = (await res.json()).id as string;
  const worn = await request.patch(`/api/characters/${heroId}/items/${itemId}`, {
    data: slot ? { equipped: true, slot } : { equipped: true },
  });
  expect(worn.ok(), await worn.text()).toBeTruthy();
}

async function attackLines(page: Page, heroId: string): Promise<string[]> {
  await page.goto(`/questboard/heroes/${heroId}`);
  await settled(page);
  await page.getByRole("button", { name: /inventory/i }).click();
  const lines = page.getByText(/to hit/);
  await expect(lines.first()).toBeVisible();
  return lines.allInnerTexts();
}

test("a Monk fights with DEX and the Martial Arts die; a Wizard is not taught the sword", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("monkweapons"));

  const monk = await forgeHero(page.request, {
    name: unique("Kwai "),
    className: "Monk",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 10 },
    skills: ["Acrobatics", "Stealth"],
  });
  await equip(page.request, monk, "Quarterstaff", "mainhand");
  // DEX +3 and proficiency +2; the fist is a Monk weapon too.
  expect(await attackLines(page, monk)).toEqual([
    "Quarterstaff +5 to hit · 1d6+3 bludgeoning",
    "Unarmed Strike +5 to hit · 1d6+3 bludgeoning",
  ]);

  const wizard = await forgeHero(page.request, {
    name: unique("Ezra "),
    className: "Wizard",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 14, dex: 10, con: 14, int: 16, wis: 12, cha: 8 },
    skills: ["Arcana", "History"],
  });
  await equip(page.request, wizard, "Longsword", "mainhand");
  await equip(page.request, wizard, "Dagger", "offhand");
  // STR +2 on both; only the Simple dagger earns the proficiency bonus.
  expect(await attackLines(page, wizard)).toEqual([
    "Longsword +2 to hit · 1d8+2 slashing",
    "Dagger +4 to hit · 1d4+2 piercing",
  ]);
});

test("Defense lifts the AC on the sheet and in the tracker", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("defense"));
  const campaign = await createCampaign(page.request, unique("The Shield Wall "));

  const id = await forgeHero(page.request, {
    name: unique("Harkon "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  const rules = async (kind: string, name: string) => {
    const list = (await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{ id: string; name: string }>;
    return list.find((e) => e.name === name)!.id;
  };
  // Up to Fighter 4, taking Defense at the Ability Score Improvement.
  for (const body of [
    {},
    { subclassId: await rules("subclass", "Champion") },
    { featId: await rules("feat", "Defense") },
  ]) {
    const res = await page.request.post(`/api/characters/${id}/levelup`, { data: { hpMode: "average", ...body } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  await equip(page.request, id, "Chain Mail");
  await seatHero(page.request, id, campaign.id);

  await page.goto(`/questboard/heroes/${id}`);
  await settled(page);
  // Chain Mail is 16 flat; Defense is +1 while armour is worn.
  await expect(page.getByText("AC", { exact: true }).first().locator("xpath=..")).toContainText("17");

  const made = await page.request.post(`/api/campaigns/${campaign.id}/encounters`, { data: { name: "The Wall Holds" } });
  expect(made.ok(), await made.text()).toBeTruthy();
  const added = await page.request.post(`/api/encounters/${(await made.json()).id}/combatants`, {
    data: { kind: "pc", characterId: id },
  });
  expect(added.ok(), await added.text()).toBeTruthy();
  const [combatant] = (await added.json()) as Array<{ ac: number }>;
  expect(combatant.ac, "the tracker reads the feat the sheet reads").toBe(17);
});
