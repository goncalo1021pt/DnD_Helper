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
Starting gear is the DM's to hand out (#390).

The Forge gave every hero a kit whether anyone wanted it or not, and the kit
mostly failed to become items: twenty of its names matched nothing in the
armory, and an equipment pack was one row nobody could open. Now a hero begins
with an empty pack and the DM hands their start through the gift door — the
class's A or B, the background's kit or its 50 gp, or a pack the table wrote —
and a pack, wherever it comes from, arrives as what is in it.
*/

async function person(browser: Browser, prefix: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(prefix));
  return page;
}

type Row = { id: string; name: string; qty: number; isPurse: boolean; contentId?: string | null; content?: { id: string } | null };
const pack = async (request: APIRequestContext, heroId: string): Promise<Row[]> =>
  ((await (await request.get(`/api/characters/${heroId}`)).json()) as { items: Row[] }).items;
const qtyOf = (rows: Row[], name: string) => rows.filter((r) => r.name === name).reduce((n, r) => n + r.qty, 0);

type Line = { name: string; qty: number; contentId?: string; choose?: Array<{ name: string; contentId?: string }> };
type Option = { label: string; lines: Line[]; coin?: string };
type Packs = {
  className: string;
  backgroundName?: string;
  classOptions: Option[];
  backgroundOptions: Option[];
  custom: Array<{ id: string; name: string }>;
  givenAt?: string;
};

async function table(browser: Browser, className = "Fighter", background = "Soldier") {
  const dm = await person(browser, "packdm");
  const campaign = await createCampaign(dm.request, unique("The Armoury "));
  const player = await person(browser, "packpl");
  await joinCampaign(player.request, campaign.inviteCode);
  const hero = await forgeHero(player.request, {
    name: unique("Harkon "),
    className,
    speciesName: "Dwarf",
    backgroundName: background,
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: className === "Fighter" ? ["Perception", "Survival"] : ["Insight", "Investigation"],
  });
  await seatHero(player.request, hero, campaign.id);
  return { dm, player, campaign, hero };
}

const startingPacks = async (dm: Page, hero: string): Promise<Packs> => {
  const res = await dm.request.get(`/api/characters/${hero}/starting-packs`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
};

/** What the dialog sends for an option: lines as written, choose lines settled. */
const giftLines = (opt: Option, picks: Record<string, string> = {}) =>
  opt.lines.map((l) => {
    if (l.choose) {
      const c = l.choose.find((o) => o.name === picks[l.name]) ?? l.choose[0];
      return c.contentId ? { contentId: c.contentId, qty: l.qty } : { name: c.name, qty: l.qty };
    }
    return l.contentId ? { contentId: l.contentId, qty: l.qty } : { name: l.name, qty: l.qty };
  });

test("a hero begins empty, and the DM is shown the books' options, matched to the armory", async ({ browser }) => {
  const { dm, player, hero } = await table(browser);
  expect(await pack(player.request, hero)).toHaveLength(0);

  const packs = await startingPacks(dm, hero);
  expect(packs.className).toBe("Fighter");
  expect(packs.classOptions.map((o) => o.label)).toEqual(["A", "B", "C"]);
  const a = packs.classOptions[0];
  // Every line of a book kit is an armory item, so nothing arrives as free text.
  expect(a.lines.every((l) => l.contentId)).toBe(true);
  expect(a.lines.map((l) => l.name)).toEqual(expect.arrayContaining(["Chain Mail", "Greatsword", "Dungeoneer's Pack"]));
  expect(a.coin).toBe("4 gp");
  expect(packs.classOptions[2].lines).toHaveLength(0);
  expect(packs.classOptions[2].coin).toBe("155 gp");

  expect(packs.backgroundName).toBe("Soldier");
  const [kit, gold] = packs.backgroundOptions;
  expect(kit.coin).toBe("14 gp");
  expect(gold).toMatchObject({ label: "B", coin: "50 gp", lines: [] });
  // "a gaming set of your choice" is a choice, not a literal.
  const gaming = kit.lines.find((l) => l.choose);
  expect(gaming?.choose?.map((c) => c.name)).toEqual(expect.arrayContaining(["Dice Set", "Playing Cards"]));
  // The 2024 arrows are one line of "Arrows (20)", not twenty "Arrow"s.
  expect(kit.lines.find((l) => l.name === "Arrows (20)")).toMatchObject({ qty: 1 });

  // Only the DM of the hero's table may read them.
  expect((await player.request.get(`/api/characters/${hero}/starting-packs`)).status()).toBe(404);
});

test("Fighter A and the Soldier's kit arrive as real items, the equipment pack unpacked", async ({ browser }) => {
  const { dm, player, campaign, hero } = await table(browser);
  const packs = await startingPacks(dm, hero);
  const gift = await dm.request.post(`/api/campaigns/${campaign.id}/gifts`, {
    data: {
      heroIds: [hero],
      items: [...giftLines(packs.classOptions[0]), ...giftLines(packs.backgroundOptions[0], { "Gaming Set": "Dice Set" })],
      coin: `${packs.classOptions[0].coin}, ${packs.backgroundOptions[0].coin}`,
      startingPack: "Fighter A + Soldier kit",
    },
  });
  expect(gift.ok(), await gift.text()).toBeTruthy();

  const rows = await pack(player.request, hero);
  // Things a Fighter can use are linked to the armory, not written in.
  for (const name of ["Chain Mail", "Greatsword", "Flail", "Spear", "Shortbow", "Quiver"]) {
    expect(rows.find((r) => r.name === name)?.content, `${name} should be an armory item`).toBeTruthy();
  }
  expect(qtyOf(rows, "Javelin")).toBe(8);
  expect(qtyOf(rows, "Arrows (20)")).toBe(1);
  expect(qtyOf(rows, "Dice Set")).toBe(1);
  // The Dungeoneer's Pack is never a row: it is a backpack, rope and ten torches.
  expect(rows.some((r) => /Pack$/.test(r.name))).toBe(false);
  expect(qtyOf(rows, "Torch")).toBe(10);
  expect(qtyOf(rows, "Rations")).toBe(10);
  expect(qtyOf(rows, "Backpack")).toBe(1);
  expect(qtyOf(rows, "Rope (50 ft)")).toBe(1);
  expect(qtyOf(rows, "Caltrops")).toBe(1);
  // 4 gp + 14 gp, in base units.
  expect(rows.find((r) => r.isPurse)?.qty).toBe(1800);

  // The hero is marked, so the next time the dialog says so.
  expect((await startingPacks(dm, hero)).givenAt).toBeTruthy();
  const chronicle = (await (await dm.request.get(`/api/campaigns/${campaign.id}/events`)).json()) as Array<{ message: string }>;
  expect(chronicle.some((e) => /their starting pack \(Fighter A \+ Soldier kit\)/.test(e.message))).toBe(true);
});

test("gold instead of gear is just coin; a table's own money is spoken", async ({ browser }) => {
  const { dm, player, campaign, hero } = await table(browser);
  const packs = await startingPacks(dm, hero);
  const gift = await dm.request.post(`/api/campaigns/${campaign.id}/gifts`, {
    data: { heroIds: [hero], coin: `${packs.classOptions[2].coin}, ${packs.backgroundOptions[1].coin}`, startingPack: "Fighter C + 50 gp" },
  });
  expect(gift.ok(), await gift.text()).toBeTruthy();
  const rows = await pack(player.request, hero);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ isPurse: true, qty: 20500 }); // 155 gp + 50 gp

  // A table that counts in crowns reads the same book number in crowns.
  const crowns = await table(browser);
  const set = await crowns.dm.request.put(`/api/campaigns/${crowns.campaign.id}/coinage`, {
    data: { coins: [{ name: "Shard", abbrev: "sh", value: 1 }, { name: "Crown", abbrev: "cr", value: 20 }] },
  });
  expect(set.ok(), await set.text()).toBeTruthy();
  const cp = await startingPacks(crowns.dm, crowns.hero);
  expect(cp.classOptions[2].coin).toBe("155 cr");
});

test("an equipment pack arrives as its contents at every door: the plain Give, and the shop", async ({ browser }) => {
  const { dm, player, campaign, hero } = await table(browser);
  const explorer = ((await (await dm.request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>).find(
    (i) => i.name === "Explorer's Pack",
  )!;
  expect((await dm.request.post(`/api/campaigns/${campaign.id}/gifts`, { data: { heroIds: [hero], items: [{ contentId: explorer.id }] } })).ok()).toBeTruthy();
  let rows = await pack(player.request, hero);
  expect(rows.some((r) => r.name === "Explorer's Pack")).toBe(false);
  expect(qtyOf(rows, "Torch")).toBe(10);
  expect(qtyOf(rows, "Bedroll")).toBe(1);

  // And off a shelf: the price is the pack's, the goods are its contents.
  const vendor = await dm.request.post(`/api/campaigns/${campaign.id}/vendors`, { data: { name: unique("Pack Rat's "), revealed: true } });
  expect(vendor.ok(), await vendor.text()).toBeTruthy();
  const stock = await dm.request.post(`/api/vendors/${(await vendor.json()).id}/stock`, {
    data: { contentId: explorer.id, price: "10 gp", qty: 1 },
  });
  expect(stock.ok(), await stock.text()).toBeTruthy();
  // addStock answers the whole shop; the new line is on its shelf.
  const line = ((await stock.json()) as { stock: Array<{ id: string; name: string }> }).stock.find((l) => l.name === "Explorer's Pack")!;
  const funded = await dm.request.post(`/api/campaigns/${campaign.id}/gifts`, { data: { heroIds: [hero], coin: "10 gp" } });
  expect(funded.ok()).toBeTruthy();
  const bought = await dm.request.post(`/api/stock/${line.id}/buy`, { data: { characterId: hero } });
  expect(bought.ok(), await bought.text()).toBeTruthy();
  rows = await pack(player.request, hero);
  expect(rows.some((r) => r.name === "Explorer's Pack")).toBe(false);
  expect(qtyOf(rows, "Torch")).toBe(20);
  expect(qtyOf(rows, "Waterskin")).toBe(2);
});

test("a table writes a pack of its own, and gives it", async ({ browser }) => {
  const { dm, player, campaign, hero } = await table(browser, "Wizard", "Sage");
  const rope = ((await (await dm.request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>).find((i) => i.name === "Rope (50 ft)")!;
  const make = (data: object, request = dm.request) => request.post(`/api/campaigns/${campaign.id}/packs`, { data });
  const made = await make({ name: "Temple orphan", items: [{ contentId: rope.id, qty: 2 }, { name: "Rosary" }], coin: "5 gp" });
  expect(made.status(), await made.text()).toBe(201);
  const created = await made.json();
  expect(created.items.map((i: { name: string }) => i.name)).toEqual(["Rope (50 ft)", "Rosary"]);

  // The refusals: a duplicate name, an empty pack, unreadable coin, and a player.
  expect((await make({ name: "temple ORPHAN", items: [{ name: "x" }] })).status()).toBe(400);
  expect((await make({ name: "Empty" })).status()).toBe(400);
  expect((await make({ name: "Broke", coin: "plenty" })).status()).toBe(400);
  expect((await make({ name: "Coin", items: [{ name: "Gold Pieces" }] })).status()).toBe(400);
  expect((await make({ name: "Cheat", coin: "9 gp" }, player.request)).status()).toBe(403);
  expect((await player.request.get(`/api/campaigns/${campaign.id}/packs`)).status()).toBe(403);

  // It joins the books' options on the hero's dialog, and gives like any gift.
  const packs = await startingPacks(dm, hero);
  expect(packs.custom.map((c) => c.name)).toEqual(["Temple orphan"]);
  const edited = await dm.request.put(`/api/campaigns/${campaign.id}/packs/${created.id}`, {
    data: { name: "Temple orphan", items: [{ contentId: rope.id, qty: 2 }, { name: "Rosary" }, { name: "Candle stub", qty: 3 }], coin: "5 gp" },
  });
  expect(edited.ok(), await edited.text()).toBeTruthy();
  const gift = await dm.request.post(`/api/campaigns/${campaign.id}/gifts`, {
    data: { heroIds: [hero], items: [{ contentId: rope.id, qty: 2 }, { name: "Rosary" }, { name: "Candle stub", qty: 3 }], coin: "5 gp", startingPack: "Temple orphan" },
  });
  expect(gift.ok(), await gift.text()).toBeTruthy();
  const rows = await pack(player.request, hero);
  expect(qtyOf(rows, "Rope (50 ft)")).toBe(2);
  expect(qtyOf(rows, "Candle stub")).toBe(3);
  expect(rows.find((r) => r.isPurse)?.qty).toBe(500);

  // Striking the pack takes nothing from the hero who has what it gave.
  expect((await dm.request.delete(`/api/campaigns/${campaign.id}/packs/${created.id}`)).status()).toBe(204);
  expect((await startingPacks(dm, hero)).custom).toHaveLength(0);
  expect(qtyOf(await pack(player.request, hero), "Rosary")).toBe(1);
});

test("the DM hands over a starting pack from the roster, and writes one in the DM menu", async ({ browser }) => {
  const { dm, player, campaign, hero } = await table(browser);

  // The DM menu: write a pack in the dialog.
  await dm.goto(`/questboard/campaigns/${campaign.id}/dm`);
  await settled(dm);
  await dm.getByRole("button", { name: "New pack" }).click();
  await dm.getByPlaceholder("Temple orphan").fill("Road-weary drifter");
  await dm.getByPlaceholder("…or write one in").fill("Tin cup");
  await dm.getByRole("button", { name: "Add", exact: true }).click();
  await dm.getByLabel("Coin amount").fill("3");
  await dm.getByRole("button", { name: "Save" }).click();
  await expect(dm.locator('[data-pack="Road-weary drifter"]')).toContainText("Tin cup, 3 gp");

  // The roster: choose Fighter A and the Soldier's kit, settle the gaming set.
  await dm.goto(`/questboard/campaigns/${campaign.id}/party`);
  await settled(dm);
  await dm.getByRole("button", { name: "Starting pack" }).click();
  await dm.getByRole("radio", { name: /^Fighter A/ }).click();
  await dm.getByRole("radio", { name: /^Soldier A/ }).click();
  const give = dm.getByRole("button", { name: "Give", exact: true }).last();
  await expect(give).toBeDisabled(); // the gaming set is still a choice
  await dm.getByLabel("Gaming Set").selectOption("Dice Set");
  await expect(give).toBeEnabled();
  await give.click();
  await expect.poll(async () => qtyOf(await pack(player.request, hero), "Torch")).toBe(10);
  const rows = await pack(player.request, hero);
  expect(rows.some((r) => /Pack$/.test(r.name))).toBe(false);
  expect(qtyOf(rows, "Dice Set")).toBe(1);

  // A second time, the dialog says so — and still lets the DM through.
  await dm.reload();
  await settled(dm);
  await dm.getByRole("button", { name: "Starting pack" }).click();
  await expect(dm.getByText(/was given a starting pack on/)).toBeVisible();
  await dm.getByRole("button", { name: "Custom pack" }).click();
  await dm.getByRole("radio", { name: /Road-weary drifter/ }).click();
  await expect(dm.getByRole("button", { name: "Give", exact: true }).last()).toBeEnabled();
});
