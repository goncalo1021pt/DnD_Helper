import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  forgeHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  revealLocation,
  seatHero,
  unique,
} from "./helpers";

/*
The veil over a map's existence (#276).

Fog hid the ground and left the map itself announcing that there was ground to
hide: every member received every map in the campaign, so the atlas listed the
name of the dungeon the party had not found and the picture opened for anyone
holding the id.

What is worth pinning is that the veil is ABSENCE, in all three places a map
can be reached — the shelf, the payload, and the picture — and that the three
never disagree. A 403 on the image would confirm the dungeon exists just as
loudly as the name would.
*/

const WIDTH = 400;
const HEIGHT = 200;

async function flatPng(page: Page): Promise<string> {
  return page.evaluate(
    ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#3b2a18";
      ctx.fillRect(0, 0, w, h);
      return c.toDataURL("image/png");
    },
    [WIDTH, HEIGHT],
  );
}

/** Hang a map. Left alone it is the DM's own — that is the new default. */
async function hangMap(
  page: Page,
  campaignId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await page.request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name: unique("Chart "), imageBase64: await flatPng(page), ...extra },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

async function atlasOf(request: APIRequestContext, campaignId: string) {
  const res = await request.get(`/api/campaigns/${campaignId}/maps`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Array<{ id: string; name: string; visibleToParty?: boolean }>;
}

/** Set a map's veil at one of the three grains (DM only). */
async function setVeil(
  request: APIRequestContext,
  mapId: string,
  campaignId: string,
  body: Record<string, unknown>,
) {
  const res = await request.put(`/api/maps/${mapId}/visibility?campaignId=${campaignId}`, { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res;
}

test("a newly hung map is the DM's alone, in all three places it could be reached", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmveil"));
  const campaign = await createCampaign(dm.request, unique("Hidden Ways "));
  const secret = await hangMap(dm, campaign.id);
  const shown = await hangMap(dm, campaign.id, { visibleToParty: true });

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plveil"));
  await joinCampaign(pl.request, campaign.inviteCode);

  // The shelf: only the one hung in the hall.
  const theirs = await atlasOf(pl.request, campaign.id);
  expect(theirs.map((m) => m.id)).toEqual([shown]);
  // Absent, not flagged — nothing in the payload hints the other one exists.
  expect(JSON.stringify(theirs)).not.toContain(secret);
  // And the veil state itself is the DM's business, like the invite code.
  expect(theirs[0].visibleToParty).toBeUndefined();

  // The payload and the picture: 404, never 403. A refusal that says
  // "forbidden" confirms the dungeon is there.
  expect((await pl.request.get(`/api/maps/${secret}?campaignId=${campaign.id}`)).status()).toBe(404);
  expect((await pl.request.get(`/api/maps/${secret}/image?campaignId=${campaign.id}`)).status()).toBe(404);
  // The one they were given answers normally.
  expect((await pl.request.get(`/api/maps/${shown}?campaignId=${campaign.id}`)).status()).toBe(200);
  expect((await pl.request.get(`/api/maps/${shown}/image?campaignId=${campaign.id}`)).ok()).toBeTruthy();

  // The DM's own atlas still holds both, and says which is which.
  const mine = await atlasOf(dm.request, campaign.id);
  expect(mine).toHaveLength(2);
  expect(mine.find((m) => m.id === secret)!.visibleToParty).toBe(false);
  expect(mine.find((m) => m.id === shown)!.visibleToParty).toBe(true);

  // A player cannot set a veil, on any map.
  const forbidden = await pl.request.put(`/api/maps/${shown}/visibility?campaignId=${campaign.id}`, {
    data: { scope: "table", visible: false },
  });
  expect(forbidden.status()).toBe(403);

  await dmCtx.close();
  await plCtx.close();
});

test("one scout holds a map the rest of the table cannot", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmscout"));
  const campaign = await createCampaign(dm.request, unique("The Long Ride "));
  const ahead = await hangMap(dm, campaign.id);

  const scoutCtx = await browser.newContext();
  const scout = await scoutCtx.newPage();
  await scout.goto("/");
  await registerViaAPI(scout.request, newAccount("plscout"));
  await joinCampaign(scout.request, campaign.inviteCode);
  const heroId = await forgeHero(scout.request, {
    name: unique("Vasco "),
    className: "Fighter",
    // A Dwarf asks nothing at creation, and neither skill is Soldier's own —
    // the forge refuses a class pick the background already granted.
    speciesName: "Dwarf",
    backgroundName: "Soldier",
    abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
    skills: ["Perception", "Survival"],
  });
  await seatHero(scout.request, heroId, campaign.id);

  const restCtx = await browser.newContext();
  const rest = await restCtx.newPage();
  await rest.goto("/");
  await registerViaAPI(rest.request, newAccount("plrest"));
  await joinCampaign(rest.request, campaign.inviteCode);

  await setVeil(dm.request, ahead, campaign.id, { scope: "character", characterId: heroId, visible: true });

  expect((await atlasOf(scout.request, campaign.id)).map((m) => m.id)).toEqual([ahead]);
  expect(await atlasOf(rest.request, campaign.id)).toHaveLength(0);
  expect((await rest.request.get(`/api/maps/${ahead}?campaignId=${campaign.id}`)).status()).toBe(404);

  // Handing it to the whole table clears the exception and reaches everyone.
  await setVeil(dm.request, ahead, campaign.id, { scope: "table", visible: true });
  expect(await atlasOf(rest.request, campaign.id)).toHaveLength(1);
  const mine = await atlasOf(dm.request, campaign.id);
  expect(mine[0].visibleToParty).toBe(true);
  expect((mine[0] as { visibilityOverrides?: unknown[] }).visibilityOverrides).toHaveLength(0);

  await dmCtx.close();
  await scoutCtx.close();
  await restCtx.close();
});

test("a map of a place nobody knows of is a map of nothing", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmplace"));
  const campaign = await createCampaign(dm.request, unique("Barovia "));
  const country = await createLocation(dm.request, campaign.id, unique("Barovia "));
  const cityMap = await hangMap(dm, campaign.id, {
    visibleToParty: true,
    locationId: country,
  });

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plplace"));
  await joinCampaign(pl.request, campaign.inviteCode);

  // Places start veiled, so the map hung on one starts unreachable however
  // wide its own veil is opened.
  expect(await atlasOf(pl.request, campaign.id)).toHaveLength(0);
  expect((await pl.request.get(`/api/maps/${cityMap}/image?campaignId=${campaign.id}`)).status()).toBe(404);

  // Showing the place shows the map, with nothing touched on the map itself.
  await revealLocation(dm.request, country, campaign.id);
  expect((await atlasOf(pl.request, campaign.id)).map((m) => m.id)).toEqual([cityMap]);

  await dmCtx.close();
  await plCtx.close();
});

test("a marker leading into a veiled map does not carry its name out", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmpin"));
  const campaign = await createCampaign(dm.request, unique("The Overworld "));
  const world = await hangMap(dm, campaign.id, { visibleToParty: true });
  const lair = await hangMap(dm, campaign.id);

  const doorway = await dm.request.post(`/api/maps/${world}/pins?campaignId=${campaign.id}`, {
    data: { label: "The Cragmaw Hideout", x: 0.5, y: 0.5, linkMapId: lair },
  });
  expect(doorway.ok(), await doorway.text()).toBeTruthy();
  await dm.request.post(`/api/maps/${world}/pins?campaignId=${campaign.id}`, {
    data: { label: "Phandalin", x: 0.2, y: 0.3 },
  });

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plpin"));
  await joinCampaign(pl.request, campaign.inviteCode);

  const detail = await pl.request.get(`/api/maps/${world}?campaignId=${campaign.id}`);
  const pins = (await detail.json()).pins as Array<{ label: string }>;
  expect(pins.map((p) => p.label)).toEqual(["Phandalin"]);
  expect(JSON.stringify(pins)).not.toContain("Cragmaw");

  // Hang the lair in the hall and the doorway to it appears with it.
  await setVeil(dm.request, lair, campaign.id, { scope: "table", visible: true });
  const after = await pl.request.get(`/api/maps/${world}?campaignId=${campaign.id}`);
  const seen = (await after.json()).pins as Array<{ label: string }>;
  expect(seen.map((p) => p.label).sort()).toEqual(["Phandalin", "The Cragmaw Hideout"]);

  await dmCtx.close();
  await plCtx.close();
});

test("the DM hangs a map in the hall from the atlas", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.setViewportSize({ width: 1280, height: 800 });
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmatlas"));
  const campaign = await createCampaign(dm.request, unique("The Atlas "));
  const secret = await hangMap(dm, campaign.id);

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("platlas"));
  await joinCampaign(pl.request, campaign.inviteCode);
  expect(await atlasOf(pl.request, campaign.id)).toHaveLength(0);

  await dm.goto(`/questboard/campaigns/${campaign.id}/map/${secret}`);
  // The map on the table says it is still the DM's own, and leads to the veil.
  await dm.getByRole("button", { name: "Yours alone" }).click();
  await expect(dm.getByRole("heading", { name: "The Atlas" })).toBeVisible();

  await dm.locator(`[title^="Yours alone"]`).first().click();
  await expect(dm.getByRole("heading", { name: "Who Knows Of It" })).toBeVisible();
  await dm.getByRole("button", { name: "Veiled from all" }).click();
  await expect(dm.getByRole("button", { name: "Revealed to all" })).toBeVisible();

  await expect
    .poll(async () => (await atlasOf(pl.request, campaign.id)).length)
    .toBe(1);

  await dmCtx.close();
  await plCtx.close();
});
