import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  registerViaAPI,
  unique,
} from "./helpers";

/*
The campaign menus (v1.7): the seats-per-player cap and its dial in Table
Rules (#171), the DM's bench (#179), and the Player Menu with its door out
(#171). Setup goes through the API; the thing under test is driven in the UI.
*/

/** A lightweight account hero on the caller's My Heroes shelf. */
async function shelfHero(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/me/characters", {
    data: { name, class: "Wandering Sellsword", level: 2, hpCurrent: 16, hpMax: 16 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

/** Seat a hero, returning the raw response — some tests want the refusal. */
async function seatHero(request: APIRequestContext, characterId: string, campaignId: string | null) {
  return request.put(`/api/characters/${characterId}/seat`, {
    data: { campaignId },
  });
}

test("the table seats one hero per player until the DM widens the door", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("dm"));
  const campaign = await createCampaign(dmPage.request, unique("One Seat "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await registerViaAPI(plPage.request, newAccount("pl"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  const first = await shelfHero(plPage.request, unique("Aldan "));
  const second = await shelfHero(plPage.request, unique("Berrin "));

  // The first hero sits; the second is turned away with the reason.
  expect((await seatHero(plPage.request, first, campaign.id)).ok()).toBeTruthy();
  const refused = await seatHero(plPage.request, second, campaign.id);
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toContain("seats one hero per player");

  // The DM widens the door from Table Rules.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/dm`);
  await dmPage
    .getByRole("combobox")
    .filter({ hasText: /One hero each/ })
    .selectOption("2");
  // The dial reads back the wider cap once the server confirms it.
  await expect(
    dmPage.getByRole("combobox").filter({ hasText: /heroes each/ }),
  ).toHaveValue("2");

  // Now the second hero seats.
  const admitted = await seatHero(plPage.request, second, campaign.id);
  expect(admitted.ok(), await admitted.text()).toBeTruthy();
});

test("the DM benches a seated hero back to its owner's shelf", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("dm"));
  const campaign = await createCampaign(dmPage.request, unique("The Bench "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await registerViaAPI(plPage.request, newAccount("pl"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  const heroName = unique("Corvin ");
  const hero = await shelfHero(plPage.request, heroName);
  expect((await seatHero(plPage.request, hero, campaign.id)).ok()).toBeTruthy();

  // The DM benches from the party page. The confirm is a browser dialog.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/party`);
  dmPage.on("dialog", (d) => d.accept());
  await dmPage.getByRole("button", { name: "Bench" }).click();
  await expect(dmPage.getByRole("button", { name: "Bench" })).toHaveCount(0);

  // The hero is back on the owner's shelf, seated nowhere.
  const mine = await (await plPage.request.get("/api/me/characters")).json();
  const benched = mine.find((c: { id: string }) => c.id === hero);
  expect(benched.campaignId ?? null).toBeNull();
});

test("a player leaves the table from the Player Menu", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("dm"));
  const campaign = await createCampaign(dmPage.request, unique("The Long Walk "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await registerViaAPI(plPage.request, newAccount("pl"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  const heroName = unique("Darla ");
  const hero = await shelfHero(plPage.request, heroName);
  expect((await seatHero(plPage.request, hero, campaign.id)).ok()).toBeTruthy();

  // The rail carries the player in; their seat lists the hero.
  await plPage.goto(`/questboard/campaigns/${campaign.id}`);
  await plPage.getByRole("link", { name: "Player Menu" }).first().click();
  await expect(plPage.getByRole("heading", { name: "Your Seat" })).toBeVisible();
  await expect(plPage.getByRole("link", { name: heroName })).toBeVisible();

  // Leaving asks first, then walks them out to the campaign list.
  await plPage.getByRole("button", { name: "Leave this campaign" }).click();
  await plPage.getByRole("button", { name: "Leave the table" }).click();
  await expect(plPage).toHaveURL(/\/questboard$/);
  await expect(plPage.getByText(campaign.name)).toHaveCount(0);

  // Their hero came home rather than staying at a table they left.
  const mine = await (await plPage.request.get("/api/me/characters")).json();
  expect(mine.find((c: { id: string }) => c.id === hero).campaignId ?? null).toBeNull();

  // The DM's ledger no longer lists them.
  const members = await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/members`)
  ).json();
  expect(members).toHaveLength(1);
});
