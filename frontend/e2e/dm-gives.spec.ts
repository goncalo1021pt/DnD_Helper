import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  seatHero,
  settled,
  unique,
} from "./helpers";

/*
The DM gives (#394).

Nothing a DM could do in the app put anything in a hero's pack: the sheet was
read-only to them, quest rewards were words on a notice, and a player could set
their own gold to any number. These pin the one door — the DM names seated
heroes, and items and coin arrive — and the rule that goes with it: at a table
a purse is spent by its player and filled by somebody else.
*/

async function person(browser: Browser, prefix: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(prefix));
  return page;
}

type Pack = { items: Array<{ id: string; name: string; qty: number; isPurse: boolean }> };

async function pack(request: APIRequestContext, heroId: string): Promise<Pack["items"]> {
  const res = await request.get(`/api/characters/${heroId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as Pack).items;
}

const armory = async (request: APIRequestContext, name: string) =>
  ((await (await request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>).find(
    (i) => i.name === name,
  )!.id;

async function seatedHero(player: Page, campaignId: string) {
  const id = await forgeHero(player.request, {
    name: unique("Harkon "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  await seatHero(player.request, id, campaignId);
  return id;
}

test("a DM gives items and coin; the purse is made, stacks hold, and the table reads it", async ({ browser }) => {
  const dm = await person(browser, "givedm");
  const campaign = await createCampaign(dm.request, unique("The Vault "));
  const player = await person(browser, "givepl");
  await joinCampaign(player.request, campaign.inviteCode);
  const hero = await seatedHero(player, campaign.id);
  const sword = await armory(dm.request, "Longsword");
  const give = (data: object, request = dm.request) => request.post(`/api/campaigns/${campaign.id}/gifts`, { data });

  const first = await give({
    heroIds: [hero],
    items: [{ contentId: sword }, { name: "Torch", qty: 2 }],
    coin: "50 gp",
    note: "from the vault",
  });
  expect(first.ok(), await first.text()).toBeTruthy();
  let items = await pack(player.request, hero);
  expect(items.find((i) => i.name === "Longsword")?.qty).toBe(1);
  expect(items.find((i) => i.name === "Torch")?.qty).toBe(2);
  // The purse is made where there is none, in base units: 50 gp is 5,000 cp.
  expect(items.filter((i) => i.isPurse)).toHaveLength(1);
  expect(items.find((i) => i.isPurse)?.qty).toBe(5000);

  // A second gift stacks on what matches and tops the same purse up.
  expect((await give({ heroIds: [hero], items: [{ name: "Torch", qty: 3 }], coin: "2 gp, 5 sp" })).ok()).toBeTruthy();
  items = await pack(player.request, hero);
  expect(items.find((i) => i.name === "Torch")?.qty).toBe(5);
  expect(items.filter((i) => i.name === "Torch")).toHaveLength(1);
  expect(items.find((i) => i.isPurse)?.qty).toBe(5250);

  // The table reads it; a quiet gift is the owner's alone.
  const chronicle = async () =>
    (await (await dm.request.get(`/api/campaigns/${campaign.id}/events`)).json()) as Array<{ message: string }>;
  expect((await chronicle()).some((e) => /The DM gives .* 2× Torch.* 50 gp — from the vault/.test(e.message))).toBe(true);
  const before = (await chronicle()).length;
  expect((await give({ heroIds: [hero], coin: "1 gp", announce: false })).ok()).toBeTruthy();
  expect((await chronicle()).length).toBe(before);
  expect((await pack(player.request, hero)).find((i) => i.isPurse)?.qty).toBe(5350);
});

test("a gift answers to the door: DM only, seated heroes, a coin the table uses", async ({ browser }) => {
  const dm = await person(browser, "gatedm");
  const campaign = await createCampaign(dm.request, unique("The Gate "));
  const player = await person(browser, "gatepl");
  await joinCampaign(player.request, campaign.inviteCode);
  const hero = await seatedHero(player, campaign.id);
  const shelved = await forgeHero(player.request, {
    name: unique("Shelf "),
    className: "Wizard",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    skills: ["Arcana", "History"],
  });
  const give = (data: object, request = dm.request) => request.post(`/api/campaigns/${campaign.id}/gifts`, { data });

  expect((await give({ heroIds: [hero], coin: "5 gp" }, player.request)).status()).toBe(403);
  const unseated = await give({ heroIds: [shelved], coin: "5 gp" });
  expect(unseated.status()).toBe(400);
  expect((await unseated.json()).error).toMatch(/not seated/);
  expect((await give({ heroIds: [hero] })).status()).toBe(400); // nothing given
  const bad = await give({ heroIds: [hero], coin: "fifty crowns" });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toMatch(/try "50 gp"/);
  // Coin is the coin field's, or it would be a second till.
  const coinAsItem = await give({ heroIds: [hero], items: [{ name: "Gold Pieces", qty: 5 }] });
  expect(coinAsItem.status()).toBe(400);
  expect((await coinAsItem.json()).error).toMatch(/coin field/);
  expect((await pack(player.request, hero)).length).toBe(0);
});

test("at a table a purse is spent by its player and filled by somebody else", async ({ browser }) => {
  const dm = await person(browser, "purse-dm");
  const campaign = await createCampaign(dm.request, unique("The Till "));
  const player = await person(browser, "purse-pl");
  await joinCampaign(player.request, campaign.inviteCode);
  const hero = await seatedHero(player, campaign.id);
  expect((await dm.request.post(`/api/campaigns/${campaign.id}/gifts`, { data: { heroIds: [hero], coin: "10 gp" } })).ok()).toBeTruthy();
  const purse = (await pack(player.request, hero)).find((i) => i.isPurse)!;

  // Spending is theirs; raising is not.
  const raised = await player.request.patch(`/api/characters/${hero}/items/${purse.id}`, { data: { qty: 999999 } });
  expect(raised.status()).toBe(400);
  expect((await raised.json()).error).toMatch(/can only be spent/);
  const spent = await player.request.patch(`/api/characters/${hero}/items/${purse.id}`, { data: { qty: 400 } });
  expect(spent.ok(), await spent.text()).toBeTruthy();

  // Nor may they write one in: a hero with no purse cannot conjure one.
  // (A table seats one hero per player, so a second player brings the pauper.)
  const second = await person(browser, "purse-p2");
  await joinCampaign(second.request, campaign.inviteCode);
  const poor = await seatedHero(second, campaign.id);
  const written = await second.request.post(`/api/characters/${poor}/items`, { data: { name: "Gold Pieces", qty: 9999 } });
  expect(written.status()).toBe(400);

  // An unseated hero is still the owner's own sandbox.
  const free = await forgeHero(player.request, {
    name: unique("Free "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  expect((await player.request.post(`/api/characters/${free}/items`, { data: { name: "Gold Pieces", qty: 500 } })).ok()).toBeTruthy();
});

test("the DM gives from the roster, and the player spends from the sheet", async ({ browser }) => {
  const dm = await person(browser, "ui-dm");
  const campaign = await createCampaign(dm.request, unique("The Hall "));
  const player = await person(browser, "ui-pl");
  await joinCampaign(player.request, campaign.inviteCode);
  const hero = await seatedHero(player, campaign.id);

  await dm.goto(`/questboard/campaigns/${campaign.id}/party`);
  await settled(dm);
  await dm.getByRole("button", { name: "Give", exact: true }).last().click();
  await dm.getByPlaceholder("Search the armory…").fill("longsw");
  await dm.getByRole("button", { name: /^Longsword/ }).click();
  await dm.getByLabel("Coin amount").fill("50");
  await dm.getByPlaceholder("Found in the vault…").fill("the vault");
  await dm.getByRole("button", { name: "Give", exact: true }).last().click();
  await expect.poll(async () => (await pack(player.request, hero)).map((i) => i.name)).toEqual(
    expect.arrayContaining(["Longsword", "Gold Pieces"]),
  );

  // The player reads 50 gp in the purse and can only spend it.
  await player.goto(`/questboard/heroes/${hero}`);
  await settled(player);
  await player.getByRole("button", { name: /inventory/i }).click();
  await player.getByRole("button", { name: "50 gp", exact: true }).click();
  await expect(player.getByTestId("purse-total")).toHaveText("50 gp");
  await expect(player.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await player.getByLabel("Coin amount").fill("20");
  await player.getByRole("button", { name: "Spend" }).click();
  await expect(player.getByTestId("purse-total")).toHaveText("30 gp");

  // The DM, on the sheet itself, has a Give of their own.
  await dm.goto(`/questboard/heroes/${hero}`);
  await settled(dm);
  await dm.getByRole("button", { name: /inventory/i }).click();
  await expect(dm.getByRole("button", { name: /Give/ })).toBeVisible();
});
