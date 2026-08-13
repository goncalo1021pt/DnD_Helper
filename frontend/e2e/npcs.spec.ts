import { expect, test } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  joinCampaign,
  newAccount,
  registerViaAPI,
  revealLocation,
  unique,
} from "./helpers";

/*
The people of a campaign, and who has been told about them (#215).

An NPC is prep, like a shop: drafted at home, met at the table. Two veils
stand over each person — being known at all, and having their numbers
readable — and the place tree above them has the final word on the first.

The assertions that matter are made from the PLAYER's browser, against both
the page and the API: a hidden person is not sent with a flag for the UI to
respect, they are not sent at all. And a person can be known while their stat
block still is not — the second veil moves on its own.
*/
test("a person is a rumor until the DM says otherwise — and their numbers are a second secret", async ({ browser }) => {
  const dm = newAccount("dmfolk");
  const player = newAccount("plfolk");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Harbour Watch "));
  const town = await createLocation(dmPage.request, campaign.id, unique("Porto "));

  const captain = unique("Captain Amélia ");
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await dmPage.getByPlaceholder("Bring in a person — name them…").fill(captain);
  await dmPage.getByLabel("Where they are found").selectOption(town);
  await dmPage.getByRole("button", { name: "Bring in", exact: true }).click();
  await expect(dmPage.getByText(captain)).toBeVisible({ timeout: 20_000 });

  // A stat block stands behind her: an SRD monster out of the Den.
  await dmPage.getByLabel(`Attach a stat block to ${captain}`).fill("Aboleth");
  await dmPage.getByRole("button", { name: "Aboleth", exact: true }).click();
  await expect(
    dmPage.getByRole("button", { name: `Read their stat block — Aboleth` }),
  ).toBeVisible({ timeout: 20_000 });

  // --- the player, before anything is shown --------------------------------
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);
  await plPage.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await expect(plPage.getByText(/You have met no one worth writing down/)).toBeVisible({
    timeout: 20_000,
  });
  const unseen = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)
  ).json()) as unknown[];
  expect(unseen, "an unrevealed person must not reach the player at all").toEqual([]);

  // --- the DM reveals HER, but Porto itself is still veiled -----------------
  await dmPage.getByRole("button", { name: "Unknown to the party" }).click();
  await expect(dmPage.getByRole("button", { name: "The party knows them" })).toBeVisible();

  const stillDark = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)
  ).json()) as unknown[];
  expect(stillDark, "a veiled place hides its people, whatever their own veil says").toEqual([]);

  // --- Porto's veil lifts: the person is known, the numbers are not ---------
  await revealLocation(dmPage.request, town);

  await plPage.reload();
  await expect(plPage.getByText(captain)).toBeVisible({ timeout: 20_000 });
  await expect(plPage.getByRole("button", { name: /Read their stat block/ })).toHaveCount(0);
  const known = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)
  ).json()) as Array<{ name: string; locationName: string; statBlock?: unknown }>;
  expect(known).toHaveLength(1);
  expect(known[0].locationName, "the person carries the place they are found in").toContain("Porto");
  expect(known[0].statBlock, "the stats stay behind their own veil").toBeUndefined();

  // --- the second veil opens ------------------------------------------------
  await dmPage.getByRole("button", { name: "Stats veiled" }).click();
  await expect(dmPage.getByRole("button", { name: "Stats open" })).toBeVisible();

  await plPage.reload();
  await plPage.getByRole("button", { name: `Read their stat block — Aboleth` }).click();
  await expect(plPage.getByText(/Aberration/i).first()).toBeVisible({ timeout: 20_000 });

  // And the player cannot reach in and change anyone.
  const npcId = (
    (await (await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)).json()) as Array<{
      id: string;
    }>
  )[0].id;
  const refused = await plPage.request.patch(`/api/npcs/${npcId}`, {
    data: { name: "Nobody" },
  });
  expect(refused.ok(), "a player cannot amend a person").toBeFalsy();

  await dmCtx.close();
  await plCtx.close();
});
