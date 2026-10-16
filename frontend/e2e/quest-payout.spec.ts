import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { createCampaign, forgeHero, joinCampaign, newAccount, registerViaAPI, seatHero, unique } from "./helpers";

/*
A quest pays (#395).

A quest's rewards were words on a notice that never reached anyone. Now a gold
reward is an amount in the table's coin and an item reward names a thing, and
when the quest is completed the DM pays them out — one gift per hero, once.
*/

async function person(browser: Browser, prefix: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(prefix));
  return page;
}

type Row = { id: string; name: string; qty: number; isPurse: boolean };
const pack = async (request: APIRequestContext, heroId: string): Promise<Row[]> =>
  ((await (await request.get(`/api/characters/${heroId}`)).json()) as { items: Row[] }).items;
const purse = async (request: APIRequestContext, heroId: string) =>
  (await pack(request, heroId)).find((i) => i.isPurse)?.qty ?? 0;

async function hero(browser: Browser, campaign: { id: string; inviteCode: string }, prefix: string) {
  const player = await person(browser, prefix);
  await joinCampaign(player.request, campaign.inviteCode);
  const id = await forgeHero(player.request, {
    name: unique("Sella "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Soldier",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Perception", "Survival"],
  });
  await seatHero(player.request, id, campaign.id);
  return { player, id };
}

type Reward = { type: string; label: string; value?: string; itemId?: string; qty?: number };
async function quest(dm: Page, campaignId: string, rewards: Reward[], status = "completed") {
  const res = await dm.request.post(`/api/campaigns/${campaignId}/quests`, {
    data: { title: unique("Rats "), description: "", visibleToParty: true, difficulty: "easy", status, rewards },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const made = (await res.json()) as { id: string; title: string };
  // A new notice always starts available; the status is a second step.
  const set = await dm.request.patch(`/api/quests/${made.id}`, {
    data: { title: made.title, visibleToParty: true, difficulty: "easy", status, rewards },
  });
  expect(set.ok(), await set.text()).toBeTruthy();
  return (await set.json()) as { id: string; rewards: Array<{ id: string; type: string; payable?: boolean }> };
}

const torch = async (request: APIRequestContext) => {
  const items = (await (await request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>;
  return items.find((i) => i.name === "Torch")!.id;
};

test("a completed quest pays gold split between the heroes and an item to the one named, once", async ({ browser }) => {
  const dm = await person(browser, "payd");
  const campaign = await createCampaign(dm.request, unique("The Cellar "));
  const a = await hero(browser, campaign, "paya");
  const b = await hero(browser, campaign, "payb");
  const torchId = await torch(dm.request);

  const q = await quest(dm, campaign.id, [
    { type: "gold", label: "Gold", value: "100 gp" },
    { type: "item", label: "Item", value: "Torch", itemId: torchId, qty: 3 },
    { type: "reputation", label: "Reputation", value: "+2 with the Temple" },
  ]);
  expect(q.rewards.map((r) => r.payable)).toEqual([true, true, false]);
  const itemReward = q.rewards.find((r) => r.type === "item")!;

  // Only a completed quest pays.
  const early = await quest(dm, campaign.id, [{ type: "gold", label: "Gold", value: "5 gp" }], "available");
  expect((await dm.request.post(`/api/quests/${early.id}/payout`, { data: { heroIds: [a.id] } })).status()).toBe(409);

  // A player cannot pay themselves.
  expect((await a.player.request.post(`/api/quests/${q.id}/payout`, { data: { heroIds: [a.id] } })).status()).toBe(403);

  // The gold needs somebody to share it, and the item needs an owner.
  expect((await dm.request.post(`/api/quests/${q.id}/payout`, { data: { items: [{ rewardId: itemReward.id, heroId: a.id }] } })).status()).toBe(400);
  expect((await dm.request.post(`/api/quests/${q.id}/payout`, { data: { heroIds: [a.id, b.id] } })).status()).toBe(400);

  const paid = await dm.request.post(`/api/quests/${q.id}/payout`, {
    data: { heroIds: [a.id, b.id], goldMode: "split", items: [{ rewardId: itemReward.id, heroId: b.id }] },
  });
  expect(paid.ok(), await paid.text()).toBeTruthy();
  const body = await paid.json();
  expect(body.quest.paidAt).toBeTruthy();
  expect(body.remainder ?? null).toBeNull();

  // 100 gp is 10,000 cp; split between two it is 50 gp (5,000 cp) each.
  expect(await purse(a.player.request, a.id)).toBe(5000);
  expect(await purse(b.player.request, b.id)).toBe(5000);
  expect((await pack(b.player.request, b.id)).find((i) => i.name === "Torch")?.qty).toBe(3);
  expect((await pack(a.player.request, a.id)).find((i) => i.name === "Torch")).toBeUndefined();

  // Paid once: neither a second try nor re-opening and re-completing pays again.
  expect((await dm.request.post(`/api/quests/${q.id}/payout`, { data: { heroIds: [a.id, b.id] } })).status()).toBe(409);
  const reopen = (status: string) =>
    dm.request.patch(`/api/quests/${q.id}`, {
      data: { title: "Rats again", visibleToParty: true, difficulty: "easy", status, rewards: [{ type: "gold", label: "Gold", value: "100 gp" }] },
    });
  expect((await reopen("active")).ok()).toBeTruthy();
  expect((await reopen("completed")).ok()).toBeTruthy();
  expect((await dm.request.post(`/api/quests/${q.id}/payout`, { data: { heroIds: [a.id] } })).status()).toBe(409);
  expect(await purse(a.player.request, a.id)).toBe(5000);

  // The table reads it in the chronicle, and every player reads the quest as paid.
  const log = await (await a.player.request.get(`/api/campaigns/${campaign.id}/events`)).text();
  expect(log).toContain("reward for");
  const board = (await (await b.player.request.get(`/api/campaigns/${campaign.id}/quests`)).json()) as Array<{ id: string; paidAt?: string }>;
  expect(board.find((x) => x.id === q.id)?.paidAt).toBeTruthy();
});

test("gold that does not divide leaves its remainder unpaid, and says so", async ({ browser }) => {
  const dm = await person(browser, "remd");
  const campaign = await createCampaign(dm.request, unique("The Till "));
  const a = await hero(browser, campaign, "rema");
  const b = await hero(browser, campaign, "remb");

  // 1 gp 1 cp is 101 cp; two ways it is 50 each and one over.
  const q = await quest(dm, campaign.id, [{ type: "gold", label: "Gold", value: "1 gp, 1 cp" }]);
  const paid = await dm.request.post(`/api/quests/${q.id}/payout`, { data: { heroIds: [a.id, b.id] } });
  expect(paid.ok(), await paid.text()).toBeTruthy();
  expect((await paid.json()).remainder).toMatch(/1 cp/);
  expect(await purse(a.player.request, a.id)).toBe(50);

  // "each" gives everybody the whole amount.
  const r = await quest(dm, campaign.id, [{ type: "gold", label: "Gold", value: "2 gp" }]);
  const each = await dm.request.post(`/api/quests/${r.id}/payout`, { data: { heroIds: [a.id, b.id], goldMode: "each" } });
  expect(each.ok(), await each.text()).toBeTruthy();
  expect(await purse(a.player.request, a.id)).toBe(250);
  expect(await purse(b.player.request, b.id)).toBe(250);
});

test("rewards that are only words stay words", async ({ browser }) => {
  const dm = await person(browser, "wrdd");
  const campaign = await createCampaign(dm.request, unique("The Words "));
  const a = await hero(browser, campaign, "wrda");
  const q = await quest(dm, campaign.id, [
    { type: "gold", label: "Gold", value: "a sack of coins" },
    { type: "xp", label: "XP", value: "700" },
  ]);
  expect(q.rewards.every((r) => !r.payable)).toBe(true);
  const res = await dm.request.post(`/api/quests/${q.id}/payout`, { data: { heroIds: [a.id] } });
  expect(res.status()).toBe(400);
  expect(await purse(a.player.request, a.id)).toBe(0);
});

test("the DM completes a quest on the board and pays it from the dialog", async ({ browser }) => {
  const dm = await person(browser, "uid");
  const campaign = await createCampaign(dm.request, unique("The Board "));
  const a = await hero(browser, campaign, "uia");
  const torchId = await torch(dm.request);
  const q = await quest(
    dm,
    campaign.id,
    [
      { type: "gold", label: "Gold", value: "20 gp" },
      { type: "item", label: "Item", value: "Torch", itemId: torchId, qty: 2 },
    ],
    "active",
  );
  expect((await a.player.request.post(`/api/quests/${q.id}/claim`)).ok()).toBeTruthy();

  await dm.goto(`/questboard/campaigns/${campaign.id}/board`);
  await dm.getByTitle("Change status").first().click(); // active -> completed

  const dialog = dm.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Pay out" })).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Pay out" }).click();
  await expect(dialog).toBeHidden();

  await expect(dm.getByText("Paid", { exact: true })).toBeVisible();
  await expect(dm.getByRole("button", { name: "Pay out" })).toHaveCount(0);
  expect(await purse(a.player.request, a.id)).toBe(2000);
  expect((await pack(a.player.request, a.id)).find((i) => i.name === "Torch")?.qty).toBe(2);
});
