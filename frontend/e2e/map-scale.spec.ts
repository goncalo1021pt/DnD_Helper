import { expect, test, type Page } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
A scale, and distances that mean something (#357).

A map stores what its width spans; a road's length and a measure are worked
out from that on the client. What is worth pinning: the DM sets and clears the
scale, a player reads a DM's road — which they could not press at all before —
and the measure tool sets the scale from a run the DM knows the length of.
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

async function hangMap(page: Page, campaignId: string): Promise<string> {
  const res = await page.request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name: unique("Chart "), imageBase64: await flatPng(page), visibleToParty: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

async function scaleOf(page: Page, mapId: string, campaignId: string) {
  const res = await page.request.get(`/api/maps/${mapId}?campaignId=${campaignId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).map.scale as { distance: number; unit: string } | undefined;
}

test("a scale makes a road say how long it is, to anybody who can see it", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("scaledm"));
  const campaign = await createCampaign(dm.request, unique("Surveyors "));
  const mapId = await hangMap(dm, campaign.id);

  // Half the width, straight across.
  const road = await dm.request.post(`/api/maps/${mapId}/shapes?campaignId=${campaign.id}`, {
    data: { kind: "line", label: "The Old Svalich Road", points: [{ x: 0.1, y: 0.5 }, { x: 0.6, y: 0.5 }] },
  });
  expect(road.status()).toBe(201);

  // An unmeasured map says no distance at all.
  expect(await scaleOf(dm, mapId, campaign.id)).toBeUndefined();

  // The width is 120 miles across, so the road is 60.
  const set = await dm.request.patch(`/api/maps/${mapId}?campaignId=${campaign.id}`, {
    data: { name: "Chart", scaleDistance: 120, scaleUnit: "miles" },
  });
  expect(set.ok(), await set.text()).toBeTruthy();
  expect(await scaleOf(dm, mapId, campaign.id)).toEqual({ distance: 120, unit: "miles" });

  // A rename says nothing about the scale, and keeps it.
  await dm.request.patch(`/api/maps/${mapId}?campaignId=${campaign.id}`, { data: { name: "Chart of Barovia" } });
  expect(await scaleOf(dm, mapId, campaign.id)).toEqual({ distance: 120, unit: "miles" });
  const negative = await dm.request.patch(`/api/maps/${mapId}?campaignId=${campaign.id}`, {
    data: { name: "Chart of Barovia", scaleDistance: -5 },
  });
  expect(negative.status()).toBe(400);

  // A player reads it — and only the DM changes it.
  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("scalepl"));
  await joinCampaign(pl.request, campaign.inviteCode!);
  expect(await scaleOf(pl, mapId, campaign.id)).toEqual({ distance: 120, unit: "miles" });
  const refused = await pl.request.patch(`/api/maps/${mapId}?campaignId=${campaign.id}`, {
    data: { name: "Mine now", scaleDistance: 1 },
  });
  expect(refused.status()).toBe(403);

  await pl.goto(`/questboard/campaigns/${campaign.id}/map/${mapId}`);
  await expect(pl.getByRole("button", { name: "Measure" })).toBeVisible({ timeout: 20_000 });
  await pl.waitForTimeout(1000);
  const box = await pl.evaluate(() => {
    const g = document.querySelector("g[data-shape-id]")!;
    const r = g.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await pl.mouse.click(box.x, box.y);
  const card = pl.getByTestId("road-card");
  await expect(card).toContainText("The Old Svalich Road");
  await expect(card.getByTestId("road-length")).toHaveText("60 mi");
  // 60 miles: 2 days fast, 2½ normal, 3½ slow.
  await expect(card).toContainText("2½ days");
  await expect(card).toContainText("3½ days");
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);

  // 0 takes the scale off.
  await dm.request.patch(`/api/maps/${mapId}?campaignId=${campaign.id}`, {
    data: { name: "Chart of Barovia", scaleDistance: 0 },
  });
  expect(await scaleOf(dm, mapId, campaign.id)).toBeUndefined();

  await dmCtx.close();
  await plCtx.close();
});

test("the DM sets a map's scale by measuring a run they know", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("scaleui"));
  const campaign = await createCampaign(page.request, unique("Ruler "));
  const mapId = await hangMap(page, campaign.id);

  await page.goto(`/questboard/campaigns/${campaign.id}/map/${mapId}`);
  await page.getByRole("button", { name: "Measure" }).click({ timeout: 20_000 });
  const bar = page.getByTestId("measure-bar");
  await expect(bar).toContainText("this map has no scale yet");

  const canvas = page.getByTestId("map-canvas");
  const c = (await canvas.boundingBox())!;
  await page.mouse.click(c.x + c.width * 0.2, c.y + c.height * 0.5);
  await page.mouse.click(c.x + c.width * 0.7, c.y + c.height * 0.5);
  await expect(bar.getByTestId("measure-reading")).toHaveText("No scale yet");

  await bar.getByRole("button", { name: "Set scale" }).click();
  await bar.getByLabel("Measured distance").fill("40");
  await bar.getByRole("button", { name: "Use as scale" }).click();

  // Half the width was 40 miles, so the whole width is 80.
  await expect.poll(async () => (await scaleOf(page, mapId, campaign.id))?.distance).toBeCloseTo(80, 0);
  await expect(bar.getByTestId("measure-reading")).toHaveText("40 mi · about 2 days");
});
