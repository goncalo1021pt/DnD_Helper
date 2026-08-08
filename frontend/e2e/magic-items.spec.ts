import { expect, test } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
Magic items (#189).

The armory carried 55 mundane items; the content layer could describe a +1
sword since #101 and nothing applied it. The journeys worth protecting: the
enchantment reaches the numbers (AC, to-hit, damage), a worn item occupies a
place on the body, and attunement is a real bond — three at most, formed by
choice, and an attunement item behaves mundane until it is.
*/

async function addByName(request: import("@playwright/test").APIRequestContext, heroId: string, name: string): Promise<string> {
  const list = (await (await request.get(`/api/rules/item`)).json()) as Array<{ id: string; name: string }>;
  const hit = list.find((e) => e.name === name);
  expect(hit, `${name} should be in the armory`).toBeTruthy();
  const res = await request.post(`/api/characters/${heroId}/items`, {
    data: { contentId: hit!.id, qty: 1 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

async function forgeFighter(page: import("@playwright/test").Page, tag: string): Promise<string> {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(tag));
  return forgeHero(page.request, {
    name: unique("Harkon "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
}

test("a +1 blade and +1 mail reach the numbers on the sheet", async ({ page }) => {
  const id = await forgeFighter(page, "magic");
  await addByName(page.request, id, "+1 Chain Mail");
  await addByName(page.request, id, "+1 Longsword");

  await page.goto(`/questboard/heroes/${id}`);
  const acBox = page
    .locator(`xpath=//div[contains(@class,'label-stamp') and normalize-space()='AC']/following-sibling::div`)
    .first();
  await expect(acBox).toHaveText("10", { timeout: 20_000 });

  // Equip the mail through the rig, the way a player does.
  await page.getByRole("button", { name: "Inventory" }).click();
  await page.getByRole("button", { name: /Armor.*empty/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /\+1 Chain Mail/ }).click();

  // The armory select knows its shelves now — spot the rarity group.
  await expect(page.locator("optgroup[label='Uncommon']")).toBeAttached();

  // Equip the blade from its tile; the attacks strip counts the enchantment.
  await page.getByRole("button", { name: /\+1 Longsword/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Equip · Main Hand" }).click();
  await page.getByTitle("Close").click();
  await expect(page.getByText("+6 to hit · 1d8+4 slashing")).toBeVisible();

  await page.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("17"); // 16 chain mail + 1 enchantment
});

test("a worn cloak takes its place, and the bond is what wakes it", async ({ page }) => {
  const id = await forgeFighter(page, "attune");
  const cloakId = await addByName(page.request, id, "Cloak of Protection");

  await page.goto(`/questboard/heroes/${id}`);
  const acBox = page
    .locator(`xpath=//div[contains(@class,'label-stamp') and normalize-space()='AC']/following-sibling::div`)
    .first();
  await expect(acBox).toHaveText("10", { timeout: 20_000 });

  await page.getByRole("button", { name: "Inventory" }).click();
  await page.getByRole("button", { name: /Cloak of Protection/ }).first().click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Wear · Cloak" }).click();
  await page.getByTitle("Close").click();

  // Worn but unattuned: it hangs there, mundane.
  await expect(page.getByText("Cloak", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("10");

  // The bond wakes it.
  await page.getByRole("button", { name: "Inventory" }).click();
  await page.getByRole("button", { name: /Cloak of Protection/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Attune", exact: true }).click();
  await page.getByTitle("Close").click();
  await expect(page.getByText("Attuned 1/3")).toBeVisible();
  await page.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("11");

  // Three bonds are the ceiling, in the server's own words — and stowing the
  // cloak breaks nothing: the bond is not the wearing.
  const ring1 = await addByName(page.request, id, "Ring of Protection");
  const amulet = await addByName(page.request, id, "Amulet of Health");
  const ring2 = await addByName(page.request, id, "Ring of Warmth");
  for (const itemId of [ring1, amulet]) {
    const res = await page.request.patch(`/api/characters/${id}/items/${itemId}`, {
      data: { attuned: true },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const fourth = await page.request.patch(`/api/characters/${id}/items/${ring2}`, {
    data: { attuned: true },
  });
  expect(fourth.status()).toBe(400);
  expect(await fourth.text()).toContain("three items are the most a hero can attune to");

  const stow = await page.request.patch(`/api/characters/${id}/items/${cloakId}`, {
    data: { equipped: false },
  });
  expect(stow.ok(), await stow.text()).toBeTruthy();
  // The bonds were formed over the API — a fresh read shows all three held,
  // the stowed cloak among them.
  await page.reload();
  await page.getByRole("button", { name: "Inventory" }).click();
  await expect(page.getByText("Attuned 3/3")).toBeVisible({ timeout: 20_000 });
});
