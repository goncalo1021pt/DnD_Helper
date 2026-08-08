import { expect, test } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  forgeHero,
  fundHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  seatHero,
  unique,
} from "./helpers";

/*
The Bazaar takes money (#174).

The journeys worth protecting: a priced line has a Buy that moves real coin
and real goods together; a shelf that empties says so and refuses politely; a
purse that cannot cover the asking is told what was asked; and a line the DM
kept under the counter cannot be bought even by guessing its id — the refusal
must read exactly like absence.
*/

test("coin for goods, sold-out shelves, and the till's refusals", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await playerCtx.newPage();

  // The DM opens a shop and stocks it: two priced lines and one under the counter.
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("till-dm"));
  const campaign = await createCampaign(dm.request, unique("Trade Winds "));
  await createLocation(dm.request, campaign.id, "Phandalin");
  await dm.goto(`/questboard/campaigns/${campaign.id}/vendors`);
  await dm.getByPlaceholder("Open a shop — name it…").fill(unique("Barthen's "));
  await dm.getByRole("button", { name: "Open", exact: true }).click();

  const stockByName = async (want: string, price: string, qty: string) => {
    await dm.getByLabel(/^Stock Barthen's/).selectOption({ label: want });
    await dm.getByLabel("Price for the new line").fill(price);
    await dm.getByLabel("Quantity for the new line").fill(qty);
    await dm.getByRole("button", { name: "Stock it" }).click();
    await expect(dm.getByRole("button", { name: want, exact: true })).toBeVisible();
  };
  await stockByName("Longsword", "15 gp", "2");
  await stockByName("Chain Mail", "75 gp", "1");
  await stockByName("Dagger", "2 gp", "1"); // stays under the counter

  // Reveal the shop and two lines; the Dagger stays hidden.
  await dm.getByRole("button", { name: "Hidden from the party" }).click();
  await dm.getByRole("button", { name: "Show Longsword" }).click();
  await dm.getByRole("button", { name: "Show Chain Mail" }).click();

  // The hidden line's id, harvested as the DM — the player will probe it.
  const dmView = (await (
    await dm.request.get(`/api/campaigns/${campaign.id}/vendors`)
  ).json()) as Array<{ stock: Array<{ id: string; name: string }> }>;
  const hiddenId = dmView[0].stock.find((s) => s.name === "Dagger")!.id;

  // A funded hero takes their seat.
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("till-player"));
  await joinCampaign(player.request, campaign.inviteCode);
  const heroId = await forgeHero(player.request, {
    name: unique("Petra "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  await seatHero(player.request, heroId, campaign.id);
  await fundHero(player.request, heroId, 40);

  await player.goto(`/questboard/campaigns/${campaign.id}/vendors`);
  await expect(player.getByText("40 GP", { exact: true })).toBeVisible();

  // Buy: coin leaves the purse, goods reach the pack, the shelf counts down.
  await player.getByRole("button", { name: "Buy Longsword" }).click();
  await expect(player.getByText(/Paid 15 gp for Longsword — 25 gp left/)).toBeVisible();
  await expect(player.getByText("25 GP", { exact: true })).toBeVisible();
  const detail = (await (
    await player.request.get(`/api/characters/${heroId}`)
  ).json()) as { items: Array<{ name: string; qty: number }> };
  expect(detail.items.find((i) => i.name === "Longsword")?.qty).toBe(1);
  expect(detail.items.find((i) => i.name === "Gold Pieces")?.qty).toBe(25);

  // Again: the purchase stacks onto the same row, and the shelf runs dry.
  await player.getByRole("button", { name: "Buy Longsword" }).click();
  await expect(player.getByText(/10 gp left/)).toBeVisible();
  await expect(player.getByText("sold out")).toBeVisible();
  await expect(player.getByRole("button", { name: "Buy Longsword" })).toBeDisabled();
  const after = (await (
    await player.request.get(`/api/characters/${heroId}`)
  ).json()) as { items: Array<{ name: string; qty: number }> };
  expect(after.items.filter((i) => i.name === "Longsword")).toHaveLength(1);
  expect(after.items.find((i) => i.name === "Longsword")?.qty).toBe(2);

  // The race, replayed by API: a sold-out shelf answers 409 in plain words.
  const dry = await player.request.post(
    `/api/stock/${dmView[0].stock.find((s) => s.name === "Longsword")!.id}/buy`,
    { data: { characterId: heroId } },
  );
  expect(dry.status()).toBe(409);
  expect(await dry.text()).toContain("sold out");

  // Too rich for the purse: the button knows, and the till agrees.
  await expect(player.getByRole("button", { name: "Buy Chain Mail" })).toBeDisabled();
  const poor = await player.request.post(
    `/api/stock/${dmView[0].stock.find((s) => s.name === "Chain Mail")!.id}/buy`,
    { data: { characterId: heroId } },
  );
  expect(poor.status()).toBe(400);
  expect(await poor.text()).toContain("the purse holds 10 gp");

  // The line under the counter cannot be bought even by its id — and the
  // refusal reads exactly like absence, not like a locked door.
  const probe = await player.request.post(`/api/stock/${hiddenId}/buy`, {
    data: { characterId: heroId },
  });
  expect(probe.status()).toBe(404);

  // The chronicle carries the sale.
  const events = (await (
    await player.request.get(`/api/campaigns/${campaign.id}/events`)
  ).json()) as Array<{ message: string }>;
  expect(events.some((e) => /buys Longsword from/.test(e.message))).toBeTruthy();

  await dmCtx.close();
  await playerCtx.close();
});
