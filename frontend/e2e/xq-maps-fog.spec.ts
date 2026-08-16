import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  createCampaign,
  createLocation,
  joinCampaign,
  newAccount,
  registerViaAPI,
  revealLocation,
  unique,
} from "./helpers";

/*
Exploratory QA: maps, fog of war, the Atlas.

The map under test is a synthesized 2000x1500 PNG of four vertical bands —
red, green, blue, yellow — so a sampled pixel is unambiguous. Fog assertions
are made against the BYTES the server sent (fetched with page.request, decoded
in a canvas), never against the DOM.
*/

const BANDS_PNG = path.join(__dirname, "xq-maps-fog-map.png");
const HEAVY_PNG = path.join(__dirname, "xq-maps-fog-heavy.png");
const SHOTS = "exp-shots/maps-fog";

// Band centers as fractions of the map. y = 0.5 everywhere (vertical bands).
const RED = 0.125;
const GREEN = 0.375;
const BLUE = 0.625;
const YELLOW = 0.875;

type RGB = [number, number, number];
const isDark = ([r, g, b]: RGB) => r < 40 && g < 40 && b < 40;
const isRed = ([r, g, b]: RGB) => r > 150 && g < 90 && b < 90;
const isBlue = ([r, g, b]: RGB) => b > 150 && r < 90 && g < 90;
const isYellow = ([r, g, b]: RGB) => r > 150 && g > 150 && b < 90;

function rec(action: string, ms: number) {
  console.log(`TIMING ${action} ${ms}ms`);
}

function wireConsole(page: Page, who: string) {
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`CONSOLE-ERR [${who}] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`PAGE-ERR [${who}] ${e.message}`));
}

function pngDataUrl(file: string): string {
  return "data:image/png;base64," + fs.readFileSync(file).toString("base64");
}

/**
 * Decode exact server-sent image bytes in a canvas and sample pixels at
 * fractional points. This is the bytes-level check: what did this user receive?
 */
async function samplePoints(
  page: Page,
  bytes: Buffer,
  points: Array<[number, number]>,
): Promise<RGB[]> {
  const b64 = bytes.toString("base64");
  return page.evaluate(
    async ({ b64, points }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return points.map(([fx, fy]) => {
        const d = ctx.getImageData(
          Math.floor(fx * img.naturalWidth),
          Math.floor(fy * img.naturalHeight),
          1,
          1,
        ).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
    },
    { b64, points },
  );
}

/** Fetch the composited image as this page's user; returns bytes + elapsed ms. */
async function fetchImage(page: Page, mapId: string) {
  const t0 = Date.now();
  const res = await page.request.get(`/api/maps/${mapId}/image`);
  const body = await res.body();
  return { res, body, ms: Date.now() - t0 };
}

async function waitForMapImage(page: Page, name: string) {
  const img = page.locator(`img[alt="${name}"]`);
  await expect(img).toBeVisible({ timeout: 30_000 });
  await img.evaluate((el) => {
    const i = el as HTMLImageElement;
    return i.complete && i.naturalWidth > 0 ? Promise.resolve() : i.decode();
  });
  return img;
}

test("fog journey: hang through the UI, stamp for the party, hang a batch on a place", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  wireConsole(dmPage, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("xqdm"));
  const campaign = await createCampaign(dmPage.request, unique("FourBands "));
  const campaignId = campaign.id;
  // The place exists before the map page mounts so the submit modal's place
  // picker has something to offer. It starts veiled, as places do.
  const portoId = await createLocation(dmPage.request, campaignId, unique("Porto "));

  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  wireConsole(playerPage, "player");
  await playerPage.goto("/");
  await registerViaAPI(playerPage.request, newAccount("xqpl"));
  await joinCampaign(playerPage.request, campaign.inviteCode);

  // --- DM: the empty atlas, then hang the map through the UI ---------------
  let t0 = Date.now();
  await dmPage.goto(`/questboard/campaigns/${campaignId}/map`);
  await expect(dmPage.getByText("The world is still uncharted")).toBeVisible();
  rec("dm map page first load (no maps yet)", Date.now() - t0);
  await dmPage.screenshot({ path: `${SHOTS}/01-dm-empty-map.png`, fullPage: true });

  await dmPage.getByRole("button", { name: "Hang a map" }).click();
  await dmPage.getByPlaceholder("The Known World").fill("The Four Bands");
  await dmPage.locator('input[type="file"]').setInputFiles(BANDS_PNG);
  t0 = Date.now();
  await dmPage.getByRole("button", { name: "Hang it" }).click();
  await waitForMapImage(dmPage, "The Four Bands");
  rec("hang a 2000x1500 map through the UI (upload + first render)", Date.now() - t0);

  const mapId = dmPage.url().match(/\/map\/([0-9a-f-]{36})/)?.[1];
  expect(mapId, "hanging should navigate to the new map").toBeTruthy();
  await dmPage.screenshot({ path: `${SHOTS}/02-dm-map-hung.png`, fullPage: true });

  // --- DM: fog on, through the UI -------------------------------------------
  t0 = Date.now();
  await dmPage.getByRole("button", { name: "Fog: off" }).click();
  await expect(dmPage.getByRole("button", { name: "Fog: on" })).toBeVisible();
  rec("toggle fog on", Date.now() - t0);

  const canvas = dmPage.locator(`img[alt="The Four Bands"]`);
  const box = (await canvas.boundingBox())!;

  // --- batch 1: the red west, for the whole party ---------------------------
  await dmPage.getByRole("button", { name: /Lift the fog/ }).click();
  await expect(dmPage.getByText(/Tap to stamp a reveal/)).toBeVisible();
  await dmPage.mouse.click(box.x + box.width * RED, box.y + box.height * 0.5);
  await expect(dmPage.getByText(/1 stamped/)).toBeVisible();
  await dmPage.getByRole("button", { name: "Submit", exact: true }).click();
  await dmPage.getByPlaceholder("session 12 — the road east").fill("the red west");
  t0 = Date.now();
  await dmPage.getByRole("button", { name: "Reveal it" }).click();
  await expect(dmPage.getByRole("button", { name: /Lift the fog/ })).toBeVisible({
    timeout: 20_000,
  });
  rec("submit party reveal batch", Date.now() - t0);

  // --- batch 2: the blue band, hung on the veiled place ---------------------
  await dmPage.getByRole("button", { name: /Lift the fog/ }).click();
  await dmPage.mouse.click(box.x + box.width * BLUE, box.y + box.height * 0.5);
  await expect(dmPage.getByText(/1 stamped/)).toBeVisible();
  await dmPage.getByRole("button", { name: "Submit", exact: true }).click();
  await dmPage.getByPlaceholder("session 12 — the road east").fill("knowledge of Porto");
  await dmPage.locator("select").selectOption(portoId);
  await expect(
    dmPage.getByText(/will be revealed to whoever knows that place/),
  ).toBeVisible();
  t0 = Date.now();
  await dmPage.getByRole("button", { name: "Reveal it" }).click();
  await expect(dmPage.getByRole("button", { name: /Lift the fog/ })).toBeVisible({
    timeout: 20_000,
  });
  rec("submit place-hung reveal batch", Date.now() - t0);
  await dmPage.screenshot({ path: `${SHOTS}/03-dm-fog-stamped.png`, fullPage: true });

  // --- the player's bytes: party ground only, the place stays dark ----------
  const cold = await fetchImage(playerPage, mapId!);
  rec("player composite image, cold", cold.ms);
  expect(cold.res.ok()).toBeTruthy();
  const points: Array<[number, number]> = [
    [RED, 0.5],
    [GREEN, 0.5],
    [BLUE, 0.5],
    [YELLOW, 0.5],
  ];
  let px = await samplePoints(playerPage, cold.body, points);
  expect(isRed(px[0]), `party-revealed red band must arrive, got ${px[0]}`).toBe(true);
  expect(isDark(px[1]), `unstamped green band must be black, got ${px[1]}`).toBe(true);
  expect(
    isDark(px[2]),
    `place-hung blue band must stay black while the place is veiled, got ${px[2]}`,
  ).toBe(true);
  expect(isDark(px[3]), `unstamped yellow band must be black, got ${px[3]}`).toBe(true);

  const warm = await fetchImage(playerPage, mapId!);
  rec("player composite image, second fetch (fog cache)", warm.ms);

  const etag = cold.res.headers()["etag"];
  expect(etag, "the composite should carry an ETag").toBeTruthy();
  t0 = Date.now();
  const revalidated = await playerPage.request.get(`/api/maps/${mapId}/image`, {
    headers: { "If-None-Match": etag! },
  });
  rec("player composite revalidation (304 path)", Date.now() - t0);
  expect(revalidated.status(), "matching ETag should 304").toBe(304);

  // The JSON must agree with the pixels: one circle, not two.
  const asPlayer = await (await playerPage.request.get(`/api/maps/${mapId}`)).json();
  expect(
    asPlayer.revealed,
    "the place-hung circle must not leak into the player's JSON",
  ).toHaveLength(1);

  t0 = Date.now();
  await playerPage.goto(`/questboard/campaigns/${campaignId}/map`);
  await waitForMapImage(playerPage, "The Four Bands");
  rec("player map page load (fogged composite on screen)", Date.now() - t0);
  await playerPage.screenshot({ path: `${SHOTS}/04-player-fogged.png`, fullPage: true });

  // --- the party rides into Porto: the same stamps now serve everyone -------
  await revealLocation(dmPage.request, portoId);
  let after: RGB[] = [];
  await expect
    .poll(
      async () => {
        const got = await fetchImage(playerPage, mapId!);
        after = await samplePoints(playerPage, got.body, points);
        return isBlue(after[2]);
      },
      { timeout: 15_000, message: "revealing the place should lift its ground" },
    )
    .toBe(true);
  const reveal = await fetchImage(playerPage, mapId!);
  rec("player composite after place reveal (recomposite)", reveal.ms);
  expect(isRed(after[0]), "the party ground stays revealed").toBe(true);
  expect(isDark(after[1]), "green stays fogged").toBe(true);
  expect(isDark(after[3]), "yellow stays fogged").toBe(true);
  expect(
    (await (await playerPage.request.get(`/api/maps/${mapId}`)).json()).revealed,
  ).toHaveLength(2);

  await playerPage.reload();
  await waitForMapImage(playerPage, "The Four Bands");
  await playerPage.screenshot({
    path: `${SHOTS}/05-player-place-revealed.png`,
    fullPage: true,
  });

  // The DM's own image is never fogged.
  const dmImg = await fetchImage(dmPage, mapId!);
  const dmPx = await samplePoints(dmPage, dmImg.body, [[YELLOW, 0.5]]);
  expect(isYellow(dmPx[0]), "the DM receives the full image").toBe(true);

  await dmCtx.close();
  await playerCtx.close();
});

test("pins: DM-only stays with the DM, a shared pin opens the way down", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  wireConsole(dmPage, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("xqpindm"));
  const campaign = await createCampaign(dmPage.request, unique("Pinned "));
  const campaignId = campaign.id;

  const png = pngDataUrl(BANDS_PNG);
  const parentId = (
    await (
      await dmPage.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "The Coast", imageBase64: png },
      })
    ).json()
  ).id as string;
  const childId = (
    await (
      await dmPage.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "The Undercroft", imageBase64: png, parentMapId: parentId },
      })
    ).json()
  ).id as string;

  await dmPage.request.post(`/api/maps/${parentId}/pins`, {
    data: {
      label: "The Harbour Gate",
      x: 0.3,
      y: 0.35,
      dmOnly: false,
      linkMapId: childId,
    },
  });
  await dmPage.request.post(`/api/maps/${parentId}/pins`, {
    data: {
      label: "Goblin Ambush",
      x: 0.8,
      y: 0.7,
      dmOnly: true,
      note: "three goblins wait",
    },
  });

  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  wireConsole(playerPage, "player");
  await playerPage.goto("/");
  await registerViaAPI(playerPage.request, newAccount("xqpinpl"));
  await joinCampaign(playerPage.request, campaign.inviteCode);

  let t0 = Date.now();
  await playerPage.goto(`/questboard/campaigns/${campaignId}/map`);
  await waitForMapImage(playerPage, "The Coast");
  rec("player map page load (pins, fog off)", Date.now() - t0);

  // The shared pin is on screen; the DM-only one is nowhere in the DOM.
  await expect(playerPage.getByText("The Harbour Gate")).toBeVisible();
  await expect(playerPage.getByText("Goblin Ambush")).toHaveCount(0);
  const asPlayer = await (await playerPage.request.get(`/api/maps/${parentId}`)).json();
  expect((asPlayer.pins ?? []).map((p: { label: string }) => p.label)).toEqual([
    "The Harbour Gate",
  ]);
  expect(JSON.stringify(asPlayer)).not.toContain("goblins");

  // A region pin leads down.
  await playerPage.getByText("The Harbour Gate").first().click();
  await expect(
    playerPage.getByRole("button", { name: /Enter The Undercroft/ }),
  ).toBeVisible();
  await playerPage.screenshot({
    path: `${SHOTS}/06-player-pin-popover.png`,
    fullPage: true,
  });
  t0 = Date.now();
  await playerPage.getByRole("button", { name: /Enter The Undercroft/ }).click();
  await expect(playerPage).toHaveURL(new RegExp(childId));
  await waitForMapImage(playerPage, "The Undercroft");
  rec("pin popover → sub-map on screen", Date.now() - t0);
  await playerPage.screenshot({ path: `${SHOTS}/07-player-sub-map.png`, fullPage: true });

  // Fog snapping shut over the parent must swallow the shared pin too — a
  // hidden village cannot leak through its marker.
  await dmPage.request.patch(`/api/maps/${parentId}`, {
    data: { name: "The Coast", fogEnabled: true },
  });
  const foggedPins = await (await playerPage.request.get(`/api/maps/${parentId}`)).json();
  expect(
    foggedPins.pins,
    "under fog, a shared pin on unrevealed ground must be withheld",
  ).toHaveLength(0);

  // What the player's own atlas offers: every map, by name, fog or no fog.
  await playerPage.getByRole("button", { name: "Atlas" }).click();
  await expect(playerPage.getByText("The Atlas")).toBeVisible();
  await expect(playerPage.getByTitle("Unroll The Coast")).toBeVisible();
  await expect(playerPage.getByTitle("Unroll The Undercroft")).toBeVisible();
  await expect(playerPage.getByText("on the table")).toBeVisible();
  // No strike buttons for a player.
  await expect(playerPage.getByRole("button", { name: /Strike/ })).toHaveCount(0);
  await playerPage.screenshot({ path: `${SHOTS}/08-player-atlas.png`, fullPage: true });

  await dmCtx.close();
  await playerCtx.close();
});

test("the Atlas: rows, the table marker, and what a strike takes with it", async ({
  page,
}) => {
  wireConsole(page, "dm");
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("xqatlas"));
  const campaign = await createCampaign(page.request, unique("Atlasry "));
  const campaignId = campaign.id;

  const png = pngDataUrl(BANDS_PNG);
  const parentId = (
    await (
      await page.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "The Overworld", imageBase64: png },
      })
    ).json()
  ).id as string;
  const childId = (
    await (
      await page.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "The Crypt Below", imageBase64: png, parentMapId: parentId },
      })
    ).json()
  ).id as string;

  // Dress the child so the strike has something to take with it: fog, a
  // reveal batch, a pin of its own — and a pin on the parent pointing at it.
  await page.request.patch(`/api/maps/${childId}`, {
    data: { name: "The Crypt Below", parentMapId: parentId, fogEnabled: true },
  });
  await page.request.post(`/api/maps/${childId}/reveals`, {
    data: { note: "the antechamber", circles: [{ x: 0.2, y: 0.2, r: 0.1 }] },
  });
  await page.request.post(`/api/maps/${childId}/pins`, {
    data: { label: "The Altar", x: 0.5, y: 0.5, dmOnly: false },
  });
  await page.request.post(`/api/maps/${parentId}/pins`, {
    data: { label: "Down to the Crypt", x: 0.4, y: 0.6, dmOnly: false, linkMapId: childId },
  });

  await page.goto(`/questboard/campaigns/${campaignId}/map`);
  await waitForMapImage(page, "The Overworld");

  let t0 = Date.now();
  await page.getByRole("button", { name: "Atlas" }).click();
  await expect(page.getByText("The Atlas")).toBeVisible();
  rec("atlas modal open", Date.now() - t0);

  // Rows: the overworld carries the table marker, the child hangs indented
  // under it with its fog badge.
  const parentRow = page.getByTitle("Unroll The Overworld");
  const childRow = page.getByTitle("Unroll The Crypt Below");
  await expect(parentRow).toBeVisible();
  await expect(childRow).toBeVisible();
  await expect(
    parentRow.locator("xpath=following-sibling::span[contains(., 'on the table')]"),
  ).toBeVisible();
  await expect(
    childRow.locator(
      "xpath=following-sibling::span[@title[contains(., 'Fog is on')]]",
    ),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/09-atlas-rows.png`, fullPage: true });

  // Put the child on the table; the marker follows it.
  await childRow.click();
  await expect(page).toHaveURL(new RegExp(childId));
  await page.getByRole("button", { name: "Atlas" }).click();
  await expect(
    page
      .getByTitle("Unroll The Crypt Below")
      .locator("xpath=following-sibling::span[contains(., 'on the table')]"),
  ).toBeVisible();

  // Strike the child from its own row, second look and all.
  await page.getByRole("button", { name: "Strike The Crypt Below" }).click();
  await expect(page.getByText(/Its pins and its fog go with it/)).toBeVisible();
  t0 = Date.now();
  await page.getByRole("button", { name: "Strike it", exact: true }).click();
  await expect(page.getByTitle("Unroll The Crypt Below")).toHaveCount(0);
  rec("strike a map from its atlas row", Date.now() - t0);

  // The struck map was on the table, so the viewer is sent home.
  await expect(page).not.toHaveURL(new RegExp(childId));

  // The strike is clean server-side: map, image, reveals and pins all gone.
  expect((await page.request.get(`/api/maps/${childId}`)).status()).toBe(404);
  expect((await page.request.get(`/api/maps/${childId}/image`)).status()).toBe(404);
  expect((await page.request.get(`/api/maps/${childId}/reveals`)).status()).toBe(404);

  // The parent's region pin survives but no longer leads anywhere.
  const parentDetail = await (await page.request.get(`/api/maps/${parentId}`)).json();
  const regionPin = (parentDetail.pins as Array<{ label: string; linkMapId?: string }>).find(
    (p) => p.label === "Down to the Crypt",
  );
  expect(regionPin, "the parent's pin survives the strike").toBeTruthy();
  expect(regionPin!.linkMapId ?? null, "…but its link is cut").toBeNull();

  // And the UI agrees: the popover offers no Enter button now.
  // (Two Close buttons live in the modal — the corner X and the footer.)
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.getByText("Down to the Crypt").first().click();
  await expect(page.getByRole("heading", { name: "Down to the Crypt" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Enter/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).last().click();

  // Striking a parent orphans its children upward rather than killing them.
  const orphanId = (
    await (
      await page.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "The Warrens", imageBase64: png, parentMapId: parentId },
      })
    ).json()
  ).id as string;
  await page.reload();
  await waitForMapImage(page, "The Overworld");
  await page.getByRole("button", { name: "Atlas" }).click();
  await page.getByRole("button", { name: "Strike The Overworld" }).click();
  await page.getByRole("button", { name: "Strike it", exact: true }).click();
  await expect(page.getByTitle("Unroll The Overworld")).toHaveCount(0);

  const survivors = (await (
    await page.request.get(`/api/campaigns/${campaignId}/maps`)
  ).json()) as Array<{ id: string; name: string; parentMapId?: string | null }>;
  expect(survivors.map((m) => m.name)).toEqual(["The Warrens"]);
  expect(
    survivors[0].parentMapId ?? null,
    "the orphan is promoted to overworld, not deleted",
  ).toBeNull();
  expect(survivors[0].id).toBe(orphanId);

  // The viewer landed on the orphan without a crash.
  await waitForMapImage(page, "The Warrens");
  await page.screenshot({ path: `${SHOTS}/10-after-strikes.png`, fullPage: true });
});

test("a heavyweight map: upload and composite cost", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  wireConsole(dmPage, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("xqheavy"));
  const campaign = await createCampaign(dmPage.request, unique("Heavy "));
  const campaignId = campaign.id;

  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  wireConsole(playerPage, "player");
  await playerPage.goto("/");
  await registerViaAPI(playerPage.request, newAccount("xqheavypl"));
  await joinCampaign(playerPage.request, campaign.inviteCode);

  await dmPage.goto(`/questboard/campaigns/${campaignId}/map`);
  await dmPage.getByRole("button", { name: "Hang a map" }).click();
  await dmPage.getByPlaceholder("The Known World").fill("The Painted Wastes");
  await dmPage.locator('input[type="file"]').setInputFiles(HEAVY_PNG);
  let t0 = Date.now();
  await dmPage.getByRole("button", { name: "Hang it" }).click();
  await waitForMapImage(dmPage, "The Painted Wastes");
  rec("hang a 2.6MB 2000x1500 map through the UI (upload + first render)", Date.now() - t0);
  const mapId = dmPage.url().match(/\/map\/([0-9a-f-]{36})/)?.[1];
  expect(mapId).toBeTruthy();
  await dmPage.screenshot({ path: `${SHOTS}/11-heavy-map-dm.png`, fullPage: true });

  await dmPage.request.patch(`/api/maps/${mapId}`, {
    data: { name: "The Painted Wastes", fogEnabled: true },
  });
  // One circle in the noisy upper third, so the composite has real work to do.
  await dmPage.request.post(`/api/maps/${mapId}/reveals`, {
    data: { note: "first light", circles: [{ x: 0.5, y: 0.16, r: 0.1 }] },
  });

  const cold = await fetchImage(playerPage, mapId!);
  rec("player composite of the heavy map, cold (first composite)", cold.ms);
  expect(cold.res.ok()).toBeTruthy();
  const px = await samplePoints(playerPage, cold.body, [
    [0.5, 0.16],
    [0.9, 0.9],
  ]);
  expect(isDark(px[0]), "revealed noisy ground should not be black").toBe(false);
  expect(isDark(px[1]), "unrevealed ground stays black").toBe(true);

  const warm = await fetchImage(playerPage, mapId!);
  rec("player composite of the heavy map, second fetch (fog cache)", warm.ms);

  t0 = Date.now();
  await playerPage.goto(`/questboard/campaigns/${campaignId}/map`);
  await waitForMapImage(playerPage, "The Painted Wastes");
  rec("player map page load (heavy fogged composite)", Date.now() - t0);
  await playerPage.screenshot({ path: `${SHOTS}/12-heavy-map-player.png`, fullPage: true });

  await dmCtx.close();
  await playerCtx.close();
});

/*
Edges: a player's hands are tied, a foreign place is refused, and a torn-up
batch goes dark again — including for a client holding yesterday's ETag.
*/
test("edges: player authz, cross-campaign place, and un-revealing", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  wireConsole(dmPage, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("xqedge"));
  const campA = await createCampaign(dmPage.request, unique("EdgeA "));
  const campB = await createCampaign(dmPage.request, unique("EdgeB "));
  const foreignPlace = await createLocation(dmPage.request, campB.id, unique("Elsewhere "));

  const png = pngDataUrl(BANDS_PNG);
  const mapId = (
    await (
      await dmPage.request.post(`/api/campaigns/${campA.id}/maps`, {
        data: { name: "Edgelands", imageBase64: png },
      })
    ).json()
  ).id as string;
  await dmPage.request.patch(`/api/maps/${mapId}`, {
    data: { name: "Edgelands", fogEnabled: true },
  });
  const batchRes = await dmPage.request.post(`/api/maps/${mapId}/reveals`, {
    data: { note: "the red west", circles: [{ x: RED, y: 0.5, r: 0.12 }] },
  });
  expect(batchRes.ok()).toBeTruthy();
  const batchId = (await batchRes.json()).id as string;

  // A batch naming a place from ANOTHER campaign must be refused.
  const foreign = await dmPage.request.post(`/api/maps/${mapId}/reveals`, {
    data: { note: "smuggled", locationId: foreignPlace, circles: [{ x: 0.9, y: 0.5, r: 0.1 }] },
  });
  expect(foreign.status(), await foreign.text()).toBe(400);

  // The player: at the table, but their hands stay off the DM's controls.
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  wireConsole(plPage, "player");
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("xqedgepl"));
  await joinCampaign(plPage.request, campA.inviteCode);

  const probes: Array<[string, Promise<{ status(): number }>]> = [
    ["PATCH map (drop the fog)", plPage.request.patch(`/api/maps/${mapId}`, {
      data: { name: "Edgelands", fogEnabled: false } })],
    ["POST pin", plPage.request.post(`/api/maps/${mapId}/pins`, {
      data: { label: "graffiti", x: 0.5, y: 0.5, dmOnly: false } })],
    ["POST reveals", plPage.request.post(`/api/maps/${mapId}/reveals`, {
      data: { circles: [{ x: 0.9, y: 0.5, r: 0.5 }] } })],
    ["GET reveal ledger", plPage.request.get(`/api/maps/${mapId}/reveals`)],
    ["DELETE batch", plPage.request.delete(`/api/reveals/${batchId}`)],
    ["DELETE map", plPage.request.delete(`/api/maps/${mapId}`)],
  ];
  for (const [what, p] of probes) {
    const res = await p;
    expect(res.status(), `a mere player must not ${what}`).toBe(403);
  }

  // The revealed red band arrives...
  const before = await fetchImage(plPage, mapId);
  const px0 = await samplePoints(plPage, before.body, [[RED, 0.5]]);
  expect(isRed(px0[0]), `red should be revealed first, got ${px0[0]}`).toBe(true);
  const oldEtag = before.res.headers()["etag"];

  // ...until the DM tears the batch up: the ground fogs over again, and the
  // stale ETag must not let a cached client keep the pixels.
  const torn = await dmPage.request.delete(`/api/reveals/${batchId}`);
  expect(torn.status()).toBe(204);
  let after: RGB[] = [];
  await expect
    .poll(async () => {
      const got = await fetchImage(plPage, mapId);
      after = await samplePoints(plPage, got.body, [[RED, 0.5]]);
      return isDark(after[0]);
    }, { timeout: 15_000, message: "a deleted batch must fog its ground again" })
    .toBe(true);
  if (oldEtag) {
    const stale = await plPage.request.get(`/api/maps/${mapId}/image`, {
      headers: { "If-None-Match": oldEtag },
    });
    expect(stale.status(), "yesterday's ETag must not 304 after an un-reveal").not.toBe(304);
  }

  await dmCtx.close();
  await plCtx.close();
});
