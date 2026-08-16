import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  forgeHero,
  fundHero,
  joinCampaign,
  newAccount,
  quickAddHero,
  registerViaAPI,
  revealLocation,
  seatHero,
  unique,
} from "./helpers";

/*
Exploratory QA — the Folk and the Bazaar.

Test 1 (the Folk): a place tree with one revealed city and one veiled one;
people unfiled, filed under each; a homebrew Den monster behind one and a
sheet behind another. Both veils exercised independently (existence
party-wide AND per-hero; stats per-hero), always verified from the PLAYERS'
own sessions against the raw API payload, not just the DOM. Then the
detach paths (nil UUID) and what deleting a place does to its people —
including the question the fog code answers one way and the folk another.

Test 2 (the Bazaar): magic on the shelves — a rarity+bonus weapon, a +1
cloak that demands attunement, a worn ring — bought through the UI with the
purse counted to the copper, then worked on the sheet: the +N reaches AC
only while the bond holds, three bonds are the ceiling, wear slots behave.
*/

const NIL = "00000000-0000-0000-0000-000000000000";

const trouble: string[] = [];
function watch(page: Page, label: string) {
  page.on("console", (m) => {
    if (m.type() === "error") trouble.push(`[${label}] console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => trouble.push(`[${label}] pageerror: ${e.message}`));
}

function timed(label: string) {
  const t0 = Date.now();
  return () => {
    const ms = Date.now() - t0;
    console.log(`TIMING ${label} ${ms}ms`);
    return ms;
  };
}

async function npcsOf(request: APIRequestContext, campaignId: string) {
  const res = await request.get(`/api/campaigns/${campaignId}/npcs`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Array<Record<string, unknown>>;
}

test("the folk: two veils, the ancestor walk, detach, and what deleting a place does", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const aCtx = await browser.newContext();
  const bCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const plA = await aCtx.newPage();
  const plB = await bCtx.newPage();
  watch(dm, "dm");
  watch(plA, "playerA");
  watch(plB, "playerB");

  // --- the world ------------------------------------------------------------
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("fkdm"));
  const campaign = await createCampaign(dm.request, unique("Harbour Ledger "));
  const lisboa = await createLocation(dm.request, campaign.id, unique("Lisboa "));
  await revealLocation(dm.request, lisboa);
  const porto = await createLocation(dm.request, campaign.id, unique("Porto "));
  // Porto stays veiled.

  // A homebrew monster of the DM's own making, straight into the Den.
  const drakeName = unique("Harbour Drake ");
  const drakeRes = await dm.request.post(`/api/rules/monster`, {
    data: {
      name: drakeName,
      summary: "Medium Dragon, Neutral — CR 1",
      data: {
        size: "Medium",
        type: "Dragon",
        alignment: "Neutral",
        ac: 14,
        hp: 22,
        speed: "30 ft., swim 30 ft.",
        cr: "1 (XP 200; PB +2)",
        crValue: 1,
        abilities: { str: 14, dex: 12, con: 13, int: 8, wis: 11, cha: 10 },
        description: "_Medium Dragon, Neutral_\n\n**AC** 14\n\n**HP** 22 (4d8+4)\n\n**CR** 1 (XP 200; PB +2)",
      },
    },
  });
  expect(drakeRes.ok(), await drakeRes.text()).toBeTruthy();

  // --- two players, each with a seated hero ---------------------------------
  await plA.goto("/");
  await registerViaAPI(plA.request, newAccount("fkpla"));
  await joinCampaign(plA.request, campaign.inviteCode);
  const heroA = await forgeHero(plA.request, {
    name: unique("Ines "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  await seatHero(plA.request, heroA, campaign.id);

  await plB.goto("/");
  await registerViaAPI(plB.request, newAccount("fkplb"));
  await joinCampaign(plB.request, campaign.inviteCode);
  const heroB = await forgeHero(plB.request, {
    name: unique("Rui "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  await seatHero(plB.request, heroB, campaign.id);

  // --- DM brings in the fishwife through the UI, drake behind her -----------
  const doneLoad = timed("dm-npcs-page-load");
  await dm.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await expect(dm.getByPlaceholder("Bring in a person — name them…")).toBeVisible({ timeout: 20_000 });
  doneLoad();

  const fishwife = unique("Fishwife Alda ");
  const doneCreate = timed("dm-create-npc-ui");
  await dm.getByPlaceholder("Bring in a person — name them…").fill(fishwife);
  await dm.getByLabel("Where they are found").selectOption(lisboa);
  await dm.getByRole("button", { name: "Bring in", exact: true }).click();
  await expect(dm.getByText(fishwife)).toBeVisible({ timeout: 20_000 });
  doneCreate();

  const doneAttach = timed("dm-attach-homebrew-block");
  await dm.getByLabel(`Attach a stat block to ${fishwife}`).fill(drakeName);
  await dm.getByRole("button", { name: new RegExp(`^${drakeName}`) }).click();
  await expect(
    dm.getByRole("button", { name: `Read their stat block — ${drakeName}` }),
  ).toBeVisible({ timeout: 20_000 });
  doneAttach();

  // Reveal her to the party through the card's own stamp (only card on page).
  await dm.getByRole("button", { name: "Unknown to the party" }).click();
  await expect(dm.getByRole("button", { name: "The party knows them" })).toBeVisible();

  await dm.screenshot({ path: "exp-shots/folk-bazaar/01-dm-folk.png", fullPage: true });

  // --- the rest of the folk, by API -----------------------------------------
  const dmNpcs = await npcsOf(dm.request, campaign.id);
  const fishId = dmNpcs.find((n) => n.name === fishwife)!.id as string;

  const wanderer = unique("Wanderer Bento ");
  const wandRes = await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, {
    data: { name: wanderer, locationId: null },
  });
  expect(wandRes.ok(), await wandRes.text()).toBeTruthy();
  const wandId = (await wandRes.json()).id as string;

  const smuggler = unique("Smuggler Catia ");
  const smugRes = await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, {
    data: { name: smuggler, locationId: porto },
  });
  expect(smugRes.ok(), await smugRes.text()).toBeTruthy();
  const smugId = (await smugRes.json()).id as string;

  // A table-born sheet stands behind the wanderer.
  const martaId = await quickAddHero(dm.request, campaign.id, unique("Old Marta "));
  const attachSheet = await dm.request.patch(`/api/npcs/${wandId}`, {
    data: { name: wanderer, characterId: martaId },
  });
  expect(attachSheet.ok(), await attachSheet.text()).toBeTruthy();

  // --- before any reveal beyond the fishwife: players see only her ----------
  // (heroA/heroB both resolve through the party-wide veils so far)
  const aFirst = await npcsOf(plA.request, campaign.id);
  expect(aFirst.map((n) => n.name)).toEqual([fishwife]);

  // Her stats must NOT travel yet, and neither must any DM-only field.
  const aFish = aFirst[0];
  for (const key of [
    "statBlock", "characterId", "characterName", "contentId",
    "visibleToParty", "visibility", "statsVisibleToParty", "statsVisibility",
  ]) {
    expect(aFish[key], `player payload must not carry ${key}`).toBeUndefined();
  }
  expect(aFish.isDM).toBe(false);
  expect(String(aFish.locationName)).toContain("Lisboa");

  // --- veils: smuggler party-visible (but Porto is veiled), wanderer per-hero
  const smugVis = await dm.request.put(`/api/npcs/${smugId}/visibility`, {
    data: { scope: "party", visible: true },
  });
  expect(smugVis.ok(), await smugVis.text()).toBeTruthy();
  const wandVis = await dm.request.put(`/api/npcs/${wandId}/visibility`, {
    data: { scope: "character", characterId: heroA, visible: true },
  });
  expect(wandVis.ok(), await wandVis.text()).toBeTruthy();

  // Player A: fishwife + wanderer. NOT the smuggler — Porto's veil has the
  // final word over her own party-visible flag (the ancestor walk).
  const aNames = (await npcsOf(plA.request, campaign.id)).map((n) => n.name);
  expect(aNames.sort()).toEqual([fishwife, wanderer].sort());

  // Player B: only the fishwife. The wanderer's exception names heroA alone.
  const bNames = (await npcsOf(plB.request, campaign.id)).map((n) => n.name);
  expect(bNames).toEqual([fishwife]);

  // The player page agrees with the payload.
  const doneAPage = timed("playerA-npcs-page-load");
  await plA.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await expect(plA.getByText(fishwife)).toBeVisible({ timeout: 20_000 });
  doneAPage();
  await expect(plA.getByText(wanderer)).toBeVisible();
  await expect(plA.getByText(smuggler)).toHaveCount(0);
  await expect(plA.getByRole("button", { name: /Read their stat block/ })).toHaveCount(0);
  await plA.screenshot({ path: "exp-shots/folk-bazaar/02-playerA-folk.png", fullPage: true });

  // --- the second veil, hero by hero ----------------------------------------
  // Fishwife's numbers to heroA alone.
  const statsA = await dm.request.put(`/api/npcs/${fishId}/stats-visibility`, {
    data: { scope: "character", characterId: heroA, visible: true },
  });
  expect(statsA.ok(), await statsA.text()).toBeTruthy();

  const aAfterStats = await npcsOf(plA.request, campaign.id);
  const aFish2 = aAfterStats.find((n) => n.name === fishwife)!;
  expect(aFish2.statBlock, "heroA may now read the block").toBeTruthy();
  expect((aFish2.statBlock as { name: string }).name).toBe(drakeName);

  const bAfterStats = await npcsOf(plB.request, campaign.id);
  const bFish = bAfterStats.find((n) => n.name === fishwife)!;
  expect(bFish.statBlock, "heroB may not — the stats veil is per-hero").toBeUndefined();

  // Player A reads the block in the UI.
  await plA.reload();
  const doneRead = timed("playerA-read-stat-block");
  await plA.getByRole("button", { name: `Read their stat block — ${drakeName}` }).click();
  await expect(plA.getByText(/Dragon/i).first()).toBeVisible({ timeout: 20_000 });
  doneRead();
  await plA.screenshot({ path: "exp-shots/folk-bazaar/03-playerA-statblock.png", fullPage: true });
  await plA.keyboard.press("Escape");

  // The wanderer's SHEET opens party-wide — but only those who know him get it.
  const sheetVis = await dm.request.put(`/api/npcs/${wandId}/stats-visibility`, {
    data: { scope: "party", visible: true },
  });
  expect(sheetVis.ok(), await sheetVis.text()).toBeTruthy();

  const aWand = (await npcsOf(plA.request, campaign.id)).find((n) => n.name === wanderer)!;
  expect(aWand.characterId).toBe(martaId);
  expect(aWand.characterName).toBeTruthy();
  const bWand = (await npcsOf(plB.request, campaign.id)).find((n) => n.name === wanderer);
  expect(bWand, "B still does not know the wanderer exists").toBeUndefined();

  // Does the sheet link actually open for player A, or is it a dead end?
  await plA.reload();
  const doneSheet = timed("playerA-open-npc-sheet");
  await plA.getByRole("link", { name: /Open their sheet/ }).click();
  await expect(plA).toHaveURL(new RegExp(`/questboard/heroes/${martaId}`));
  // Whatever renders, capture it — a 403 or empty page here is a dead end.
  await plA.waitForLoadState("networkidle");
  doneSheet();
  await plA.screenshot({ path: "exp-shots/folk-bazaar/04-playerA-npc-sheet.png", fullPage: true });

  // --- the DM's party-wide stats stamp clears per-hero exceptions -----------
  await dm.reload();
  const fishCardStats = dm.getByRole("button", { name: "Stats veiled" });
  await expect(fishCardStats).toBeVisible({ timeout: 20_000 });
  await fishCardStats.click();
  await expect(dm.getByRole("button", { name: "Stats open" })).toBeVisible();
  const bFishOpen = (await npcsOf(plB.request, campaign.id)).find((n) => n.name === fishwife)!;
  expect(bFishOpen.statBlock, "party-wide stats now reach heroB too").toBeTruthy();

  // --- detach: the nil UUID puts them back to being just a name -------------
  const detachBlock = await dm.request.patch(`/api/npcs/${fishId}`, {
    data: { name: fishwife, contentId: NIL },
  });
  expect(detachBlock.ok(), await detachBlock.text()).toBeTruthy();
  const dmFishAfter = (await npcsOf(dm.request, campaign.id)).find((n) => n.name === fishwife)!;
  expect(dmFishAfter.contentId, "the block is detached for the DM too").toBeUndefined();
  const aFishAfter = (await npcsOf(plA.request, campaign.id)).find((n) => n.name === fishwife)!;
  expect(aFishAfter.statBlock, "no orphaned block reaches the player").toBeUndefined();

  const detachSheet = await dm.request.patch(`/api/npcs/${wandId}`, {
    data: { name: wanderer, characterId: NIL },
  });
  expect(detachSheet.ok(), await detachSheet.text()).toBeTruthy();
  const aWandAfter = (await npcsOf(plA.request, campaign.id)).find((n) => n.name === wanderer)!;
  expect(aWandAfter.characterId).toBeUndefined();

  // --- a player probing ids: the refusal should read like absence -----------
  const probeReal = await plB.request.patch(`/api/npcs/${smugId}`, {
    data: { name: "Nobody" },
  });
  const probeFake = await plB.request.patch(`/api/npcs/${NIL.replace(/0/g, "9").slice(0, 8) + NIL.slice(8)}`, {
    data: { name: "Nobody" },
  });
  console.log(`PROBE hidden-npc-patch=${probeReal.status()} unknown-id-patch=${probeFake.status()}`);
  expect(probeReal.ok()).toBeFalsy();
  expect(probeFake.ok()).toBeFalsy();

  // --- deleting a place: its people survive, unfiled ------------------------
  const delLisboa = await dm.request.delete(`/api/locations/${lisboa}`);
  expect(delLisboa.ok(), await delLisboa.text()).toBeTruthy();
  const dmAfterDel = await npcsOf(dm.request, campaign.id);
  const fishSurvived = dmAfterDel.find((n) => n.name === fishwife)!;
  expect(fishSurvived, "the person survives their place").toBeTruthy();
  expect(fishSurvived.locationId, "…but unfiled").toBeUndefined();
  const aFishSurvived = (await npcsOf(plA.request, campaign.id)).find((n) => n.name === fishwife)!;
  expect(aFishSurvived, "still known — her own veil said party").toBeTruthy();

  // --- the sharp edge: deleting the VEILED city -----------------------------
  // The smuggler is party-visible but hidden solely by Porto's veil. Fog
  // batches cascade on place deletion precisely so a struck city's secrets
  // are not handed to the table (locations.go). If she appears to players
  // after the strike, the same leak the fog code refuses is open here.
  const delPorto = await dm.request.delete(`/api/locations/${porto}`);
  expect(delPorto.ok(), await delPorto.text()).toBeTruthy();
  const aFinal = await npcsOf(plA.request, campaign.id);
  console.log(`AFTER-PORTO-DELETE playerA sees: ${aFinal.map((n) => n.name).join(" | ")}`);
  await plA.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await expect(plA.getByText(fishwife)).toBeVisible({ timeout: 20_000 });
  await plA.screenshot({ path: "exp-shots/folk-bazaar/05-playerA-after-place-delete.png", fullPage: true });
  console.log("TROUBLE " + JSON.stringify(trouble));
  expect(
    aFinal.map((n) => n.name),
    "striking a veiled city must not hand its hidden resident to the party",
  ).not.toContain(smuggler);

  console.log("TROUBLE " + JSON.stringify(trouble));
  await dmCtx.close();
  await aCtx.close();
  await bCtx.close();
});

test("the bazaar: magic goods bought at the till, and the bonds that wake them", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const plCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await plCtx.newPage();
  watch(dm, "bz-dm");
  watch(player, "bz-player");

  // --- DM: a revealed town, a shop, three magic lines -----------------------
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("bzfdm"));
  const campaign = await createCampaign(dm.request, unique("Ledger of Coin "));
  const town = await createLocation(dm.request, campaign.id, unique("Miradouro "));
  await revealLocation(dm.request, town);

  const doneVendors = timed("dm-vendors-page-load");
  await dm.goto(`/questboard/campaigns/${campaign.id}/vendors`);
  await expect(dm.getByPlaceholder("Open a shop — name it…")).toBeVisible({ timeout: 20_000 });
  doneVendors();

  const shop = unique("The Gilded Scale ");
  await dm.getByPlaceholder("Open a shop — name it…").fill(shop);
  await dm.getByLabel("Where it trades").selectOption(town);
  await dm.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dm.getByText(shop)).toBeVisible({ timeout: 20_000 });

  const stockByName = async (want: string, price: string, qty: string) => {
    const done = timed(`dm-stock-${want}`);
    await dm.getByLabel(`Stock ${shop}`).selectOption({ label: want });
    await dm.getByLabel("Price for the new line").fill(price);
    await dm.getByLabel("Quantity for the new line").fill(qty);
    await dm.getByRole("button", { name: "Stock it" }).click();
    await expect(dm.getByRole("button", { name: want, exact: true })).toBeVisible({ timeout: 20_000 });
    done();
  };
  await stockByName("+1 Longsword", "400 gp", "1");
  await stockByName("Cloak of Protection", "300 gp", "1");
  await stockByName("Ring of Protection", "150 gp", "1");

  await dm.getByRole("button", { name: "Hidden from the party" }).click();
  await expect(dm.getByRole("button", { name: "The party knows it" })).toBeVisible();
  await dm.getByRole("button", { name: "Show +1 Longsword" }).click();
  await dm.getByRole("button", { name: "Show Cloak of Protection" }).click();
  await dm.getByRole("button", { name: "Show Ring of Protection" }).click();
  await dm.screenshot({ path: "exp-shots/folk-bazaar/06-dm-bazaar.png", fullPage: true });

  // --- a funded fighter takes their seat ------------------------------------
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("bzfpl"));
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
  // NOTE: fundHero(…, 1000) is REFUSED — "quantity must be between 1 and 999".
  // A purse row is capped at 999 gp, so no price above 999 can ever be paid.
  const overCap = await player.request.post(`/api/characters/${heroId}/items`, {
    data: { name: "Gold Pieces", qty: 1000 },
  });
  console.log(`PURSE-CAP qty=1000 -> ${overCap.status()} ${await overCap.text()}`);
  await fundHero(player.request, heroId, 900);

  const donePlVendors = timed("player-vendors-page-load");
  await player.goto(`/questboard/campaigns/${campaign.id}/vendors`);
  await expect(player.getByText("900 GP", { exact: true })).toBeVisible({ timeout: 20_000 });
  donePlVendors();

  // --- buy all three: the purse counted to the copper -----------------------
  const doneBuy1 = timed("buy-plus1-longsword");
  await player.getByRole("button", { name: "Buy +1 Longsword" }).click();
  await expect(player.getByText(/Paid 400 gp for \+1 Longsword — 500 gp left/)).toBeVisible();
  doneBuy1();
  await expect(player.getByText("500 GP", { exact: true })).toBeVisible();
  await expect(player.getByRole("button", { name: "Buy +1 Longsword" })).toBeDisabled();
  await expect(player.getByText("sold out").first()).toBeVisible();

  await player.getByRole("button", { name: "Buy Cloak of Protection" }).click();
  await expect(player.getByText(/Paid 300 gp for Cloak of Protection — 200 gp left/)).toBeVisible();
  await player.getByRole("button", { name: "Buy Ring of Protection" }).click();
  await expect(player.getByText(/Paid 150 gp for Ring of Protection — 50 gp left/)).toBeVisible();
  await expect(player.getByText("50 GP", { exact: true })).toBeVisible();
  await player.screenshot({ path: "exp-shots/folk-bazaar/07-player-bazaar-bought.png", fullPage: true });

  // The goods landed content-linked — a magic item bought must keep its magic.
  const detail = (await (await player.request.get(`/api/characters/${heroId}`)).json()) as {
    items: Array<{ id: string; name: string; qty: number; content?: { name: string } }>;
  };
  const bought = (n: string) => detail.items.find((i) => i.name === n);
  expect(bought("Gold Pieces")?.qty).toBe(50);
  for (const n of ["+1 Longsword", "Cloak of Protection", "Ring of Protection"]) {
    expect(bought(n)?.qty, `${n} in the pack`).toBe(1);
    expect(bought(n)?.content, `${n} must keep its armory link through the till`).toBeTruthy();
  }

  // --- the sheet: the bonus reaches the numbers only as the rules say -------
  const doneSheet = timed("hero-sheet-load");
  await player.goto(`/questboard/heroes/${heroId}`);
  const acBox = player
    .locator(`xpath=//div[contains(@class,'label-stamp') and normalize-space()='AC']/following-sibling::div`)
    .first();
  await expect(acBox).toHaveText("10", { timeout: 20_000 });
  doneSheet();

  await player.getByRole("button", { name: "Inventory" }).click();

  // The +1 blade needs no bond: equipped, its enchantment counts at once.
  await player.getByRole("button", { name: /\+1 Longsword/ }).first().click();
  await player.getByRole("dialog").getByRole("button", { name: "Equip · Main Hand" }).click();
  await player.getByTitle("Close").click();
  await expect(player.getByText("+6 to hit · 1d8+4 slashing")).toBeVisible();

  // The cloak hangs mundane until attuned.
  await player.getByRole("button", { name: /Cloak of Protection/ }).first().click();
  await player.getByRole("dialog").getByRole("button", { name: "Wear · Cloak" }).click();
  await player.getByTitle("Close").click();
  await player.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("10");

  await player.getByRole("button", { name: "Inventory" }).click();
  await player.getByRole("button", { name: /Cloak of Protection/ }).first().click();
  const doneAttune = timed("attune-cloak");
  await player.getByRole("dialog").getByRole("button", { name: "Attune", exact: true }).click();
  await player.getByTitle("Close").click();
  await expect(player.getByText("Attuned 1/3")).toBeVisible();
  doneAttune();
  await player.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("11");

  // The ring takes a ring slot and stacks its own +1 once bonded.
  await player.getByRole("button", { name: "Inventory" }).click();
  await player.getByRole("button", { name: /Ring of Protection/ }).first().click();
  await player.getByRole("dialog").getByRole("button", { name: "Wear · Ring" }).first().click();
  await player.getByTitle("Close").click();
  await player.getByRole("button", { name: /Ring of Protection/ }).first().click();
  await player.getByRole("dialog").getByRole("button", { name: "Attune", exact: true }).click();
  await player.getByTitle("Close").click();
  await expect(player.getByText("Attuned 2/3")).toBeVisible();
  await player.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("12");
  await player.screenshot({ path: "exp-shots/folk-bazaar/08-sheet-attuned.png", fullPage: true });

  // --- three bonds are the ceiling ------------------------------------------
  const addByName = async (name: string) => {
    const list = (await (await player.request.get(`/api/rules/item`)).json()) as Array<{ id: string; name: string }>;
    const hit = list.find((e) => e.name === name)!;
    expect(hit, `${name} in the armory`).toBeTruthy();
    const res = await player.request.post(`/api/characters/${heroId}/items`, {
      data: { contentId: hit.id, qty: 1 },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).id as string;
  };
  const amulet = await addByName("Amulet of Health");
  const warmth = await addByName("Ring of Warmth");
  const third = await player.request.patch(`/api/characters/${heroId}/items/${amulet}`, {
    data: { attuned: true },
  });
  expect(third.ok(), await third.text()).toBeTruthy();

  await player.reload();
  await player.getByRole("button", { name: "Inventory" }).click();
  await expect(player.getByText("Attuned 3/3")).toBeVisible({ timeout: 20_000 });

  // The UI refuses the fourth politely: a disabled button that says why.
  await player.getByRole("button", { name: /Ring of Warmth/ }).first().click();
  const attuneBtn = player.getByRole("dialog").getByRole("button", { name: "Attune", exact: true });
  await expect(attuneBtn).toBeDisabled();
  await expect(attuneBtn).toHaveAttribute("title", /Three items are the most/);
  await player.screenshot({ path: "exp-shots/folk-bazaar/09-fourth-bond-refused.png", fullPage: true });
  await player.getByTitle("Close").click();

  // And the server holds the line in its own words.
  const fourth = await player.request.patch(`/api/characters/${heroId}/items/${warmth}`, {
    data: { attuned: true },
  });
  expect(fourth.status()).toBe(400);
  expect(await fourth.text()).toContain("three items are the most a hero can attune to");

  // --- breaking the bond takes the bonus with it, wearing stays -------------
  await player.getByRole("button", { name: /Cloak of Protection/ }).first().click();
  await player.getByRole("dialog").getByRole("button", { name: "Break attunement" }).click();
  await player.getByTitle("Close").click();
  await expect(player.getByText("Attuned 2/3")).toBeVisible();
  await player.getByRole("button", { name: "The Sheet" }).click();
  await expect(acBox).toHaveText("11"); // ring's +1 only — the cloak hangs mundane again

  // The second ring slot takes the second ring. NOTE: the modal offers two
  // identical "Wear · Ring" buttons; the FIRST maps to ring1, which is
  // occupied — clicking it would silently displace the Ring of Protection.
  // We aim for the second deliberately and flag the ambiguity as UX.
  await player.getByRole("button", { name: "Inventory" }).click();
  await player.getByRole("button", { name: /Ring of Warmth/ }).first().click();
  await player.getByRole("dialog").getByRole("button", { name: "Wear · Ring" }).nth(1).click();
  await player.getByTitle("Close").click();
  const wornRings = (await (await player.request.get(`/api/characters/${heroId}`)).json()) as {
    items: Array<{ name: string; slot?: string; equipped?: boolean }>;
  };
  const slots = wornRings.items
    .filter((i) => i.equipped && i.slot?.startsWith("ring"))
    .map((i) => `${i.name}:${i.slot}`)
    .sort();
  console.log(`RING-SLOTS ${slots.join(" | ")}`);
  expect(slots).toHaveLength(2);
  expect(new Set(wornRings.items.filter((i) => i.equipped && i.slot?.startsWith("ring")).map((i) => i.slot)).size,
    "two rings, two different fingers").toBe(2);
  await player.screenshot({ path: "exp-shots/folk-bazaar/10-two-rings.png", fullPage: true });

  console.log("TROUBLE " + JSON.stringify(trouble));
  await dmCtx.close();
  await plCtx.close();
});
