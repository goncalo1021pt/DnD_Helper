import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
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
Handouts (#177) — the letter, the torn map corner, the sigil.

What is worth testing here is not that an image uploads; the atlas already
proves that path. It is the veil: a prop the DM has not handed over must be
absent from a player's world in every direction it could leak — the listing,
the chronicle line that announces it, and the image route itself. The last one
matters most, because it is the one a player could reach by typing a URL rather
than by clicking anything the UI drew.
*/

/** A 240x160 PNG, plain green. Built in the browser, like the atlas specs do. */
async function propPng(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3d7a3d";
    ctx.fillRect(0, 0, 240, 160);
    return canvas.toDataURL("image/png");
  });
}

async function bringProp(
  request: APIRequestContext,
  campaignId: string,
  png: string,
  title: string,
  visibleToParty = false,
): Promise<string> {
  const res = await request.post(`/api/campaigns/${campaignId}/handouts`, {
    data: { title, caption: "Sealed in red wax", imageBase64: png, visibleToParty },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

test("a veiled prop is absent from the player's world, then handed over", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmprop"));
  const campaign = await createCampaign(dmPage.request, unique("The Sealed Letter "));

  const png = await propPng(dmPage);
  const letter = await bringProp(dmPage.request, campaign.id, png, "A sealed letter");

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plprop"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  const satchel = async () =>
    ((await (
      await plPage.request.get(`/api/campaigns/${campaign.id}/handouts`)
    ).json()) as Array<{ title: string }>).map((h) => h.title);

  // Veiled: not in the listing, and the bytes are refused outright.
  expect(await satchel()).not.toContain("A sealed letter");
  expect(
    (await plPage.request.get(`/api/handouts/${letter}/image`)).status(),
    "a veiled prop must not serve its picture to a player who guesses the URL",
  ).toBe(404);

  // The DM hands it to the table.
  const res = await dmPage.request.put(`/api/handouts/${letter}/visibility`, {
    data: { scope: "table", visible: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  expect(await satchel()).toContain("A sealed letter");
  expect((await plPage.request.get(`/api/handouts/${letter}/image`)).ok()).toBeTruthy();

  // And it reads on their Chronicle, strip and feed both.
  await plPage.goto(`/questboard/campaigns/${campaign.id}/chronicle`);
  await expect(plPage.getByRole("button", { name: "A sealed letter" })).toBeVisible();
  await expect(
    plPage.getByText("The DM hands the table A sealed letter — Sealed in red wax"),
  ).toBeVisible();

  await dmCtx.close();
  await plCtx.close();
});

test("the chronicle line is withheld with the prop it names", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmline"));
  const campaign = await createCampaign(dmPage.request, unique("The Withdrawn "));

  const png = await propPng(dmPage);
  // Handed over at the moment it is brought, so the line exists from the start.
  const sigil = await bringProp(dmPage.request, campaign.id, png, "A burned sigil", true);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plline"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  const feed = async () =>
    ((await (
      await plPage.request.get(`/api/campaigns/${campaign.id}/events?limit=50&category=all`)
    ).json()) as Array<{ message: string }>).map((e) => e.message);

  expect(await feed()).toContain("The DM hands the table A burned sigil — Sealed in red wax");

  // Taking it back takes the announcement with it — the feed must not keep
  // telling the party about something they can no longer look at.
  const res = await dmPage.request.put(`/api/handouts/${sigil}/visibility`, {
    data: { scope: "table", visible: false },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  expect(await feed()).not.toContain(
    "The DM hands the table A burned sigil — Sealed in red wax",
  );
  // The DM still sees their own ledger whole.
  const dmFeed = ((await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/events?limit=50&category=all`)
  ).json()) as Array<{ message: string }>).map((e) => e.message);
  expect(dmFeed).toContain("The DM hands the table A burned sigil — Sealed in red wax");

  await dmCtx.close();
  await plCtx.close();
});

test("one hero reads what the rest of the party cannot", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmsolo"));
  const campaign = await createCampaign(dmPage.request, unique("The Rogue's Eyes "));

  const png = await propPng(dmPage);
  const note = await bringProp(dmPage.request, campaign.id, png, "A slipped note");

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plsolo"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  // The player brings their own hero to the table — the veil resolves through
  // the heroes a member has seated, so the hero must actually be theirs.
  const heroId = await forgeHero(plPage.request, {
    name: "Vex",
    className: "Rogue",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 15, con: 13, int: 12, wis: 8, cha: 14 },
    // Four, as a Rogue gets — and none of them Acolyte's Insight or Religion.
    skills: ["Acrobatics", "Stealth", "Perception", "Investigation"],
  });
  await seatHero(plPage.request, heroId, campaign.id);

  const res = await dmPage.request.put(`/api/handouts/${note}/visibility`, {
    data: { scope: "character", characterId: heroId, visible: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  const satchel = ((await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/handouts`)
  ).json()) as Array<{ title: string }>).map((h) => h.title);
  expect(satchel, "the hero singled out holds the note").toContain("A slipped note");

  // A second player, with no hero of theirs singled out, still sees nothing.
  const otherCtx = await browser.newContext();
  const otherPage = await otherCtx.newPage();
  await otherPage.goto("/");
  await registerViaAPI(otherPage.request, newAccount("plelse"));
  await joinCampaign(otherPage.request, campaign.inviteCode);

  const theirs = ((await (
    await otherPage.request.get(`/api/campaigns/${campaign.id}/handouts`)
  ).json()) as Array<{ title: string }>).map((h) => h.title);
  expect(theirs, "the rest of the table was not shown it").not.toContain("A slipped note");
  expect((await otherPage.request.get(`/api/handouts/${note}/image`)).status()).toBe(404);

  await dmCtx.close();
  await plCtx.close();
  await otherCtx.close();
});

test("the DM hands something over through the UI", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmui"));
  const campaign = await createCampaign(page.request, unique("The Satchel "));

  await page.goto(`/questboard/campaigns/${campaign.id}/chronicle`);
  await expect(page.getByRole("heading", { name: "The Chronicle" })).toBeVisible();

  await page.getByRole("button", { name: "Hand something over" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("What it is").fill("A torn map corner");
  await modal.getByLabel("The line under it").fill("Half a coastline, badly drawn");

  const png = await propPng(page);
  await modal.locator('input[type="file"]').setInputFiles({
    name: "corner.png",
    mimeType: "image/png",
    buffer: Buffer.from(png.split(",")[1], "base64"),
  });
  await modal.getByRole("checkbox").check();
  await modal.getByRole("button", { name: "Bring it to the table" }).click();
  await settled(page);

  // It lands in the strip, veil state and all, and opens full-size.
  await expect(page.getByRole("button", { name: "A torn map corner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revealed" })).toBeVisible();

  await page.getByRole("button", { name: "A torn map corner" }).click();
  await expect(page.getByRole("dialog", { name: "A torn map corner" })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "A torn map corner" }).getByRole("img"),
  ).toBeVisible();
});
