import { test, expect, type Page } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
The map, the pins, and the fog.

This is the one feature where a bug is a *disclosure*, not an inconvenience:
the fog is composited server-side precisely so a player's browser never holds
the pixels they haven't earned. A DOM test cannot see that — it needs to read
the pixels the server actually sent.

So these tests decode the delivered image in a canvas and sample it. The image
is same-origin, so the canvas is untainted and getImageData works; the page's
session cookie rides along on the fetch, which is exactly the point — we are
asking "what would this user receive?"

The map is two flat halves, red on the left and blue on the right, so a sample
is unambiguous: red means the left half arrived, blue the right, black means
the fog held.
*/

const WIDTH = 400;
const HEIGHT = 200;

/** A 400x200 PNG: left half red, right half blue. Built in the browser. */
async function twoTonePng(page: Page): Promise<string> {
  return page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(w / 2, 0, w / 2, h);
      return canvas.toDataURL("image/png");
    },
    [WIDTH, HEIGHT],
  );
}

/**
 * Fetch the map image as whoever this page is signed in as, and read one pixel.
 * Returns [r, g, b]. `bust` defeats the browser cache between reveals.
 */
async function samplePixel(
  page: Page,
  mapId: string,
  fx: number,
  fy: number,
  bust: string,
): Promise<[number, number, number]> {
  return page.evaluate(
    async ([mapId, fx, fy, bust]) => {
      const img = new Image();
      img.src = `/api/maps/${mapId}/image?v=${bust}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const x = Math.floor((fx as number) * img.naturalWidth);
      const y = Math.floor((fy as number) * img.naturalHeight);
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [mapId, fx, fy, bust] as [string, number, number, string],
  );
}

const isDark = ([r, g, b]: [number, number, number]) => r < 40 && g < 40 && b < 40;
const isRed = ([r, g, b]: [number, number, number]) => r > 150 && g < 90 && b < 90;
const isBlue = ([r, g, b]: [number, number, number]) => b > 150 && r < 90 && g < 90;

test("the fog is composited server-side: a player never receives hidden pixels", async ({
  browser,
}) => {
  const dm = newAccount("dmmap");
  const player = newAccount("plmap");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Cartography "));
  const campaignId = campaign.id;

  // Hang a map the test can reason about.
  const res = await dmPage.request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name: "The Road East", imageBase64: await twoTonePng(dmPage) },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const mapId = (await res.json()).id as string;

  // Fog is opt-in per map (fog_enabled defaults to false), so a fresh map is
  // open ground. Draw the fog before asserting anything about it.
  const fogged = await dmPage.request.patch(`/api/maps/${mapId}`, {
    data: { name: "The Road East", fogEnabled: true },
  });
  expect(fogged.ok(), await fogged.text()).toBeTruthy();

  // --- the DM sees the whole map, fog or no fog ---------------------------
  await dmPage.goto(`/questboard/campaigns/${campaignId}/map`);
  expect(isRed(await samplePixel(dmPage, mapId, 0.25, 0.5, "dm")), "DM should see the red half").toBe(true);
  expect(isBlue(await samplePixel(dmPage, mapId, 0.75, 0.5, "dm")), "DM should see the blue half").toBe(true);

  // --- the player, before any reveal, sees nothing ------------------------
  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await playerPage.goto("/");
  await registerViaAPI(playerPage.request, player);
  await joinCampaign(playerPage.request, campaign.inviteCode);

  await playerPage.goto(`/questboard/campaigns/${campaignId}/map`);
  expect(isDark(await samplePixel(playerPage, mapId, 0.25, 0.5, "0")), "left half must be fogged").toBe(true);
  expect(isDark(await samplePixel(playerPage, mapId, 0.75, 0.5, "0")), "right half must be fogged").toBe(true);

  // --- the DM lifts the fog over the western half only --------------------
  const submitted = await dmPage.request.post(`/api/maps/${mapId}/reveals`, {
    data: { note: "session 1 — the western road", circles: [{ x: 0.25, y: 0.5, r: 0.3 }] },
  });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();

  // The player now receives the west, and STILL not the east. This is the
  // assertion the whole feature exists for.
  await expect
    .poll(async () => isRed(await samplePixel(playerPage, mapId, 0.25, 0.5, "1")), {
      timeout: 15_000,
      message: "the revealed half should reach the player",
    })
    .toBe(true);
  expect(
    isDark(await samplePixel(playerPage, mapId, 0.9, 0.5, "1")),
    "the unrevealed half must still be withheld",
  ).toBe(true);

  await dmCtx.close();
  await playerCtx.close();
});

test("players never receive DM-only pins", async ({ browser }) => {
  const dm = newAccount("dmpin");
  const player = newAccount("plpin");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Pins "));
  const campaignId = campaign.id;
  const mapId = (
    await (
      await dmPage.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "Pinboard", imageBase64: await twoTonePng(dmPage) },
      })
    ).json()
  ).id as string;

  await dmPage.request.post(`/api/maps/${mapId}/pins`, {
    data: { label: "The Tavern", x: 0.2, y: 0.2, dmOnly: false },
  });
  await dmPage.request.post(`/api/maps/${mapId}/pins`, {
    data: { label: "Ambush Here", x: 0.8, y: 0.8, dmOnly: true, note: "three goblins" },
  });

  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await playerPage.goto("/");
  await registerViaAPI(playerPage.request, player);
  await joinCampaign(playerPage.request, campaign.inviteCode);

  const asDM = await (await dmPage.request.get(`/api/maps/${mapId}`)).json();
  const asPlayer = await (await playerPage.request.get(`/api/maps/${mapId}`)).json();

  const labels = (m: { pins?: Array<{ label: string }> }) => (m.pins ?? []).map((p) => p.label).sort();
  expect(labels(asDM)).toEqual(["Ambush Here", "The Tavern"]);
  // Not merely hidden in the UI — absent from the payload, note and all.
  expect(labels(asPlayer)).toEqual(["The Tavern"]);
  expect(JSON.stringify(asPlayer)).not.toContain("three goblins");

  await dmCtx.close();
  await playerCtx.close();
});

test("a sub-map hangs off its parent and is reachable", async ({ page }) => {
  const dm = newAccount("dmsub");
  await page.goto("/");
  await registerViaAPI(page.request, dm);
  const { id: campaignId } = await createCampaign(page.request, unique("Atlas "));
  const png = await twoTonePng(page);

  const parentId = (
    await (
      await page.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "The Overworld", imageBase64: png },
      })
    ).json()
  ).id as string;

  const childRes = await page.request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name: "The Crypt Below", imageBase64: png, parentMapId: parentId },
  });
  expect(childRes.ok(), await childRes.text()).toBeTruthy();

  const atlas = (await (await page.request.get(`/api/campaigns/${campaignId}/maps`)).json()) as Array<{
    id: string;
    name: string;
    parentMapId?: string | null;
  }>;
  const child = atlas.find((m) => m.name === "The Crypt Below");
  expect(child, "the sub-map should be in the atlas").toBeTruthy();
  expect(child!.parentMapId).toBe(parentId);

  // And the atlas offers it, nested under its parent. The atlas is a select,
  // so "reachable" means selectable — not merely present in the DOM.
  await page.goto(`/questboard/campaigns/${campaignId}/map`);
  const atlasPicker = page.locator("select").first();
  await expect(atlasPicker.locator(`option[value="${child!.id}"]`)).toHaveText(/The Crypt Below/);

  await atlasPicker.selectOption(child!.id);
  await expect(atlasPicker).toHaveValue(child!.id);
});

/*
The image route lives outside the OpenAPI surface, so it carries its own
membership gate rather than inheriting a generated one. That makes it worth a
test of its own: a map URL is a guessable-shaped thing to pass around, and
someone who is not at the table must get nothing at all — not a fogged image,
nothing.
*/
test("a stranger with the URL gets nothing", async ({ browser }) => {
  const dm = newAccount("dmwall");
  const stranger = newAccount("nobody");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const { id: campaignId } = await createCampaign(dmPage.request, unique("Walled "));
  const mapId = (
    await (
      await dmPage.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "Private", imageBase64: await twoTonePng(dmPage) },
      })
    ).json()
  ).id as string;

  // Signed in, but at somebody else's table.
  const outCtx = await browser.newContext();
  const outPage = await outCtx.newPage();
  await outPage.goto("/");
  await registerViaAPI(outPage.request, stranger);
  expect((await outPage.request.get(`/api/maps/${mapId}/image`)).status()).toBe(403);
  expect((await outPage.request.get(`/api/maps/${mapId}`)).status()).toBe(403);

  // Not signed in at all.
  const anonCtx = await browser.newContext();
  expect((await anonCtx.request.get(`/api/maps/${mapId}/image`)).status()).toBe(401);

  await dmCtx.close();
  await outCtx.close();
  await anonCtx.close();
});
