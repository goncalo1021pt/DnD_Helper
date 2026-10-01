import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
A player's own marks on a map (#356).

A player who worked out where the cave was had nowhere on the map to say so.
Now they mark it: a pin with a note, or a line for the route they took. The
veil is the whole of the feature, so the first test pins it at the API:

  - a mark reaches its author and the table's DMs, and the rest of the table
    only when shared — and then under the fog, as the DM's ink is;
  - it is the author's to change: another player cannot, and the DM may pull
    it but not reword it;
  - it is knowledge, not ground: a sibling campaign on the same realm never
    receives it, and its DM cannot pull it;
  - it leaves with the seat.

The second drives the real tools, because a player never held a tool on the
map before and the viewer captures presses (#277).
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

type Mark = { id: string; label: string; authorUserId?: string | null; authorName?: string | null; shared?: boolean };
type Detail = { pins: Mark[]; shapes: Mark[] };

async function seat(browserPage: Page, prefix: string, invite: string): Promise<APIRequestContext> {
  await browserPage.goto("/");
  await registerViaAPI(browserPage.request, newAccount(prefix));
  await joinCampaign(browserPage.request, invite);
  return browserPage.request;
}

test("a mark reaches its author and the DMs, the table only when shared, and never a sibling table", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const dmAccount = newAccount("dmmarks");
  await registerViaAPI(page.request, dmAccount);
  const campaign = await createCampaign(page.request, unique("Marks "));
  const mapRes = await page.request.post(`/api/campaigns/${campaign.id}/maps`, {
    data: { name: unique("Chart "), imageBase64: await flatPng(page), visibleToParty: true },
  });
  const mapId = (await mapRes.json()).id as string;
  const q = `?campaignId=${campaign.id}`;
  const dm = page.request;

  const ctxA = await browser.newContext();
  const a = await seat(await ctxA.newPage(), "marka", campaign.inviteCode);
  const ctxB = await browser.newContext();
  const b = await seat(await ctxB.newPage(), "markb", campaign.inviteCode);

  const pin = async (who: APIRequestContext, label: string, shared: boolean, x = 0.5) => {
    const res = await who.post(`/api/maps/${mapId}/marks/pins${q}`, { data: { label, x, y: 0.5, shared } });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()) as Mark;
  };
  const cave = await pin(a, "The cave, I think", false);
  const camp = await pin(a, "Where we camped", true);
  const route = await a.post(`/api/maps/${mapId}/marks/lines${q}`, {
    data: { label: "The way we came", points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] },
  });
  expect(route.status(), await route.text()).toBe(201);
  expect(cave.authorName).toBeTruthy();

  const read = async (who: APIRequestContext): Promise<Detail> => {
    const res = await who.get(`/api/maps/${mapId}${q}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    return res.json();
  };
  // The author reads all three; the DM reads all three.
  expect((await read(a)).pins.map((p) => p.label).sort()).toEqual(["The cave, I think", "Where we camped"]);
  expect((await read(a)).shapes).toHaveLength(1);
  expect((await read(dm)).pins).toHaveLength(2);
  expect((await read(dm)).shapes).toHaveLength(1);
  // Another player reads only what was shared, under its author's name.
  const seenByB = await read(b);
  expect(seenByB.pins.map((p) => p.label)).toEqual(["Where we camped"]);
  expect(seenByB.pins[0].authorName).toBe(cave.authorName);
  expect(seenByB.shapes).toHaveLength(0);

  // It is the author's to change. Another player gets a 404; the DM may not reword it.
  const byB = await b.patch(`/api/marks/pins/${cave.id}${q}`, { data: { label: "Mine now", x: 0.5, y: 0.5 } });
  expect(byB.status()).toBe(404);
  const byDM = await dm.patch(`/api/pins/${cave.id}${q}`, { data: { label: "Reworded", x: 0.5, y: 0.5 } });
  expect(byDM.status()).toBe(400);
  expect(await byDM.text()).toContain("theirs to change");
  // Sharing it later puts it in front of the table.
  const shared = await a.patch(`/api/marks/pins/${cave.id}${q}`, {
    data: { label: "The cave — certain now", x: 0.5, y: 0.5, shared: true },
  });
  expect(shared.status(), await shared.text()).toBe(200);
  expect((await read(b)).pins).toHaveLength(2);

  // Under fog a shared mark reaches the others only on uncovered ground; the
  // author still reads their own wherever it stands.
  const fog = await dm.patch(`/api/maps/${mapId}${q}`, { data: { name: "Chart", fogEnabled: true } });
  expect(fog.ok(), await fog.text()).toBeTruthy();
  expect((await read(b)).pins).toHaveLength(0);
  expect((await read(a)).pins).toHaveLength(2);
  const lift = await dm.post(`/api/maps/${mapId}/reveals${q}`, { data: { circles: [{ x: 0.5, y: 0.5, r: 0.1 }] } });
  expect(lift.ok(), await lift.text()).toBeTruthy();
  expect((await read(b)).pins).toHaveLength(2);

  // Knowledge, not ground: a sibling campaign on the same realm walks the same
  // map and sees none of this table's marks — nor may its DM pull one.
  const sibling = await dm.post("/api/campaigns", { data: { name: unique("Sibling "), realmId: campaign.realmId } });
  expect(sibling.status(), await sibling.text()).toBe(201);
  const sq = `?campaignId=${(await sibling.json()).id}`;
  const throughSibling = (await (await dm.get(`/api/maps/${mapId}${sq}`)).json()) as Detail;
  expect(throughSibling.pins).toHaveLength(0);
  expect(throughSibling.shapes).toHaveLength(0);
  expect((await dm.delete(`/api/pins/${camp.id}${sq}`)).status()).toBe(404);

  // The DM pulls a mark at their own table.
  expect((await dm.delete(`/api/pins/${camp.id}${q}`)).status()).toBe(204);
  expect((await read(a)).pins.map((p) => p.label)).toEqual(["The cave — certain now"]);

  // A player's marks leave with their seat.
  expect((await a.post(`/api/campaigns/${campaign.id}/leave`)).status()).toBe(204);
  const after = await read(dm);
  expect(after.pins).toHaveLength(0);
  expect(after.shapes).toHaveLength(0);

  await ctxA.close();
  await ctxB.close();
});

test("a player marks the map and draws a route with their own tools", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmtools"));
  const campaign = await createCampaign(page.request, unique("Tools "));
  const mapRes = await page.request.post(`/api/campaigns/${campaign.id}/maps`, {
    data: { name: unique("Chart "), imageBase64: await flatPng(page), visibleToParty: true },
  });
  const mapId = (await mapRes.json()).id as string;
  const url = `/questboard/campaigns/${campaign.id}/map/${mapId}`;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const player = await ctx.newPage();
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("ptools"));
  await joinCampaign(player.request, campaign.inviteCode);
  await player.goto(url);
  const canvas = player.getByTestId("map-canvas");
  await expect(player.getByRole("button", { name: "Mark it" })).toBeVisible({ timeout: 20_000 });

  // A pin of their own, private by default.
  await player.getByRole("button", { name: "Mark it" }).click();
  let box = (await canvas.boundingBox())!;
  await player.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await expect(player.getByRole("heading", { name: "Mark the Map" })).toBeVisible();
  // A mark offers none of the DM's doors.
  await expect(player.getByText("Leads into")).toHaveCount(0);
  await expect(player.getByText("DM only — the party never sees this pin")).toHaveCount(0);
  await player.getByPlaceholder("The Sleeping Giant Inn").fill("The cave");
  await player.getByRole("button", { name: "Mark it" }).last().click();
  const mine = player.locator("[data-pin-id]", { hasText: "The cave" });
  await expect(mine).toBeVisible({ timeout: 20_000 });

  // It opens as theirs, to amend or pull.
  await mine.click();
  await expect(player.getByText("Your mark")).toBeVisible();
  await expect(player.getByRole("button", { name: "Amend" })).toBeVisible();
  await player.locator("button", { hasText: /^Close$/ }).click();

  // A route: tap along it, finish, name it.
  await player.getByRole("button", { name: "Draw a route" }).click();
  await expect(player.getByText("Tap along your route")).toBeVisible();
  box = (await canvas.boundingBox())!;
  // Taps on ground that is on the screen: the fitted chart runs below the fold.
  await player.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await player.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await player.getByRole("button", { name: "Finish" }).click();
  await expect(player.getByText("Your route")).toBeVisible();
  await player.getByRole("textbox").first().fill("The way we came");
  await player.locator('input[name="shared"]').check();
  await player.getByRole("button", { name: "Draw the route" }).click();
  await expect(player.locator("text[data-road-name]", { hasText: "The way we came" })).toBeVisible({
    timeout: 20_000,
  });

  // The Legend has a row for them.
  await player.getByRole("button", { name: /Legend/ }).click();
  await expect(player.getByTestId("map-legend").getByText("Yours", { exact: true })).toBeVisible();

  const detail = (await (await player.request.get(`/api/maps/${mapId}?campaignId=${campaign.id}`)).json()) as Detail;
  expect(detail.pins[0].shared).toBe(false);
  expect(detail.shapes[0].shared).toBe(true);

  // The DM reads it under the player's name, and may pull it but not amend it.
  await page.goto(url);
  const theirs = page.locator("[data-pin-id]", { hasText: "The cave" });
  await expect(theirs).toBeVisible({ timeout: 20_000 });
  await theirs.click();
  await expect(page.getByText(/Marked by/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Amend" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pull it" }).click();
  await expect(page.locator("[data-pin-id]", { hasText: "The cave" })).toHaveCount(0);
  await ctx.close();
});
