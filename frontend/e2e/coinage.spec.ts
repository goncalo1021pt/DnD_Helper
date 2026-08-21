import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  fundHero,
  joinCampaign,
  newAccount,
  quickAddHero,
  registerViaAPI,
  seatHero,
  unique,
} from "./helpers";

/*
The coin a table counts in (#195).

#174 shipped gold only and said where this would slot in. A DM names their own
money and the Bazaar prices and charges in it.

Two things are worth pinning. A purse counts BASE units — the ladder's smallest
coin — which is what lets it be broken back into coins for the sheet, and what
makes "15 gp" and "3 glm" comparable numbers at all. And changing the ladder
converts nothing: an invented coin has no rate against the one it replaces, so
the numbers stand and their meaning changes.
*/

const GLIMMER = [
  { name: "Shard", abbrev: "shd", value: 1 },
  { name: "Glimmer", abbrev: "glm", value: 10 },
  { name: "Crown", abbrev: "crn", value: 100 },
];

async function coinageOfCampaign(request: APIRequestContext, campaignId: string) {
  const list = await (await request.get("/api/campaigns")).json();
  return list.find((m: { campaign: { id: string } }) => m.campaign.id === campaignId).campaign
    .coinage;
}

test("a table with no coinage of its own counts in the coins of the books", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmcoin"));
  const campaign = await createCampaign(page.request, unique("Standard "));

  const coins = await coinageOfCampaign(page.request, campaign.id);
  expect(coins.map((c: { abbrev: string }) => c.abbrev)).toEqual(["cp", "sp", "ep", "gp", "pp"]);
});

test("a DM mints their own coin, and the till charges in it", async ({ browser }) => {
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmmint"));
  const campaign = await createCampaign(dm.request, unique("Glimmerwatch "));
  await createLocation(dm.request, campaign.id, "Shardfall");

  const minted = await dm.request.put(`/api/campaigns/${campaign.id}/coinage`, {
    data: { coins: GLIMMER },
  });
  expect(minted.ok(), await minted.text()).toBeTruthy();
  expect((await minted.json()).coinage.map((c: { abbrev: string }) => c.abbrev)).toEqual([
    "shd",
    "glm",
    "crn",
  ]);

  // A shop priced in the table's own coin.
  const shop = await (
    await dm.request.post(`/api/campaigns/${campaign.id}/vendors`, {
      data: { name: unique("The Mint "), revealed: true },
    })
  ).json();
  const stocked = await dm.request.post(`/api/vendors/${shop.id}/stock`, {
    data: { name: "A lantern", price: "3 glm", revealed: true },
  });
  expect(stocked.ok(), await stocked.text()).toBeTruthy();
  // Stocking answers with the whole shop, so the line is picked out of it.
  const line = (await stocked.json()).stock.find(
    (l: { name: string }) => l.name === "A lantern",
  );

  // A hero with 4 crowns and change: 412 shards.
  const hero = await quickAddHero(dm.request, campaign.id, unique("Nib "));
  const funded = await dm.request.post(`/api/characters/${hero}/items`, {
    data: { name: "Crown", qty: 412 },
  });
  expect(funded.ok(), await funded.text()).toBeTruthy();
  expect((await funded.json()).isPurse).toBe(true);

  const bought = await dm.request.post(`/api/stock/${line.id}/buy`, {
    data: { characterId: hero },
  });
  expect(bought.ok(), await bought.text()).toBeTruthy();
  const receipt = await bought.json();
  expect(receipt.paidGp).toBe(30);
  expect(receipt.goldRemaining).toBe(382);

  // And gold is not a coin at a table that never minted one.
  const gilded = await dm.request.post(`/api/vendors/${shop.id}/stock`, {
    data: { name: "A gilded cup", price: "5 gp", revealed: true },
  });
  const cup = (await gilded.json()).stock.find(
    (l: { name: string }) => l.name === "A gilded cup",
  );
  const refused = await dm.request.post(`/api/stock/${cup.id}/buy`, {
    data: { characterId: hero },
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain("no price the till can take");

  await ctx.close();
});

test("a ladder has to be one a purse could actually be counted out in", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmbadcoin"));
  const campaign = await createCampaign(page.request, unique("Bad Mint "));
  const put = (coins: unknown) =>
    page.request.put(`/api/campaigns/${campaign.id}/coinage`, { data: { coins } });

  // The smallest coin is what everything is counted in, so it is worth 1.
  let res = await put([{ name: "Crown", abbrev: "crn", value: 5 }]);
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("worth exactly 1");

  // Two coins cannot share a short form — a price could not say which.
  res = await put([
    { name: "Shard", abbrev: "shd", value: 1 },
    { name: "Sharder", abbrev: "SHD", value: 10 },
  ]);
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("share the short form");

  // Nor can two be worth the same.
  res = await put([
    { name: "Shard", abbrev: "shd", value: 1 },
    { name: "Chip", abbrev: "chp", value: 1 },
  ]);
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain("worth the same");

  // A short form has to read as a price, so it is letters and nothing else.
  res = await put([{ name: "Shard", abbrev: "s#d", value: 1 }]);
  expect(res.status()).toBe(400);

  // And an empty ladder puts the table back on the books' own coins.
  res = await put([]);
  expect(res.ok(), await res.text()).toBeTruthy();
  expect((await res.json()).coinage.map((c: { abbrev: string }) => c.abbrev)).toEqual([
    "cp", "sp", "ep", "gp", "pp",
  ]);
});

test("a player never mints the table's money", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmown"));
  const campaign = await createCampaign(dm.request, unique("Not Yours "));

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plown"));
  await joinCampaign(pl.request, campaign.inviteCode);

  const tried = await pl.request.put(`/api/campaigns/${campaign.id}/coinage`, {
    data: { coins: GLIMMER },
  });
  expect(tried.status()).toBe(403);

  await dmCtx.close();
  await plCtx.close();
});

test("a purse reads in gold and change, never up into platinum", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmpurse"));
  const campaign = await createCampaign(dm.request, unique("Reading "));

  // The purse chip belongs to the BUYER, and a DM buys as nobody — so this is
  // read from a player's browser, with a hero of their own.
  const plCtx = await browser.newContext();
  const page = await plCtx.newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("plpurse"));
  await joinCampaign(page.request, campaign.inviteCode);
  const hero = (
    await (
      await page.request.post("/api/me/characters", {
        data: { name: unique("Coinbearer "), class: "Rogue", level: 2, hpCurrent: 12, hpMax: 12 },
      })
    ).json()
  ).id as string;
  await seatHero(page.request, hero, campaign.id);
  await fundHero(page.request, hero, 40);

  await page.goto(`/questboard/campaigns/${campaign.id}/vendors`);
  // Forty gold is forty gold. Four platinum is arithmetically the same number
  // and no table has ever said it.
  await expect(page.getByText("40 gp", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("4 pp", { exact: true })).toHaveCount(0);

  await dmCtx.close();
  await plCtx.close();
});
