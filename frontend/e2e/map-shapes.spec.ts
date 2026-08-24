import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createCampaign, createLocation, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Roads and regions drawn on a map (#262).

Two asks from the table that turned out to be one feature: a brush that draws a
street, and an overlay that tints a kingdom. Both are an ordered run of points;
only whether the run is stroked or filled differs.

These specs were all API-level when #262 shipped, and that is exactly how the
shapes reached production untouchable: the form's Rub it out button was wired
and correct, and no human could open the form, because the viewer captured the
press for panning before it reached the mark (#277). The last test here drives
a real browser for that reason.

What is worth pinning is the veil, because a road is as much a piece of
knowledge as a village. A DM-only shape is absent from a player's payload, and
under fog a LINE comes back clipped to the stretches standing on ground that
player has uncovered — a highway must not announce where it goes because the
party found one mile of it. A REGION is all-or-nothing on purpose: dropping
corners from a polygon does not clip it, it redraws it into a different
country.
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

async function hangMap(page: Page, campaignId: string, fog: boolean): Promise<string> {
  const res = await page.request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name: unique("Chart "), imageBase64: await flatPng(page) },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const mapId = (await res.json()).id as string;
  if (fog) {
    const on = await page.request.patch(`/api/maps/${mapId}`, {
      data: { name: "Chart", fogEnabled: true },
    });
    expect(on.ok(), await on.text()).toBeTruthy();
  }
  return mapId;
}

async function shapesOf(request: APIRequestContext, mapId: string) {
  const res = await request.get(`/api/maps/${mapId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).shapes as {
    id: string;
    kind: string;
    label: string;
    points: { x: number; y: number }[];
    locationName?: string | null;
  }[];
}

test("a road and a region are the same row wearing different clothes", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmshape"));
  const campaign = await createCampaign(page.request, unique("Cartwright "));
  const mapId = await hangMap(page, campaign.id, false);
  const town = await createLocation(page.request, campaign.id, unique("Barovia "));

  const road = await page.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "line",
      label: "The High Road",
      points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.4 }, { x: 0.9, y: 0.5 }],
      color: "#c96a5a",
      dashed: true,
    },
  });
  expect(road.status()).toBe(201);
  expect((await road.json()).dashed).toBe(true);

  const region = await page.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "area",
      label: "Barovia",
      points: [{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.6, y: 0.7 }, { x: 0.1, y: 0.7 }],
      color: "#7d9b6a",
      opacity: 0.3,
      locationId: town,
    },
  });
  expect(region.status()).toBe(201);
  // A region can BE a place, not merely name one.
  expect((await region.json()).locationName).toBeTruthy();

  const all = await shapesOf(page.request, mapId);
  expect(all.map((s) => s.kind).sort()).toEqual(["area", "line"]);

  // A line cannot become an area by being restyled — the gesture differs, so
  // the answer is to rub it out and draw the other.
  const morph = await page.request.patch(`/api/shapes/${(await road.json()).id}`, {
    data: { kind: "area", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.1 }] },
  });
  expect(morph.status()).toBe(400);
  expect(await morph.text()).toContain("rub it out");
});

test("a shape needs enough points to be one, and a colour it can be drawn in", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmvalid"));
  const campaign = await createCampaign(page.request, unique("Draughtsman "));
  const mapId = await hangMap(page, campaign.id, false);

  // A line of one point goes nowhere; a region of two encloses nothing.
  for (const [kind, points] of [
    ["line", [{ x: 0.1, y: 0.1 }]],
    ["area", [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]],
  ] as const) {
    const res = await page.request.post(`/api/maps/${mapId}/shapes`, { data: { kind, points } });
    expect(res.status(), `${kind} with ${points.length}`).toBe(400);
  }

  const bad = await page.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "line",
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      color: "crimson",
    },
  });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain("hex");
});

test("players never receive a DM-only shape", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmsecret"));
  const campaign = await createCampaign(dm.request, unique("Secret Ways "));
  const mapId = await hangMap(dm, campaign.id, false);

  await dm.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "line",
      label: "The Smugglers' Run",
      points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      dmOnly: true,
    },
  });
  await dm.request.post(`/api/maps/${mapId}/shapes`, {
    data: { kind: "line", label: "The King's Road", points: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }] },
  });

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plsecret"));
  await joinCampaign(pl.request, campaign.inviteCode);

  const theirs = await shapesOf(pl.request, mapId);
  expect(theirs).toHaveLength(1);
  expect(theirs[0].label).toBe("The King's Road");
  // Absent, not flagged: nothing in the payload hints the other one exists.
  expect(JSON.stringify(theirs)).not.toContain("Smuggler");

  // And a player cannot draw on the DM's map either.
  const forbidden = await pl.request.post(`/api/maps/${mapId}/shapes`, {
    data: { kind: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  });
  expect(forbidden.status()).toBe(403);

  await dmCtx.close();
  await plCtx.close();
});

test("under fog a road is clipped to the stretch the party has walked", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmclip"));
  const campaign = await createCampaign(dm.request, unique("The Long Road "));
  const mapId = await hangMap(dm, campaign.id, true);

  // A road running the width of the map, and a kingdom over its left half.
  await dm.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "line",
      label: "The High Road",
      points: [
        { x: 0.05, y: 0.5 }, { x: 0.15, y: 0.5 }, { x: 0.25, y: 0.5 },
        { x: 0.75, y: 0.5 }, { x: 0.85, y: 0.5 }, { x: 0.95, y: 0.5 },
      ],
    },
  });
  await dm.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "area",
      label: "The Westmarch",
      points: [{ x: 0.05, y: 0.2 }, { x: 0.45, y: 0.2 }, { x: 0.45, y: 0.8 }, { x: 0.05, y: 0.8 }],
    },
  });

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plclip"));
  await joinCampaign(pl.request, campaign.inviteCode);

  // Nothing walked yet: the road and the kingdom are both simply absent.
  expect(await shapesOf(pl.request, mapId)).toHaveLength(0);

  // The party walks the western end.
  const lift = await dm.request.post(`/api/maps/${mapId}/reveals`, {
    data: { circles: [{ x: 0.15, y: 0.5, r: 0.2 }] },
  });
  expect(lift.ok(), await lift.text()).toBeTruthy();

  const seen = await shapesOf(pl.request, mapId);
  const road = seen.find((s) => s.kind === "line");
  expect(road, "the walked stretch should arrive").toBeTruthy();
  // Three of the six points stand on uncovered ground; the eastern half of
  // the road must not have come along with them.
  expect(road!.points).toHaveLength(3);
  for (const p of road!.points) expect(p.x).toBeLessThan(0.5);

  // The kingdom was touched, so it arrives whole — its shape is the point of
  // it, and dmOnly is what holds one back that the party should not have yet.
  const kingdom = seen.find((s) => s.kind === "area");
  expect(kingdom!.points).toHaveLength(4);

  await dmCtx.close();
  await plCtx.close();
});

test("a road answers a press, a region is still ground, and both can be rubbed out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmink"));
  const campaign = await createCampaign(page.request, unique("Inkwork "));
  const mapId = await hangMap(page, campaign.id, false);

  await page.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "line",
      label: "The High Road",
      points: [{ x: 0.1, y: 0.6 }, { x: 0.5, y: 0.6 }, { x: 0.9, y: 0.6 }],
      color: "#c96a5a",
      width: 0.006,
    },
  });
  await page.request.post(`/api/maps/${mapId}/shapes`, {
    data: {
      kind: "area",
      label: "Barovia",
      points: [
        { x: 0.12, y: 0.12 }, { x: 0.55, y: 0.12 },
        { x: 0.55, y: 0.4 }, { x: 0.12, y: 0.4 },
      ],
      color: "#7d9b6a",
      opacity: 0.3,
    },
  });

  await page.goto(`/questboard/campaigns/${campaign.id}/map/${mapId}`);
  await expect(page.getByRole("button", { name: /Draw/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  /** Where a drawn shape sits on the screen right now. */
  const boxOf = (label: string) =>
    page.evaluate((t) => {
      const g = Array.from(document.querySelectorAll("g[data-shape-id]")).find((x) =>
        (x.textContent || "").includes(t),
      );
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, label);

  // Pressing the road opens the form it has always had — the whole of #277.
  const road = await boxOf("High Road");
  expect(road, "the road should be drawn").toBeTruthy();
  await page.mouse.click(road!.x + road!.w / 2, road!.y + road!.h / 2);
  await expect(page.getByRole("button", { name: "Rub it out" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // A region is grabbed by its border, never by its fill: pressing the edge
  // opens it...
  const area = await boxOf("Barovia");
  await page.mouse.click(area!.x + 1, area!.y + area!.h / 2);
  await expect(page.getByRole("button", { name: "Rub it out" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // ...while dragging from inside it still pans the map. A kingdom covering
  // half the chart must not be half a chart you cannot move.
  const where = () =>
    page.evaluate(
      () => document.querySelector("g[data-shape-id]")!.getBoundingClientRect().x,
    );
  const before = await where();
  const inX = area!.x + area!.w * 0.75;
  const inY = area!.y + area!.h * 0.8;
  await page.mouse.move(inX, inY);
  await page.mouse.down();
  await page.mouse.move(inX - 90, inY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(before - (await where()), "dragging inside a region should pan").toBeGreaterThan(50);

  // And the list is the other way in — the one a DM looks for, and the one
  // that reaches a road clipped away under fog or drawn off the screen.
  await page.getByRole("button", { name: /Draw/ }).click();
  await expect(page.getByRole("heading", { name: "The Inkwork" })).toBeVisible();
  await page.getByRole("button", { name: "Rub out The High Road" }).click();
  await page.getByRole("button", { name: "Rub it out" }).click();

  await expect
    .poll(async () => (await shapesOf(page.request, mapId)).map((s) => s.label))
    .toEqual(["Barovia"]);
});
