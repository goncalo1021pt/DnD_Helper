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

const forgeButton = (page: Page) => page.getByRole("button", { name: "Forge the Hero" });

/**
 * Walks a Fighter through every step and stops with the name typed and the
 * Forge button armed, so a test can decide what pressing it should mean.
 */
async function walkTheWizard(page: Page, heroName: string): Promise<void> {
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

  await expect(forgeButton(page)).toBeEnabled();
}

test("forges a hero through every step and lands on their sheet", async ({ page }) => {
  const account = newAccount("forge");
  await registerViaAPI(page.request, account);

  const heroName = unique("Thora ");
  await walkTheWizard(page, heroName);
  await forgeButton(page).click();

  // The hero exists and their sheet reads back what we chose.
  await expect(page.getByText(heroName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Fighter/).first()).toBeVisible();
});

/*
The other half of #130, and the half that is silent when it breaks.

The reported failure, played out exactly: the forge POST lands and builds the
hero, and then the connection dies on the way back with the answer. The player
sees nothing happen, so they press Forge again. Without the idempotency key that
second press builds a second hero out of the same twenty minutes of choices, and
nothing on screen ever says so — they simply find twins in My Heroes.

Driven through the UI rather than by replaying a captured request, because the
key lives in a `useRef` that deliberately outlives a failed attempt: it is the
*wizard* keeping its promise across the retry that is under test, not just the
server's half of it. (It also cannot be tested by replay — the transport builds
its Request in a way Chromium will not hand a body back for, so
`postDataJSON()` is null.)
*/
test("a hero forged twice after a timeout is still one hero", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("twins"));
  const heroName = unique("Bruenor ");

  let attempts = 0;
  await page.route("**/api/me/characters/forge", async (route) => {
    if (++attempts > 1) return route.continue();
    // Let the first attempt reach the server — the hero really is built — and
    // then swallow the answer. That is what a connection dying on the way back
    // looks like, and it is the case the client had no reply to.
    await route.fetch();
    await new Promise((r) => setTimeout(r, 30_000));
    await route.abort();
  });

  await walkTheWizard(page, heroName);
  await forgeButton(page).click();

  // The wizard gives up rather than thinking forever, and hands the button back.
  await expect(forgeButton(page)).toBeEnabled({ timeout: 40_000 });

  // The player, having seen nothing happen, presses again.
  await forgeButton(page).click();
  await expect(page).toHaveURL(/\/questboard\/profile/, { timeout: 20_000 });

  // One hero, not twins. Were the key not carried across the retry — or not
  // honoured — this is where the second Bruenor would show up.
  const all = (await (await page.request.get("/api/me/characters")).json()) as { name: string }[];
  expect(all.filter((h) => h.name === heroName)).toHaveLength(1);
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
