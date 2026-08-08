import { expect, test } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
The two-handed grip (#189).

A Versatile longsword rolls 1d8 beside a shield and 1d10 in both hands; a
Greatsword knows no one-handed grip at all. The rig says so before any number
does: taking the grip replaces the two hand tiles with one wide card, and the
shield it displaced is stowed in the same stroke — the classic sword-and-board
trade-off, enforced rather than remembered.
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

test("sword and board, then both hands on the blade", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("grip"));
  const id = await forgeHero(page.request, {
    name: unique("Torvald "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  const sword = await addByName(page.request, id, "Longsword");
  const shield = await addByName(page.request, id, "Shield");
  await addByName(page.request, id, "Greatsword");
  for (const [itemId, slot] of [[sword, "mainhand"], [shield, "offhand"]] as const) {
    const res = await page.request.patch(`/api/characters/${id}/items/${itemId}`, { data: { slot } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  await page.goto(`/questboard/heroes/${id}`);
  const acBox = page
    .locator(`xpath=//div[contains(@class,'label-stamp') and normalize-space()='AC']/following-sibling::div`)
    .first();
  await expect(acBox).toHaveText("12", { timeout: 20_000 }); // 10 + shield

  // One hand on the sword: the versatile die stays small.
  await page.getByRole("button", { name: "Inventory" }).click();
  await expect(page.getByText("+5 to hit · 1d8+3 slashing")).toBeVisible();

  // Take the grip: one wide card, the bigger die, and the shield stowed.
  await page.getByRole("button", { name: /^Longsword/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Equip · Both Hands" }).click();
  await page.getByTitle("Close").click();
  await expect(page.getByText("Both Hands", { exact: true })).toBeVisible();
  await expect(page.getByText("Off Hand", { exact: true })).toHaveCount(0);
  await expect(page.getByText("+5 to hit · 1d10+3 slashing")).toBeVisible();
  await page.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("10"); // the board is on the ground

  // The Greatsword offers no one-handed grip at all.
  await page.getByRole("button", { name: "Inventory" }).click();
  await page.getByRole("button", { name: /^Greatsword/ }).first().click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: "Equip · Main Hand" })).toHaveCount(0);
  await modal.getByRole("button", { name: "Equip · Both Hands" }).click();
  await page.getByTitle("Close").click();
  await expect(page.getByText("+5 to hit · 2d6+3 slashing")).toBeVisible();
});
