import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { createCampaign, forgeHero, joinCampaign, newAccount, registerViaAPI, seatHero, unique } from "./helpers";

/*
An item may carry its own stats and its own words (#396).

A pack row either linked an armory entry, taking everything from it, or was a
name with nothing behind it: no stats, nothing to equip, no way to say "engraved
with the family crest". Now every row can be renamed and carry a note, and a row
written in can carry the Archives' item fields itself — a sword nobody authored
as homebrew. At a table the numbers are the table's (#378).
*/

async function person(browser: Browser, prefix: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(prefix));
  return page;
}

const forge = (request: APIRequestContext) =>
  forgeHero(request, {
    name: unique("Harkon "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Soldier",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Perception", "Survival"],
  });

type Row = {
  id: string; name: string; qty: number; isPurse?: boolean; equipped: boolean; slot?: string;
  notes?: string; customData?: Record<string, unknown> | null; content?: { id: string } | null;
};
const pack = async (request: APIRequestContext, heroId: string): Promise<Row[]> =>
  ((await (await request.get(`/api/characters/${heroId}`)).json()) as { items: Row[] }).items;
const add = (request: APIRequestContext, heroId: string, data: Record<string, unknown>) =>
  request.post(`/api/characters/${heroId}/items`, { data });
const patch = (request: APIRequestContext, heroId: string, id: string, data: Record<string, unknown>) =>
  request.patch(`/api/characters/${heroId}/items/${id}`, { data });

const sword = { type: "weapon", category: "Martial", damage: "1d8", damageType: "slashing", properties: ["Versatile"], damage2: "1d10" };

test("a written-in item with stats of its own can be equipped and reads as what it says", async ({ browser }) => {
  const owner = await person(browser, "own");
  const hero = await forge(owner.request);

  const made = await add(owner.request, hero, { name: "Grandfather's Longsword", notes: "Engraved with the family crest", data: sword });
  expect(made.status(), await made.text()).toBe(201);
  const row = (await made.json()) as Row;
  expect(row.name).toBe("Grandfather's Longsword");
  expect(row.notes).toBe("Engraved with the family crest");
  expect(row.customData).toMatchObject({ type: "weapon", damage: "1d8" });
  expect(row.content ?? null).toBeNull();

  // It can be held — a written-in name could not be before.
  const held = await patch(owner.request, hero, row.id, { slot: "bothhands" });
  expect(held.ok(), await held.text()).toBeTruthy();
  expect((await held.json()).slot).toBe("bothhands");

  // Armour of its own is worn, and counts for its AC.
  const mail = await add(owner.request, hero, { name: "Dented Breastplate", data: { type: "armor", category: "Medium", ac: 14 } });
  const mailRow = (await mail.json()) as Row;
  expect((await patch(owner.request, hero, mailRow.id, { slot: "armor" })).ok()).toBeTruthy();
  const sheet = await (await owner.request.get(`/api/characters/${hero}`)).json();
  expect(JSON.stringify(sheet)).toContain("Dented Breastplate");
});

test("stats are checked as the Archives' form is, and only a written-in row takes them", async ({ browser }) => {
  const owner = await person(browser, "chk");
  const hero = await forge(owner.request);

  // An armor with no AC is not an item.
  expect((await add(owner.request, hero, { name: "Bad Mail", data: { type: "armor", category: "Heavy" } })).status()).toBe(400);
  // A note has a limit.
  expect((await add(owner.request, hero, { name: "Wordy", notes: "x".repeat(501) })).status()).toBe(400);

  // A row linked to the armory takes its numbers from the armory.
  const armory = (await (await owner.request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>;
  const torch = armory.find((i) => i.name === "Torch")!;
  expect((await add(owner.request, hero, { contentId: torch.id, data: sword })).status()).toBe(400);
  const linked = (await (await add(owner.request, hero, { contentId: torch.id })).json()) as Row;
  expect((await patch(owner.request, hero, linked.id, { data: sword })).status()).toBe(400);
});

test("any row can be renamed and carry a note, and a rename of an armory row can be undone", async ({ browser }) => {
  const owner = await person(browser, "ren");
  const hero = await forge(owner.request);
  const armory = (await (await owner.request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>;
  const torch = armory.find((i) => i.name === "Torch")!;
  const row = (await (await add(owner.request, hero, { contentId: torch.id })).json()) as Row;

  const renamed = await (await patch(owner.request, hero, row.id, { name: "Lantern of Home", notes: "From the old inn" })).json();
  expect(renamed).toMatchObject({ name: "Lantern of Home", notes: "From the old inn" });
  expect(renamed.content.id).toBe(torch.id); // still the armory's torch underneath

  const undone = await (await patch(owner.request, hero, row.id, { name: "" })).json();
  expect(undone.name).toBe("Torch");

  // A written-in row must keep a name.
  const plain = (await (await add(owner.request, hero, { name: "Rope" })).json()) as Row;
  expect((await patch(owner.request, hero, plain.id, { name: "  " })).status()).toBe(400);

  // An annotated row is its owner's: a fresh gift of the same thing does not stack onto it.
  const again = (await (await add(owner.request, hero, { contentId: torch.id })).json()) as Row;
  expect(again.id).not.toBe(row.id);
  expect((await pack(owner.request, hero)).filter((i) => i.content?.id === torch.id)).toHaveLength(2);
});

test("at a table the numbers are the DM's; the name and the note stay the player's", async ({ browser }) => {
  const dm = await person(browser, "stdm");
  const campaign = await createCampaign(dm.request, unique("The Forge "));
  const player = await person(browser, "stpl");
  await joinCampaign(player.request, campaign.inviteCode);
  const hero = await forge(player.request);
  const made = (await (await add(player.request, hero, { name: "Old Sword", data: sword })).json()) as Row;
  await seatHero(player.request, hero, campaign.id);

  // A seated player may name it and write on it, and may not change the numbers.
  const words = await patch(player.request, hero, made.id, { name: "Old Faithful", notes: "Gift of the captain" });
  expect(words.ok(), await words.text()).toBeTruthy();
  expect((await patch(player.request, hero, made.id, { data: { ...sword, damage: "4d12" } })).status()).toBe(400);
  expect((await add(player.request, hero, { name: "Sneaky Blade", data: sword })).status()).toBe(400);

  // The DM sets them — and an item whose numbers change goes back in the pack.
  expect((await patch(player.request, hero, made.id, { slot: "mainhand" })).ok()).toBeTruthy();
  const changed = await patch(dm.request, hero, made.id, { data: { ...sword, damage: "1d10", bonus: 1, rarity: "uncommon" } });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  const after = (await changed.json()) as Row;
  expect(after.customData).toMatchObject({ damage: "1d10", bonus: 1 });
  expect(after.equipped).toBe(false);
  // ...and the DM can write one in outright.
  expect((await add(dm.request, hero, { name: "Vault Blade", data: sword })).status()).toBe(201);
});

test("the sheet writes a custom item in and shows its stats", async ({ browser }) => {
  const owner = await person(browser, "ui");
  const hero = await forge(owner.request);
  await owner.goto(`/questboard/heroes/${hero}`);
  await owner.getByRole("button", { name: "Inventory" }).click();

  await owner.getByRole("button", { name: "Custom item" }).click();
  const dialog = owner.getByRole("dialog");
  await dialog.getByPlaceholder("e.g. Grandfather's Longsword").fill("Grandfather's Longsword");
  await dialog.getByPlaceholder("Engraved with the family crest").fill("Engraved with the family crest");
  await dialog.getByLabel("Give it stats of its own").check();
  await dialog.getByLabel("Item type").selectOption("weapon");
  await dialog.getByPlaceholder("1d8").fill("1d8");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  const tile = owner.getByRole("button", { name: /Grandfather's Longsword/ }).first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await tile.click();
  await expect(owner.getByRole("dialog").getByText("Engraved with the family crest")).toBeVisible();
  await expect(owner.getByRole("dialog").getByRole("button", { name: /Equip · Main Hand/ })).toBeVisible();
  expect((await pack(owner.request, hero)).find((i) => i.name === "Grandfather's Longsword")?.customData).toMatchObject({ type: "weapon", damage: "1d8" });
});
