import { test, expect } from "@playwright/test";
import { newAccount, registerViaAPI, createCampaign, unique } from "./helpers";

// Exploratory-harness plumbing probe: proves per-file invocation, API setup,
// screenshots to exp-shots/, and timing capture all work before the fleet runs.
test("probe: register, found a table, land in the hall", async ({ page }) => {
  const dm = newAccount("xqprobe");
  await registerViaAPI(page.request, dm);
  const camp = await createCampaign(page.request, unique("Probe Hall "));
  expect(camp.inviteCode).toBeTruthy();

  const t0 = Date.now();
  await page.goto(`/questboard/campaigns/${camp.id}`);
  await expect(page.getByText(camp.name.trim().slice(0, 12), { exact: false }).first()).toBeVisible();
  const hallMs = Date.now() - t0;

  await page.screenshot({ path: "exp-shots/probe/01-hall.png", fullPage: true });
  console.log(`TIMING hall-load ${hallMs}ms`);
  expect(hallMs).toBeLessThan(30_000);
});
