import { test, expect, type Page } from "@playwright/test";
import { createCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
The DM's combat tool: prepare a fight at home, trigger it at the table, run
initiative.

EncounterPage.tsx is 1,313 lines and grew 70% in a single release — the second
target of #108, and the surface where a regression is most expensive, because
it breaks in front of six people mid-session.
*/

test("prepares an encounter from the Den, triggers it, and runs initiative", async ({
  page,
}) => {
  const account = newAccount("dm");
  await registerViaAPI(page.request, account);
  const { id: campaignId } = await createCampaign(page.request, unique("Ambush Table "));

  await page.goto(`/questboard/campaigns/${campaignId}/encounters`);

  // --- prepare, ahead of the session --------------------------------------
  await page.getByPlaceholder("Prepare a new encounter — name it…").fill("Goblin Ambush");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(page.getByText("Goblin Ambush")).toBeVisible();
  await expect(page.getByText(/INACTIVE/i)).toBeVisible();

  // --- stock it from the Den ----------------------------------------------
  await page.getByPlaceholder("Search monsters…").fill("Goblin Warrior");
  await expect(page.getByText(/1 of 330 creatures|of 330 creatures/i)).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  // --- trigger it at the table --------------------------------------------
  const trigger = page.getByRole("button", { name: /Trigger/ });
  await expect(trigger).toBeEnabled();
  await trigger.click();

  // The fight is running and the tracker is up.
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Goblin Warrior").first()).toBeVisible();
});

/**
 * Stock the fight from the Den. The Den holds 330 creatures and the search has
 * to come back before Add means anything, so wait on the button rather than on
 * a count that the content can change under us.
 */
async function addFromDen(page: Page, monster: string, qty = 1): Promise<void> {
  await page.getByPlaceholder("Search monsters…").fill(monster);
  const add = page.getByRole("button", { name: "Add", exact: true }).first();
  await expect(add).toBeEnabled({ timeout: 20_000 });
  for (let i = 1; i < qty; i++) await page.getByTitle("One more").first().click();
  await add.click();
}

/*
A mob is one turn, not eight.

The subtlest thing in EncounterPage, and the one with the least to show for
itself on screen: monsters added together share an initiative and act as a
single entry, so `toEntries` collapses them into one row and the turn stepper
translates between entries and the stored `turnIndex`. Its own comment says why
— "otherwise a pack of eight skeletons would eat eight presses of Next turn".

Nothing tested it, and it is exactly the kind of index arithmetic that survives
a refactor looking fine and breaks in front of six people mid-session. With a
mob as the only entry, one press must come all the way round to Round 2; were
the members separate entries it would take three.
*/
test("a mob of monsters takes one turn between them", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("mob"));
  const { id: campaignId } = await createCampaign(page.request, unique("Crypt Table "));

  await page.goto(`/questboard/campaigns/${campaignId}/encounters`);
  await page.getByPlaceholder("Prepare a new encounter — name it…").fill("Skeleton Crypt");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

  // Three of the same creature, added in one go — that is what makes a mob.
  await addFromDen(page, "Skeleton", 3);

  await page.getByRole("button", { name: /Trigger/ }).click();
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });

  // One row for the three of them. The two initiative fields differ by title,
  // which is the only thing that tells a group row from a lone combatant.
  await expect(page.getByTitle("Initiative for the whole group")).toHaveCount(1);
  await expect(page.getByTitle("Type an initiative")).toHaveCount(0);

  // And therefore one press of Next turn wraps the round rather than stepping
  // through the skeletons one at a time.
  await page.getByRole("button", { name: /Next turn/ }).click();
  await expect(page.getByText(/Round\s*2/i)).toBeVisible();
});

/*
Damage lands on the combatant, and standing down puts the fight back in its box.

Two paths either side of the seam the split will cut: `CombatantRow`'s HP
arithmetic, and `EncounterRunner`'s choice between the tracker and the builder.
The second is a one-line ternary that decides which half of a 1,313-line file
you are looking at, so it is worth a test that says which.
*/
test("a hero takes damage, and standing down returns the fight to the builder", async ({
  page,
}) => {
  await registerViaAPI(page.request, newAccount("wound"));
  const { id: campaignId } = await createCampaign(page.request, unique("Bruised Table "));

  await page.goto(`/questboard/campaigns/${campaignId}/encounters`);
  await page.getByPlaceholder("Prepare a new encounter — name it…").fill("A Bad Afternoon");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await addFromDen(page, "Goblin Warrior");
  await page.getByRole("button", { name: /Trigger/ }).click();
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });

  // Read the goblin's hit points rather than asserting a number: the stat block
  // belongs to the SRD content, and what is under test is `applyHp`'s
  // arithmetic, which should hold whatever the Den says the creature has.
  const hp = page.getByText(/^\d+\/\d+$/).first();
  const [before, max] = (await hp.innerText()).split("/").map(Number);
  expect(before).toBeGreaterThan(3);

  await page.getByTitle("Amount to damage or heal").first().fill("3");
  // exact: the amount field is titled "Amount to damage or heal", and getByTitle
  // matches substrings case-insensitively — without this it is the input that
  // gets clicked, and the test passes its way to a hero who never got hurt.
  await page.getByTitle("Damage", { exact: true }).first().click();
  await expect(hp).toHaveText(`${before - 3}/${max}`);

  // Standing down releases the party and hands back the builder — the monsters
  // stay prepared, so the fight can be triggered again.
  await page.getByRole("button", { name: "Stand down" }).click();
  await expect(page.getByRole("button", { name: /Trigger/ })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText(/Round\s*\d/i)).toHaveCount(0);
});
