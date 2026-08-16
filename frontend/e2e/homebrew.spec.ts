import { test, expect } from "@playwright/test";
import { createCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Scribing homebrew, through the form that writes it.

ContentForm is 751 lines — of which GuidedFields is 485, a chain of per-kind
branches that turn typed fields into the `data` object the rest of the app reads
as rules. It is the last of #108's six and has never had a test.

What matters about it is not that the form submits. It is that the *shape* it
writes is the shape everything downstream expects: `slotsFor` reads `data.type`,
`acFromEquipment` reads `data.ac`, the codex rules on `data.class`. A form that
saves a homebrew plate mail under the wrong key produces an item that cannot be
worn and never says why. So these assert the stored object, not the toast.
*/

test("a scribed piece of armour is stored in the shape the sheet reads", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("scribe"));

  const name = unique("Dwarven Plate ");
  await page.goto("/questboard/archives");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await page.getByRole("button", { name: /Scribe an? Item/ }).click();

  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(name);
  // The guided fields, not a JSON blob: pick the category and the form offers
  // the numbers that category actually has.
  await form.getByLabel("Item type").selectOption("armor");
  // Category is not decoration: the server refuses armour without one
  // ("armor category must be Light, Medium or Heavy"), so the guided field is
  // carrying a rule, not just a label.
  await form.getByLabel("Category").selectOption("Heavy");
  await form.getByLabel("Base AC").fill("18");
  await form.getByRole("button", { name: "Scribe It" }).click();

  // Wait for the app's own confirmation before reading the API back. Without
  // this the GET below races the POST, and the test fails about one run in
  // three on a name that is merely not written yet — which reads exactly like
  // the form having stored the wrong shape.
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

  // The shape is the point. `type` and `ac` are the two keys the hero sheet
  // reads to decide what can be worn and what wearing it is worth.
  const items = (await (await page.request.get("/api/rules/item")).json()) as Array<{
    name: string;
    data: { type?: string; ac?: number };
  }>;
  const mine = items.find((i) => i.name === name);
  expect(mine, "the scribed item should be in the armory").toBeTruthy();
  expect(mine!.data.type).toBe("armor");
  expect(mine!.data.ac).toBe(18);
});

/*
The Den is the same component through a different door. Monster was the one kind
GuidedFields had no branch for — it fell through to the FEAT form until #127
gave it one — so this is the path most likely to be swallowed silently by a
refactor that reorders those branches.
*/
test("a monster scribed in the Den joins the bestiary and can be fought", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("den"));

  const name = unique("Gloomfang ");
  // The Den belongs to a table, not to the account.
  const campaign = await createCampaign(page.request, unique("Den Table "));
  await page.goto(`/questboard/campaigns/${campaign.id}/den`);
  await page.getByRole("button", { name: "Scribe a Monster" }).first().click();

  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: "Scribe It" }).click();

  await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });

  const monsters = (await (await page.request.get("/api/rules/monster")).json()) as Array<{
    name: string;
    source: string;
  }>;
  const mine = monsters.find((m) => m.name === name);
  expect(mine, "the scribed monster should be in the Den").toBeTruthy();
  expect(mine!.source).toBe("homebrew");
});


/*
Everything an item is besides a number in a fight (#101).

Gear carried an AC or a damage die and nothing else — no cost, no weight, no
rarity, and no way to say what the thing actually does. Two of those were
already RENDERED on the item card and simply could not be written: the
description, and a weapon's properties.

The assertion is the stored shape again, for the reason the armour test gives:
a form that writes rarity under the wrong key produces a magic sword that reads
as mundane and never says why.
*/
test("a magic weapon keeps its price, its weight and its rarity", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("gear"));

  const name = unique("Flametongue ");
  await page.goto("/questboard/archives");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await page.getByRole("button", { name: /Scribe an? Item/ }).click();

  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Item type").selectOption("weapon");
  await form.getByLabel("Category").selectOption("Martial");
  await form.getByLabel("Damage", { exact: true }).fill("1d8");
  await form.getByLabel("Damage type").fill("slashing");
  await form.getByLabel("Properties").fill("Versatile, Finesse");
  await form.getByLabel("Cost").fill("5,000 gp");
  await form.getByLabel("Weight (lb)").fill("3");

  // Attunement only exists once the item is magical — the server refuses an
  // attuned mundane rope, so the form does not offer the box until then.
  await expect(form.getByLabel("Requires attunement")).toHaveCount(0);
  await form.getByLabel("Rarity").selectOption("rare");
  await form.getByLabel("Requires attunement").check();

  await form.getByLabel("The entry (what it does)").fill("It bursts into flame on command.");
  await form.getByRole("button", { name: "Scribe It" }).click();

  const items = (await (await page.request.get("/api/rules/item")).json()) as Array<{
    name: string;
    data: {
      type?: string;
      cost?: string;
      weight?: number;
      rarity?: string;
      attunement?: boolean;
      properties?: string[];
      description?: string;
    };
  }>;
  const mine = items.find((i) => i.name === name);
  expect(mine, "the scribed weapon should be in the armory").toBeTruthy();
  expect(mine!.data).toMatchObject({
    type: "weapon",
    cost: "5,000 gp",
    weight: 3,
    rarity: "rare",
    attunement: true,
  });
  expect(mine!.data.properties).toEqual(["Versatile", "Finesse"]);
  expect(mine!.data.description).toContain("bursts into flame");

  // And the card says all of it, which is where a player actually meets it.
  await page.getByText(name).first().click();
  const card = page.getByRole("dialog");
  await expect(card.getByText("5,000 gp")).toBeVisible();
  await expect(card.getByText("3 lb")).toBeVisible();
  await expect(card.getByText(/rare · requires attunement/)).toBeVisible();
});

/*
A codex ban bites wherever a spell is picked (#239). The forge and the level-up
already refused banned content; the long-rest swap was the one door that never
asked the codex, so a seated hero could trade INTO a banned spell.
*/
test("a seated hero cannot swap INTO a codex-banned spell", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("banswap"));
  const campaign = await createCampaign(page.request, unique("Ban Swap "));

  const byName = async (kind: string, want: string) => {
    const list = (await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
      source: string;
    }>;
    const hit = list.find((e) => e.name === want && e.source === "srd");
    expect(hit, `${want} should be SRD`).toBeTruthy();
    return hit!.id;
  };
  const magicMissile = await byName("spell", "Magic Missile");
  const burningHands = await byName("spell", "Burning Hands");

  const banned = await page.request.put(
    `/api/campaigns/${campaign.id}/codex/${burningHands}`,
    { data: { status: "banned" } },
  );
  expect(banned.ok(), await banned.text()).toBeTruthy();

  // A Wizard of this table's own DM — the role does not matter, the seat does.
  const forged = await page.request.post("/api/me/characters/forge", {
    data: {
      name: unique("Loophole "),
      classId: await byName("class", "Wizard"),
      speciesId: await byName("species", "Dwarf"),
      backgroundId: await byName("background", "Acolyte"),
      abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
      skills: ["Arcana", "History"],
      spells: [magicMissile],
    },
  });
  expect(forged.ok(), await forged.text()).toBeTruthy();
  const heroId = (await forged.json()).id as string;
  const seat = await page.request.put(`/api/characters/${heroId}/seat`, {
    data: { campaignId: campaign.id },
  });
  expect(seat.ok(), await seat.text()).toBeTruthy();

  const swap = await page.request.post(`/api/characters/${heroId}/spells/swap`, {
    data: { swaps: [{ replace: magicMissile, with: burningHands }] },
  });
  expect(swap.status(), "the swap-in of banned content is refused").toBe(400);
  expect(((await swap.json()) as { error: string }).error).toContain("codex");

  const detail = (await (await page.request.get(`/api/characters/${heroId}`)).json()) as {
    spells?: Array<{ name: string }>;
  };
  expect((detail.spells ?? []).map((s) => s.name)).not.toContain("Burning Hands");

  // Unseated, the same hero trades freely — the codex rules a table, not an
  // account (the resting-hero freedom every other check honors).
  const unseat = await page.request.put(`/api/characters/${heroId}/seat`, {
    data: { campaignId: null },
  });
  expect(unseat.ok(), await unseat.text()).toBeTruthy();
  const freeSwap = await page.request.post(`/api/characters/${heroId}/spells/swap`, {
    data: { swaps: [{ replace: magicMissile, with: burningHands }] },
  });
  expect(freeSwap.status(), "a resting hero answers to no codex").toBe(200);
});
