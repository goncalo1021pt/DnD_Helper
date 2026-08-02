import { expect, test } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  joinCampaign,
  newAccount,
  registerViaAPI,
  unique,
} from "./helpers";

/*
Shops, and who has been told about them (#102).

A vendor is prep, like an encounter: the DM stocks it at home and the party
meets it at the table. Filed under a place, so the places tree does the work of
"who is open where".

The assertion that matters is the redaction, and it is made from the PLAYER's
browser. A hidden shop is not sent with a flag for the UI to respect — it is not
sent at all — so a page that forgot to hide something would still fail here,
where a DM-side test could not tell the difference.
*/
test("a shop is the DM's until they show it, shelf by shelf", async ({ browser }) => {
  const dm = newAccount("dmshop");
  const player = newAccount("plshop");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Trade Road "));
  const town = await createLocation(dmPage.request, campaign.id, unique("Phandalin "));

  const shop = unique("Barthen's ");
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/vendors`);
  await dmPage.getByPlaceholder("Open a shop — name it…").fill(shop);
  await dmPage.getByLabel("Where it trades").selectOption(town);
  await dmPage.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dmPage.getByText(shop)).toBeVisible({ timeout: 20_000 });

  // Two things on the shelves: one for the counter, one for under it.
  const stock = dmPage.getByLabel(`Stock ${shop}`);
  await stock.selectOption({ label: "Chain Mail" });
  await dmPage.getByRole("button", { name: "Stock it" }).click();
  await expect(dmPage.getByRole("button", { name: /^Chain Mail/ })).toBeVisible({ timeout: 20_000 });
  await stock.selectOption({ label: "Longsword" });
  await dmPage.getByRole("button", { name: "Stock it" }).click();
  await expect(dmPage.getByRole("button", { name: /^Longsword/ })).toBeVisible();

  // --- the player, before anything is shown --------------------------------
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);
  await plPage.goto(`/questboard/campaigns/${campaign.id}/vendors`);
  await expect(plPage.getByText(/Nobody is trading that you know of/)).toBeVisible({
    timeout: 20_000,
  });
  // Not merely hidden on screen — the server never sent it.
  const unseen = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/vendors`)
  ).json()) as unknown[];
  expect(unseen, "an unrevealed shop must not reach the player at all").toEqual([]);

  // --- the DM opens the doors, and puts ONE item on the counter -------------
  await dmPage.getByRole("button", { name: "Hidden from the party" }).click();
  await expect(dmPage.getByRole("button", { name: "The party knows it" })).toBeVisible();
  await dmPage.getByRole("button", { name: "Show Chain Mail" }).click();

  await plPage.reload();
  await expect(plPage.getByText(shop)).toBeVisible({ timeout: 20_000 });
  await expect(plPage.getByRole("button", { name: /^Chain Mail/ })).toBeVisible();
  // The longsword is still under the counter.
  await expect(plPage.getByRole("button", { name: /^Longsword/ })).toHaveCount(0);

  const seen = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/vendors`)
  ).json()) as Array<{ name: string; locationName: string; stock: Array<{ name: string }> }>;
  expect(seen).toHaveLength(1);
  expect(seen[0].locationName, "the shop carries the place it trades in").toContain("Phandalin");
  expect(
    seen[0].stock.map((s) => s.name),
    "only the revealed line travels",
  ).toEqual(["Chain Mail"]);

  // And the player cannot reach in and change it.
  const refused = await plPage.request.post(`/api/vendors/${"00000000-0000-0000-0000-000000000000"}/stock`, {
    data: { name: "A Free Sword" },
  });
  expect(refused.ok(), "a player cannot stock a shop").toBeFalsy();

  await dmCtx.close();
  await plCtx.close();
});
