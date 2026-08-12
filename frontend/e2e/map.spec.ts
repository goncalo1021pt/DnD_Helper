import { test, expect, type Page } from "@playwright/test";
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

/*
The DM's own hands on the map.

The four tests above are about what the *server* promises — fogged pixels,
withheld pins, a stranger turned away — and three of them reach the API
directly, because that is where those promises are kept. None of them touches
the 840-line function that is MapPage itself, which is where the pointer maths
lives: turning a tap into a fraction of the map, holding a draft of reveals that
is not committed until Submit, and taking one back.

That function is #108's next target, so this is the net under it. Written
against the UI on purpose: `POST /reveals` was already proven, and what is not
proven is that a click lands where the DM aimed.
*/
test("a DM stamps the fog back, takes one stamp off, and seals the rest", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("stamp"));
  const campaign = await createCampaign(page.request, unique("Stamping "));

  const res = await page.request.post(`/api/campaigns/${campaign.id}/maps`, {
    data: { name: "The Fogged Vale", imageBase64: await twoTonePng(page) },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const mapId = (await res.json()).id as string;
  // Fog is opt-in per map, and there is nothing to lift until it is on.
  await page.request.patch(`/api/maps/${mapId}`, {
    data: { name: "The Fogged Vale", fogEnabled: true },
  });

  await page.goto(`/questboard/campaigns/${campaign.id}/map`);
  const canvas = page.locator("img[alt='The Fogged Vale']");
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /Lift the fog/ }).click();
  const bar = page.getByText(/Tap to stamp a reveal|\d+ stamped/);
  await expect(bar).toHaveText(/Tap to stamp a reveal/);

  // Three taps at different places on the map. The count is the only thing the
  // draft shows for itself, and it is what says the tap became a circle.
  const box = (await canvas.boundingBox())!;
  for (const [fx, fy] of [[0.3, 0.4], [0.5, 0.5], [0.7, 0.6]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await expect(bar).toHaveText(/3 stamped/);

  // Nothing is committed yet: Undo pulls the last one back.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(bar).toHaveText(/2 stamped/);

  // Sealing it turns the draft into a batch and leaves stamp mode behind.
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByPlaceholder("session 12 — the road east").fill("session 1 — the vale");
  await page.getByRole("button", { name: "Reveal it" }).click();

  await expect(page.getByRole("button", { name: /Lift the fog/ })).toBeVisible({
    timeout: 20_000,
  });

  // And the ledger holds exactly what was sealed — two circles, under its note.
  const batches = await (await page.request.get(`/api/maps/${mapId}/reveals`)).json();
  expect(batches).toHaveLength(1);
  expect(batches[0].note).toBe("session 1 — the vale");
  // `circles` on a batch is a count, not the circles themselves.
  expect(batches[0].circles).toBe(2);
});

/*
A pin goes where the DM tapped.

`tapFraction` converts a click through the pan/zoom transform into a fraction of
the map, and a pin is stored in those fractions — so a refactor that gets the
maths wrong moves every pin on every map at once, quietly, and only a player
looking for the inn would ever notice.
*/
test("a pin lands where it was dropped, in the map's own coordinates", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("pindrop"));
  const campaign = await createCampaign(page.request, unique("Pinning "));

  const res = await page.request.post(`/api/campaigns/${campaign.id}/maps`, {
    data: { name: "The Coast Road", imageBase64: await twoTonePng(page) },
  });
  const mapId = (await res.json()).id as string;

  await page.goto(`/questboard/campaigns/${campaign.id}/map`);
  const canvas = page.locator("img[alt='The Coast Road']");
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Drop a pin" }).click();
  await expect(page.getByText("Tap where the pin goes")).toBeVisible();

  // Three-quarters across, one-quarter down — chosen off-centre so a transposed
  // or inverted axis cannot pass by symmetry.
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25);

  await page.getByPlaceholder("The Sleeping Giant Inn").fill("The Sleeping Giant Inn");
  await page.getByRole("button", { name: "Pin it" }).click();

  await expect(page.getByText("The Sleeping Giant Inn")).toBeVisible({ timeout: 20_000 });

  // The stored fractions are what the DM aimed at, not merely *a* pair.
  const detail = await (await page.request.get(`/api/maps/${mapId}`)).json();
  expect(detail.pins).toHaveLength(1);
  expect(detail.pins[0].x).toBeGreaterThan(0.65);
  expect(detail.pins[0].x).toBeLessThan(0.85);
  expect(detail.pins[0].y).toBeGreaterThan(0.15);
  expect(detail.pins[0].y).toBeLessThan(0.35);
});

/*
Fog tied to a place (#191).

The DM stamps a city once and hands it to the hero who grew up there. Two
players, one map: the local receives the city's pixels, the stranger receives
black — and when the party finally rides in, the same stamps serve everyone
without being drawn again.
*/
test("a reveal tied to a place lifts only for the heroes who know it", async ({ browser }) => {
  const dm = newAccount("dmloc");
  const local = newAccount("plloc");
  const stranger = newAccount("plstr");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Homeland "));
  const campaignId = campaign.id;

  const mapId = (
    await (
      await dmPage.request.post(`/api/campaigns/${campaignId}/maps`, {
        data: { name: "The Coast", imageBase64: await twoTonePng(dmPage) },
      })
    ).json()
  ).id as string;
  await dmPage.request.patch(`/api/maps/${mapId}`, {
    data: { name: "The Coast", fogEnabled: true },
  });

  // The city sits on the western (red) half. It starts veiled, as places do.
  const lisboa = await createLocation(dmPage.request, campaignId, unique("Lisboa "));

  // Both players bring a hero of their own — the veil resolves through the
  // heroes a member has seated, so the hero must actually be theirs.
  const seat = async (account: typeof local, name: string) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await registerViaAPI(page.request, account);
    await joinCampaign(page.request, campaign.inviteCode);
    const heroId = await forgeHero(page.request, {
      name,
      className: "Fighter",
      speciesName: "Human",
      backgroundName: "Soldier",
      abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
      skills: ["Athletics", "Intimidation"],
    });
    await seatHero(page.request, heroId, campaignId);
    return { ctx, page, heroId };
  };
  const born = await seat(local, unique("Ines "));
  const guest = await seat(stranger, unique("Kord "));

  // One batch, tied to the city.
  const submitted = await dmPage.request.post(`/api/maps/${mapId}/reveals`, {
    data: {
      note: "knowledge of the city",
      locationId: lisboa,
      circles: [{ x: 0.25, y: 0.5, r: 0.3 }],
    },
  });
  expect(submitted.ok(), await submitted.text()).toBeTruthy();

  // Nobody knows the city yet, so its ground is still fogged for both.
  for (const [who, page] of [
    ["the local", born.page],
    ["the stranger", guest.page],
  ] as const) {
    await page.goto(`/questboard/campaigns/${campaignId}/map`);
    expect(
      isDark(await samplePixel(page, mapId, 0.25, 0.5, "0")),
      `${who} should see nothing before the place is given to anyone`,
    ).toBe(true);
  }

  // The DM gives the city to one hero — a background, not a party reveal.
  const given = await dmPage.request.put(`/api/locations/${lisboa}/visibility`, {
    data: { scope: "character", characterId: born.heroId, visible: true },
  });
  expect(given.ok(), await given.text()).toBeTruthy();

  await expect
    .poll(async () => isRed(await samplePixel(born.page, mapId, 0.25, 0.5, "1")), {
      timeout: 15_000,
      message: "the hero who grew up there should receive the city",
    })
    .toBe(true);
  expect(
    isDark(await samplePixel(guest.page, mapId, 0.25, 0.5, "1")),
    "a stranger to the city must still receive black",
  ).toBe(true);

  // The pixels are the disclosure, but the JSON must agree — a circle handed
  // to a player who cannot see the place would leak where the city is.
  const asStranger = await (await guest.page.request.get(`/api/maps/${mapId}`)).json();
  expect(asStranger.revealed, "a stranger holds no circles for that place").toHaveLength(0);

  // The party rides in: the same batch now serves everyone, unstamped again.
  await revealLocation(dmPage.request, lisboa);
  await expect
    .poll(async () => isRed(await samplePixel(guest.page, mapId, 0.25, 0.5, "2")), {
      timeout: 15_000,
      message: "revealing the place to the party lifts the same ground for all",
    })
    .toBe(true);

  // And the east, which nobody stamped, stays fogged throughout.
  expect(
    isDark(await samplePixel(born.page, mapId, 0.9, 0.5, "2")),
    "unstamped ground stays fogged whoever you are",
  ).toBe(true);

  await dmCtx.close();
  await born.ctx.close();
  await guest.ctx.close();
});
