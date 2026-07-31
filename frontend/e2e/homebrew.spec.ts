import { test, expect } from "@playwright/test";
import { createCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Scribing homebrew, through the form that writes it.

ContentForm is 751 lines — of which GuidedFields is 485, a chain of per-kind
branches that turn typed fields into the `data` object the rest of the app reads
as rules. It is the last of #108's six and has never had a test.

What matters about it is not that the form submits. It is that the *shape* it
writes is the shape everything downstream expects: `slotsFor` reads `data.type`,
`acFromEquipment` reads `data.ac`, the codex rules on `data.class`. A form that
saves a homebrew plate mail under the wrong key produces an item that cannot be
worn and never says why. So these assert the stored object, not the toast.
*/

test("a scribed piece of armour is stored in the shape the sheet reads", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("scribe"));

  const name = unique("Dwarven Plate ");
  await page.goto("/questboard/archives");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await page.getByRole("button", { name: /Scribe an? Item/ }).click();

  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(name);
  // The guided fields, not a JSON blob: pick the category and the form offers
  // the numbers that category actually has.
  await form.getByLabel("Item type").selectOption("armor");
  // Category is not decoration: the server refuses armour without one
  // ("armor category must be Light, Medium or Heavy"), so the guided field is
  // carrying a rule, not just a label.
  await form.getByLabel("Category").selectOption("Heavy");
  await form.getByLabel("Base AC").fill("18");
  await form.getByRole("button", { name: "Scribe It" }).click();

  // The shape is the point. `type` and `ac` are the two keys the hero sheet
  // reads to decide what can be worn and what wearing it is worth.
  const items = (await (await page.request.get("/api/rules/item")).json()) as Array<{
    name: string;
    data: { type?: string; ac?: number };
  }>;
  const mine = items.find((i) => i.name === name);
  expect(mine, "the scribed item should be in the armory").toBeTruthy();
  expect(mine!.data.type).toBe("armor");
  expect(mine!.data.ac).toBe(18);

  // And it is on the shelf, under the category it was given.
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
});

/*
The Den is the same component through a different door, and monster is the one
kind GuidedFields has no branch for — it falls through to the raw entry instead.
Worth its own test precisely because it is the path the guided fields do not
cover: a refactor that reorders those branches could swallow it silently.
*/
test("a monster scribed in the Den joins the bestiary and can be fought", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("den"));

  const name = unique("Gloomfang ");
  // The Den belongs to a table, not to the account.
  const campaign = await createCampaign(page.request, unique("Den Table "));
  await page.goto(`/questboard/campaigns/${campaign.id}/den`);
  await page.getByRole("button", { name: "Scribe a Monster" }).first().click();

  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: "Scribe It" }).click();

  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });

  const monsters = (await (await page.request.get("/api/rules/monster")).json()) as Array<{
    name: string;
    source: string;
  }>;
  const mine = monsters.find((m) => m.name === name);
  expect(mine, "the scribed monster should be in the Den").toBeTruthy();
  expect(mine!.source).toBe("homebrew");
});
