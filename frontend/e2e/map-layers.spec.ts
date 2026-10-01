import { test, expect, type Page } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Named map layers (#355, stage two).

A layer is a named group of pins and shapes the DM files ink into. The server
owns exactly one gate about it — a DM-only layer, and everything filed in it,
is absent from a player's payload — and that is what the first test pins at
the API. The rest is view state and authoring: a layer that "starts hidden"
is a suggestion a player may overrule in their Legend, the DM keeps the stack
in the Inkwork, and striking a layer drops its ink to the base map rather than
losing it. The second test drives those through a real browser, because the
Legend sits over a map whose viewer captures presses (#277).
*/

async function flatPng(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#3b2a18";
    ctx.fillRect(0, 0, 400, 200);
    return c.toDataURL("image/png");
  });
}

async function hangMap(page: Page, campaignId: string, name = unique("Chart ")): Promise<string> {
  const res = await page.request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name, imageBase64: await flatPng(page), visibleToParty: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

type Detail = {
  layers: { id: string; name: string; position: number; shownByDefault: boolean; dmOnly: boolean }[];
  pins: { id: string; label: string; layerId?: string | null }[];
  shapes: { id: string; label: string; layerId?: string | null }[];
};

test("a DM-only layer keeps everything filed in it from the table, and striking one loses no ink", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmlayer"));
  const campaign = await createCampaign(page.request, unique("Layers "));
  const mapId = await hangMap(page, campaign.id);
  const q = `?campaignId=${campaign.id}`;

  const layer = async (name: string, extra: Record<string, boolean> = {}) => {
    const res = await page.request.post(`/api/maps/${mapId}/layers${q}`, { data: { name, ...extra } });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  };
  const routes = await layer("Trade routes");
  const secrets = await layer("The old empire", { dmOnly: true });
  // A new layer goes on top, and starts shown unless told otherwise.
  expect(secrets.position).toBeGreaterThan(routes.position);
  expect(routes.shownByDefault).toBe(true);

  const pin = (label: string, layerId?: string) =>
    page.request.post(`/api/maps/${mapId}/pins${q}`, {
      data: { label, note: "", x: 0.5, y: 0.5, dmOnly: false, ...(layerId ? { layerId } : {}) },
    });
  expect((await pin("Vallaki", routes.id)).status()).toBe(201);
  expect((await pin("Argynvostholt", secrets.id)).status()).toBe(201);
  expect((await pin("Barovia")).status()).toBe(201);
  const shape = await page.request.post(`/api/maps/${mapId}/shapes${q}`, {
    data: {
      kind: "line",
      label: "The imperial road",
      points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }],
      layerId: secrets.id,
    },
  });
  expect(shape.status(), await shape.text()).toBe(201);
  expect((await shape.json()).layerId).toBe(secrets.id);

  // A pin cannot be filed in another map's layer — that map's Legend would switch it.
  const other = await hangMap(page, campaign.id);
  const stray = await page.request.post(`/api/maps/${other}/pins${q}`, {
    data: { label: "Stray", note: "", x: 0.5, y: 0.5, dmOnly: false, layerId: routes.id },
  });
  expect(stray.status()).toBe(400);
  expect(await stray.text()).toContain("not one of this map's");

  const ctx = await browser.newContext();
  const player = await ctx.newPage();
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("playerlayer"));
  await joinCampaign(player.request, campaign.inviteCode);
  const read = async (p: Page): Promise<Detail> => {
    const res = await p.request.get(`/api/maps/${mapId}${q}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    return res.json();
  };

  // The DM reads the whole stack.
  const dm = await read(page);
  expect(dm.layers.map((l) => l.name)).toEqual(["Trade routes", "The old empire"]);
  expect(dm.pins).toHaveLength(3);
  expect(dm.shapes).toHaveLength(1);

  // The player receives neither the DM-only layer nor anything filed in it —
  // not the pin, not the road — while the rest arrives as ever.
  let seen = await read(player);
  expect(seen.layers.map((l) => l.name)).toEqual(["Trade routes"]);
  expect(seen.pins.map((p) => p.label).sort()).toEqual(["Barovia", "Vallaki"]);
  expect(seen.shapes).toHaveLength(0);
  expect(JSON.stringify(seen)).not.toContain(secrets.id);

  // Opened to the table, it arrives whole.
  const opened = await page.request.patch(`/api/layers/${secrets.id}${q}`, {
    data: { name: "The old empire", dmOnly: false, shownByDefault: false },
  });
  expect(opened.status(), await opened.text()).toBe(200);
  seen = await read(player);
  expect(seen.layers.map((l) => l.name)).toEqual(["Trade routes", "The old empire"]);
  expect(seen.layers[1].shownByDefault).toBe(false);
  expect(seen.pins).toHaveLength(3);
  expect(seen.shapes).toHaveLength(1);

  // A player cannot author layers.
  const refused = await player.request.post(`/api/maps/${mapId}/layers${q}`, { data: { name: "Mine" } });
  expect(refused.status()).toBe(403);

  // An order names every layer once; anything else is refused whole.
  const partial = await page.request.put(`/api/maps/${mapId}/layers${q}`, { data: { layerIds: [routes.id] } });
  expect(partial.status()).toBe(400);
  const flipped = await page.request.put(`/api/maps/${mapId}/layers${q}`, {
    data: { layerIds: [secrets.id, routes.id] },
  });
  expect(flipped.status(), await flipped.text()).toBe(200);
  expect(((await flipped.json()) as Detail["layers"]).map((l) => l.name)).toEqual([
    "The old empire",
    "Trade routes",
  ]);

  // Striking a layer is a folder going, not the ink: Vallaki stays, on the base.
  expect((await page.request.delete(`/api/layers/${routes.id}${q}`)).status()).toBe(204);
  const after = await read(page);
  expect(after.layers.map((l) => l.name)).toEqual(["The old empire"]);
  const vallaki = after.pins.find((p) => p.label === "Vallaki")!;
  expect(vallaki).toBeTruthy();
  expect(vallaki.layerId ?? null).toBeNull();
  await ctx.close();
});

test("the DM keeps the stack in the Inkwork; a layer that starts hidden is the player's to open", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dminkwork"));
  const campaign = await createCampaign(page.request, unique("Stack "));
  const mapId = await hangMap(page, campaign.id);
  const q = `?campaignId=${campaign.id}`;
  const url = `/questboard/campaigns/${campaign.id}/map/${mapId}`;

  // Two layers made through the Inkwork itself.
  await page.goto(url);
  await page.getByRole("button", { name: "Draw" }).click();
  const list = page.getByTestId("layer-list");
  for (const name of ["Trade routes", "Kingdom borders"]) {
    await list.getByLabel("New layer").fill(name);
    await list.getByRole("button", { name: "A layer" }).click();
    await expect(list.locator(`[data-layer-row="${name}"]`)).toBeVisible();
  }
  // Read top down: the newest is on top.
  await expect(list.locator("[data-layer-row]")).toHaveText([/Kingdom borders/, /Trade routes/]);
  // Lower the borders beneath the routes.
  await list.getByRole("button", { name: "Lower Kingdom borders" }).click();
  await expect(list.locator("[data-layer-row]")).toHaveText([/Trade routes/, /Kingdom borders/]);
  // The routes start hidden: a suggestion, not a secret.
  const routesRow = list.locator('[data-layer-row="Trade routes"]');
  await routesRow.getByRole("button", { name: "Starts shown" }).click();
  await expect(routesRow.getByRole("button", { name: "Starts hidden" })).toBeVisible();

  const detail = (await (await page.request.get(`/api/maps/${mapId}${q}`)).json()) as Detail;
  const routes = detail.layers.find((l) => l.name === "Trade routes")!;
  expect(routes.shownByDefault).toBe(false);
  // A pin filed in the routes, through the real pin form's layer picker.
  await page.locator("button", { hasText: /^Close$/ }).click();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  const box = (await page.getByTestId("map-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.getByPlaceholder("The Sleeping Giant Inn").fill("Vallaki");
  await page.locator('select[name="layer"]').selectOption({ label: "Trade routes" });
  await page.getByRole("button", { name: "Pin it" }).click();
  // Filed in a layer that starts hidden, it still shows for the DM who made it.
  await expect(page.locator("[data-pin-id]", { hasText: "Vallaki" })).toBeVisible({ timeout: 20_000 });
  const pins = ((await (await page.request.get(`/api/maps/${mapId}${q}`)).json()) as Detail).pins;
  expect(pins[0].layerId).toBe(routes.id);

  // A player first sees the map without the routes, and may open them.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const player = await ctx.newPage();
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("pstack"));
  await joinCampaign(player.request, campaign.inviteCode);
  await player.goto(url);
  await expect(player.getByRole("button", { name: /Legend/ })).toBeVisible({ timeout: 20_000 });
  await expect(player.locator("[data-pin-id]")).toHaveCount(0);
  await player.getByRole("button", { name: /Legend/ }).click();
  const legend = player.getByTestId("map-legend");
  await expect(legend.locator('input[name="legend-layer:' + routes.id + '"]')).not.toBeChecked();
  await legend.getByText("Trade routes", { exact: true }).click();
  await expect(player.locator("[data-pin-id]", { hasText: "Vallaki" })).toBeVisible();

  // Striking the routes says what moves, and moves it to the base map.
  await page.getByRole("button", { name: "Draw" }).click();
  await list.getByRole("button", { name: "Strike Trade routes" }).click();
  await expect(list).toContainText("1 pin drops to the base map.");
  await list.getByRole("button", { name: "Strike it" }).click();
  await expect(list.locator("[data-layer-row]")).toHaveCount(1);
  const left = ((await (await page.request.get(`/api/maps/${mapId}${q}`)).json()) as Detail).pins;
  expect(left).toHaveLength(1);
  expect(left[0].layerId ?? null).toBeNull();
  await ctx.close();
});
