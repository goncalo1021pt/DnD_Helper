import { expect, test } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
Resource pools (#175).

Rages, Channel Divinity, Focus Points lived on paper while the app tracked
spell slots. The journey worth protecting is the whole loop: the sheet grows
the pool its class grants, spending is a click, and the rest gives back
exactly what the 2024 rules say — a Barbarian's short rest returns ONE rage,
not all of them, which is precisely the sort of rule a hand-rolled tracker
gets wrong at midnight.
*/

async function levelTo(request: import("@playwright/test").APIRequestContext, id: string, level: number) {
  for (let at = 1; at < level; at++) {
    const res = await request.post(`/api/characters/${id}/levelup`, {
      data: { hpMode: "average" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
}

test("a Barbarian's Rages: spent by pip, one back per short rest", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("pools"));
  const id = await forgeHero(page.request, {
    name: unique("Skarra "),
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 17, dex: 14, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Survival"],
  });

  await page.goto(`/questboard/heroes/${id}`);
  await expect(page.getByText("Resources")).toBeVisible({ timeout: 20_000 });

  // The pool the class declares, stamped with who granted it: two rages at
  // level 1, all still gold.
  const rages = page.getByRole("group", { name: "Rages" });
  await expect(rages).toBeVisible();
  await expect(rages.getByTitle("click to spend")).toHaveCount(2);

  // Spend both. Each click is a PUT the server judges — not a local checkbox.
  await rages.getByTitle("click to spend").first().click();
  await expect(rages.getByTitle("spent — click to restore")).toHaveCount(1);
  await rages.getByTitle("click to spend").first().click();
  await expect(rages.getByTitle("spent — click to restore")).toHaveCount(2);

  // An hour's breath: the 2024 rule hands back one rage, not the night's all.
  await page.getByRole("button", { name: "Short Rest" }).click();
  await expect(page.getByRole("status")).toContainText("Rages restored");
  await expect(rages.getByTitle("spent — click to restore")).toHaveCount(1);

  // The night returns the rest.
  await page.getByRole("button", { name: "Long Rest" }).click();
  await expect(page.getByRole("status")).toContainText("Rages restored");
  await expect(rages.getByTitle("spent — click to restore")).toHaveCount(0);
});

test("taking a Wild Shape form spends the pool, and an empty pool refuses", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("wildpool"));
  const id = await forgeHero(page.request, {
    name: unique("Bramble "),
    className: "Druid",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 17, cha: 8 },
    skills: ["Nature", "Perception"],
  });
  await levelTo(page.request, id, 2);

  await page.goto(`/questboard/heroes/${id}`);
  const shapes = page.getByRole("group", { name: "Wild Shape" });
  await expect(shapes).toBeVisible({ timeout: 20_000 });
  await expect(shapes.getByTitle("click to spend")).toHaveCount(2);

  // Know a form first: the picker, as a Druid would reach it.
  await page.getByRole("button", { name: "Add" }).first().click();
  const picker = page.getByRole("dialog");
  await picker.getByPlaceholder("Search…").fill("Wolf");
  await picker.getByRole("button", { name: /^Wolf/ }).locator("xpath=..").getByRole("button", { name: "Take" }).click();

  // Becoming the wolf costs a use; dropping the form refunds nothing.
  await page.getByRole("button", { name: "Take the form" }).click();
  await expect(shapes.getByTitle("spent — click to restore")).toHaveCount(1);
  await page.getByRole("button", { name: "Drop the form" }).click();
  await expect(shapes.getByTitle("spent — click to restore")).toHaveCount(1);

  // The second use goes the same way; the third ask is refused in the
  // server's own words, and the hero stays unshifted.
  await page.getByRole("button", { name: "Take the form" }).click();
  await expect(shapes.getByTitle("spent — click to restore")).toHaveCount(2);
  await page.getByRole("button", { name: "Drop the form" }).click();
  await page.getByRole("button", { name: "Take the form" }).click();
  await expect(page.getByRole("status").getByText("no uses of Wild Shape left — rest first")).toBeVisible();
  await expect(page.getByRole("button", { name: "Take the form" })).toBeVisible();
});

test("a Paladin's Lay On Hands: a points pool on a stepper, back with the night", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("layhands"));
  const id = await forgeHero(page.request, {
    name: unique("Serelith "),
    className: "Paladin",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 14 },
    skills: ["Athletics", "Intimidation"],
  });
  // Ten points at level 2 — past pips, onto the stepper.
  await levelTo(page.request, id, 2);

  await page.goto(`/questboard/heroes/${id}`);
  await expect(page.getByText("Resources")).toBeVisible({ timeout: 20_000 });

  // Scoped to the panel: the class's feature text also says "Lay On Hands",
  // and it should — the pool row is the one next to the counter.
  const resources = page.locator("section").filter({ hasText: "Resources" });
  await expect(resources.getByText("Lay On Hands")).toBeVisible();
  await expect(resources.getByText("10/10")).toBeVisible();

  const spend = page.getByRole("button", { name: "Spend Lay On Hands" });
  await spend.click();
  await expect(resources.getByText("9/10")).toBeVisible();
  await spend.click();
  await spend.click();
  await expect(resources.getByText("7/10")).toBeVisible();

  // An hour does nothing for it — the report stays quiet about it too.
  await page.getByRole("button", { name: "Short Rest" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText("Lay On Hands");
  await expect(resources.getByText("7/10")).toBeVisible();

  await page.getByRole("button", { name: "Long Rest" }).click();
  await expect(page.getByRole("status")).toContainText("Lay On Hands restored");
  await expect(resources.getByText("10/10")).toBeVisible();
});
