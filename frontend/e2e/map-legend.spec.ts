import { test, expect, type Page } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
The Legend (#355, stage one).

Everything drawn on a map used to be drawn at once, and a player had no way to
put anything down to read the rest. The Legend switches the four kinds of ink
every map has — pins, roads, regions, names — per viewer, per map, remembered
in the browser.

It is view state, not a veil: the payload a player receives is the same
whatever they tick. What is worth pinning is that the switches answer a real
press (the Legend sits over the map, whose viewer captures presses for
panning — the lesson of #277), that a choice survives a reload, and that
"Clean map" clears the chart and brings it back.
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

/** A map in the hall with one of each kind of ink on it. */
async function inkedMap(page: Page, campaignId: string): Promise<string> {
  const res = await page.request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name: unique("Chart "), imageBase64: await flatPng(page), visibleToParty: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const mapId = (await res.json()).id as string;
  const pin = await page.request.post(`/api/maps/${mapId}/pins?campaignId=${campaignId}`, {
    data: { label: "Vallaki", note: "", x: 0.3, y: 0.3, dmOnly: false },
  });
  expect(pin.ok(), await pin.text()).toBeTruthy();
  for (const data of [
    {
      kind: "line",
      label: "The Old Svalich Road",
      points: [{ x: 0.1, y: 0.8 }, { x: 0.9, y: 0.8 }],
      color: "#c96a5a",
    },
    {
      kind: "area",
      label: "Barovia",
      points: [{ x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.5 }],
      color: "#7d9b6a",
    },
  ]) {
    const shape = await page.request.post(`/api/maps/${mapId}/shapes?campaignId=${campaignId}`, { data });
    expect(shape.ok(), await shape.text()).toBeTruthy();
  }
  return mapId;
}

test("a player switches the ink off, the choice survives a reload, and a clean map comes back", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmlegend"));
  const campaign = await createCampaign(page.request, unique("Legend "));
  const mapId = await inkedMap(page, campaign.id);

  const ctx = await browser.newContext();
  const player = await ctx.newPage();
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("plegend"));
  await joinCampaign(player.request, campaign.inviteCode);

  const url = `/questboard/campaigns/${campaign.id}/map/${mapId}`;
  await player.goto(url);
  const pins = player.locator("[data-pin-id]");
  const roads = player.locator("text[data-road-name]");
  const shapes = player.locator("[data-shape-id]");
  await expect(pins).toHaveCount(1, { timeout: 20_000 });
  await expect(shapes).toHaveCount(2);

  // The Legend opens from the map itself — a player has no toolbar to find it in.
  await player.getByRole("button", { name: /Legend/ }).click();
  const legend = player.getByTestId("map-legend");
  await expect(legend).toBeVisible();
  // Each row says how much it switches.
  await expect(legend.locator("label", { hasText: "Pins" })).toContainText("1");
  await expect(legend.locator("label", { hasText: "Roads" })).toContainText("1");
  await expect(legend.locator("label", { hasText: "Regions" })).toContainText("1");

  // A real press on the row's label, which the viewer would capture for a pan
  // if the Legend were not marked as its own.
  await legend.getByText("Roads", { exact: true }).click();
  await expect(legend.locator('input[name="legend-roads"]')).not.toBeChecked();
  await expect(roads).toHaveCount(0);
  await expect(shapes).toHaveCount(1);

  // Names off keeps the marker and drops its label, and letters no region.
  await legend.getByText("Names", { exact: true }).click();
  await expect(pins).toHaveCount(1);
  await expect(pins.first()).not.toContainText("Vallaki");
  await expect(player.locator("svg text", { hasText: "Barovia" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: /Legend/ })).toContainText("2 off");

  // The payload is untouched: this was never a veil.
  const detail = await (await player.request.get(`/api/maps/${mapId}?campaignId=${campaign.id}`)).json();
  expect(detail.shapes).toHaveLength(2);
  expect(detail.pins).toHaveLength(1);

  // Remembered in this browser, for this map.
  await player.reload();
  await expect(pins).toHaveCount(1, { timeout: 20_000 });
  await expect(roads).toHaveCount(0);
  await expect(shapes).toHaveCount(1);
  await expect(pins.first()).not.toContainText("Vallaki");

  // Clean map: nothing drawn but the ground. The same button brings it all back.
  await player.getByRole("button", { name: /Legend/ }).click();
  await player.getByRole("button", { name: "Clean map" }).click();
  await expect(pins).toHaveCount(0);
  await expect(shapes).toHaveCount(0);
  await player.getByRole("button", { name: "Show all" }).click();
  await expect(pins).toHaveCount(1);
  await expect(shapes).toHaveCount(2);
  await expect(roads).toHaveCount(1);
  await expect(pins.first()).toContainText("Vallaki");

  // Another viewer's choices are their own: the DM still sees everything.
  await page.goto(url);
  await expect(page.locator("[data-pin-id]")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator("[data-shape-id]")).toHaveCount(2);
  await ctx.close();
});

test("a pin dropped while pins are switched off is shown, not lost", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmhidden"));
  const campaign = await createCampaign(page.request, unique("Hidden "));
  const mapId = await inkedMap(page, campaign.id);

  await page.goto(`/questboard/campaigns/${campaign.id}/map/${mapId}`);
  await expect(page.locator("[data-pin-id]")).toHaveCount(1, { timeout: 20_000 });
  await page.getByRole("button", { name: /Legend/ }).click();
  await page.getByTestId("map-legend").getByText("Pins", { exact: true }).click();
  await expect(page.locator("[data-pin-id]")).toHaveCount(0);

  await page.getByRole("button", { name: "Drop a pin" }).click();
  const canvas = page.getByTestId("map-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.getByPlaceholder("The Sleeping Giant Inn").fill("Krezk");
  await page.getByRole("button", { name: "Pin it" }).click();

  // Saving it switched pins back on, rather than filing it somewhere unseen.
  await expect(page.locator("[data-pin-id]")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator("[data-pin-id]", { hasText: "Krezk" })).toBeVisible();
  await expect(page.getByTestId("map-legend").locator('input[name="legend-pins"]')).toBeChecked();
});
