import { expect, test } from "@playwright/test";
import { createCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Copying a creature, and then actually being able to edit it (#127).

Two things had to be true for this to mean anything, and only one of them was
asked for. The copy has to bring the stat block across — otherwise it is a
blank page with a familiar name — and the copy has to be editable, which it was
not: the content form had no field set for monsters at all and fell through to
the *feat* form, offering a Category dropdown over a copied dragon. The only way
to change a monster's hit points was the Raw Scroll JSON tab.

So the assertions are the numbers. "A form opened" was true of the feat form too.
*/
test("a creature can be copied, renamed, restatted, and struck", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("den"));
  const campaign = await createCampaign(page.request, unique("The Menagerie "));
  const mine = unique("Goblin Chieftain ");

  await page.goto(`/questboard/campaigns/${campaign.id}/den`);
  await page.getByPlaceholder("Search by name or type…").fill("Goblin Warrior");
  await page.getByRole("button", { name: /^Goblin Warrior/ }).first().click();

  // --- copy ----------------------------------------------------------------
  const reading = page.getByRole("dialog");
  await expect(reading.getByText("Goblin Warrior").first()).toBeVisible();
  await reading.getByRole("button", { name: "Copy" }).click();

  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "Copy a Monster" })).toBeVisible();

  // The suggested name is free — the server refuses a second homebrew monster
  // of the same name, so offering "Goblin Warrior" would fail on first press.
  const name = form.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Goblin Warrior (copy)");

  // And the stats came across, which is the whole point of copying.
  await expect(form.getByLabel("Hit points", { exact: true })).toHaveValue("10");
  await expect(form.getByLabel("AC", { exact: true })).toHaveValue("15");
  await expect(form.getByLabel("STR", { exact: true })).toHaveValue("8");

  // Now make it a chieftain: a real edit of name and stats, in the guided form
  // rather than the JSON tab.
  await name.fill(mine);
  await form.getByLabel("Hit points", { exact: true }).fill("39");
  await form.getByLabel("Challenge").fill("2 (XP 450; PB +2)");
  await expect(form.getByText(/sorts and weighs as CR 2/)).toBeVisible();
  await form.getByRole("button", { name: "Scribe It" }).click();

  // The search box is still narrowed to the goblin it was copied from, and the
  // chieftain is not called that any more — so look for it by its own name.
  await page.getByPlaceholder("Search by name or type…").fill(mine);

  // It is in the Den, at its new challenge rather than the goblin's.
  const card = page.getByRole("button", { name: new RegExp(`^${mine}`) });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("CR 2");

  // --- amend ---------------------------------------------------------------
  await card.click();
  await page.getByRole("dialog").getByRole("button", { name: "Amend" }).click();
  const amend = page.getByRole("dialog");
  await expect(amend.getByRole("heading", { name: new RegExp(`Amend ${mine}`) })).toBeVisible();
  await amend.getByLabel("AC", { exact: true }).fill("17");
  await amend.getByRole("button", { name: "Scribe It" }).click();

  await expect(page.getByRole("button", { name: new RegExp(`^${mine}`) })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: new RegExp(`^${mine}`) }).click();
  await expect(page.getByRole("dialog").getByText(/\b17\b/).first()).toBeVisible();

  // --- strike --------------------------------------------------------------
  // The confirm() is a real browser dialog; Playwright dismisses them by
  // default, which would quietly turn this into a test of nothing happening.
  page.on("dialog", (d) => d.accept());
  await page.getByRole("dialog").getByRole("button", { name: "Strike" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${mine}`) })).toHaveCount(0, {
    timeout: 20_000,
  });

  // The goblin it was copied from is untouched — a copy is a new creature, not
  // a fork of the original.
  await page.getByPlaceholder("Search by name or type…").fill("Goblin Warrior");
  await expect(page.getByRole("button", { name: /^Goblin Warrior/ }).first()).toBeVisible();
});
