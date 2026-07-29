import { test, expect, type Page } from "@playwright/test";
import { newAccount, registerViaAPI, unique } from "./helpers";

/*
The Forge wizard, end to end, and onto the hero sheet it produces.

ForgeWizard.tsx is the single largest component in the app (1,411 lines) and
the first target of the refactor in #108 — this is the net under it. It walks
every step the 2024 flow asks for and then proves the hero it forged is real by
reading the sheet back.

A Fighter is deliberate: no spell step, so the path stays about the wizard's
mechanics rather than spell selection, which spells.spec covers separately.
*/

const nextStep = (page: Page) => page.getByRole("button", { name: /Next →/ });

test("forges a hero through every step and lands on their sheet", async ({ page }) => {
  const account = newAccount("forge");
  await registerViaAPI(page.request, account);

  const heroName = unique("Thora ");
  await page.goto("/questboard/heroes/forge");

  // --- Class: pick the class, then the skills it grants -------------------
  await expect(page.getByRole("heading", { name: "The Forge" })).toBeVisible();
  await page.getByRole("button", { name: /^Fighter/ }).click();
  // A Fighter chooses two skills before the step will let you leave. These two
  // deliberately avoid what Soldier grants below — the overlap has its own test.
  await page.getByRole("button", { name: "Perception", exact: true }).click();
  await page.getByRole("button", { name: "Survival", exact: true }).click();
  await expect(nextStep(page)).toBeEnabled();
  await nextStep(page).click();

  // --- Background ---------------------------------------------------------
  await page.getByRole("button", { name: /^Soldier/ }).click();
  await expect(nextStep(page)).toBeEnabled();
  await nextStep(page).click();

  // --- Species ------------------------------------------------------------
  await page.getByRole("button", { name: /^Dwarf/ }).click();
  await expect(nextStep(page)).toBeEnabled();
  await nextStep(page).click();

  // --- Abilities ----------------------------------------------------------
  // The wizard offers a per-class recommended spread; taking it also exercises
  // the shortcut a hurried player actually uses at the table.
  await page.getByRole("button", { name: /★ Recommended/ }).click();
  // The background's own bonus still has to be aimed somewhere.
  const bonusTargets = page.locator("select");
  await bonusTargets.nth(7).selectOption("STR");
  await bonusTargets.nth(8).selectOption("CON");
  await expect(nextStep(page)).toBeEnabled();
  await nextStep(page).click();

  // --- Gear: one of the class's starting kits ------------------------------
  await expect(page.getByText(/Starting equipment/i)).toBeVisible();
  await page.getByRole("button", { name: /Chain Mail/ }).click();
  await expect(nextStep(page)).toBeEnabled();
  await nextStep(page).click();

  // --- Name and forge -----------------------------------------------------
  await expect(page.getByText(/The hero's name/i)).toBeVisible();
  await page.getByRole("textbox").last().fill(heroName);

  const forge = page.getByRole("button", { name: "Forge the Hero" });
  await expect(forge).toBeEnabled();
  await forge.click();

  // The hero exists and their sheet reads back what we chose.
  await expect(page.getByText(heroName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Fighter/).first()).toBeVisible();
});

/*
A background can grant a skill the class step already spent a pick on. The
wizard takes the duplicate back rather than silently wasting it (#56), and says
so — the fix for creation failures that used to be a shrug.
*/
test("says so when the background eats a class skill pick", async ({ page }) => {
  const account = newAccount("conflict");
  await registerViaAPI(page.request, account);

  await page.goto("/questboard/heroes/forge");
  await page.getByRole("button", { name: /^Fighter/ }).click();
  // Soldier grants exactly these two.
  await page.getByRole("button", { name: "Athletics", exact: true }).click();
  await page.getByRole("button", { name: "Intimidation", exact: true }).click();
  await nextStep(page).click();

  await page.getByRole("button", { name: /^Soldier/ }).click();
  await nextStep(page).click();

  // The Class step is flagged the moment the overlap happens, so the player is
  // not carried all the way to the end before finding out.
  await expect(page.getByRole("button", { name: /^Class\s*!/ })).toBeVisible();

  // Going back shows the picks were handed back, not silently wasted: the step
  // will not let you leave again until two fresh skills are chosen.
  await page.getByRole("button", { name: /^Class\s*!/ }).click();
  await expect(nextStep(page)).toBeDisabled();

  // And the hero cannot be named, let alone forged, while it stands — the last
  // step is barred rather than reachable-but-broken.
  await expect(page.getByRole("button", { name: /^Name$/ })).toBeDisabled();

  // Choosing two skills the background does not grant clears it.
  await page.getByRole("button", { name: "Perception", exact: true }).click();
  await page.getByRole("button", { name: "Survival", exact: true }).click();
  await expect(nextStep(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Class\s*!/ })).toHaveCount(0);
});
