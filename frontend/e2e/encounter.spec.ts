import { test, expect } from "@playwright/test";
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
