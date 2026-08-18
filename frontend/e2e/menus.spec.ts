import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  registerViaAPI,
  unique,
} from "./helpers";

/*
The campaign menus (v1.7): the seats-per-player cap and its dial in Table
Rules (#171), the DM's bench (#179), and the Player Menu with its door out
(#171). Setup goes through the API; the thing under test is driven in the UI.
*/

/** A lightweight account hero on the caller's My Heroes shelf. */
async function shelfHero(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/me/characters", {
    data: { name, class: "Wandering Sellsword", level: 2, hpCurrent: 16, hpMax: 16 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

/** Seat a hero, returning the raw response — some tests want the refusal. */
async function seatHero(request: APIRequestContext, characterId: string, campaignId: string | null) {
  return request.put(`/api/characters/${characterId}/seat`, {
    data: { campaignId },
  });
}

test("the table seats one hero per player until the DM widens the door", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("dm"));
  const campaign = await createCampaign(dmPage.request, unique("One Seat "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await registerViaAPI(plPage.request, newAccount("pl"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  const first = await shelfHero(plPage.request, unique("Aldan "));
  const second = await shelfHero(plPage.request, unique("Berrin "));

  // The first hero sits; the second is turned away with the reason.
  expect((await seatHero(plPage.request, first, campaign.id)).ok()).toBeTruthy();
  const refused = await seatHero(plPage.request, second, campaign.id);
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toContain("seats one hero per player");

  // The DM widens the door from Table Rules.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/dm`);
  await dmPage
    .getByRole("combobox")
    .filter({ hasText: /One hero each/ })
    .selectOption("2");
  // The dial reads back the wider cap once the server confirms it.
  await expect(
    dmPage.getByRole("combobox").filter({ hasText: /heroes each/ }),
  ).toHaveValue("2");

  // Now the second hero seats.
  const admitted = await seatHero(plPage.request, second, campaign.id);
  expect(admitted.ok(), await admitted.text()).toBeTruthy();
});

test("the DM benches a seated hero back to its owner's shelf", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("dm"));
  const campaign = await createCampaign(dmPage.request, unique("The Bench "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await registerViaAPI(plPage.request, newAccount("pl"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  const heroName = unique("Corvin ");
  const hero = await shelfHero(plPage.request, heroName);
  expect((await seatHero(plPage.request, hero, campaign.id)).ok()).toBeTruthy();

  // The DM benches from the party page. The confirm is a browser dialog.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/party`);
  dmPage.on("dialog", (d) => d.accept());
  await dmPage.getByRole("button", { name: "Bench" }).click();
  await expect(dmPage.getByRole("button", { name: "Bench" })).toHaveCount(0);

  // The hero is back on the owner's shelf, seated nowhere.
  const mine = await (await plPage.request.get("/api/me/characters")).json();
  const benched = mine.find((c: { id: string }) => c.id === hero);
  expect(benched.campaignId ?? null).toBeNull();
});

test("a player leaves the table from the Player Menu", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("dm"));
  const campaign = await createCampaign(dmPage.request, unique("The Long Walk "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await registerViaAPI(plPage.request, newAccount("pl"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  const heroName = unique("Darla ");
  const hero = await shelfHero(plPage.request, heroName);
  expect((await seatHero(plPage.request, hero, campaign.id)).ok()).toBeTruthy();

  // The rail carries the player in; their seat lists the hero.
  await plPage.goto(`/questboard/campaigns/${campaign.id}`);
  await plPage.getByRole("link", { name: "Player Menu" }).first().click();
  await expect(plPage.getByRole("heading", { name: "Your Seat" })).toBeVisible();
  await expect(plPage.getByRole("link", { name: heroName })).toBeVisible();

  // Leaving asks first, then walks them out to the campaign list.
  await plPage.getByRole("button", { name: "Leave this campaign" }).click();
  await plPage.getByRole("button", { name: "Leave the table" }).click();
  await expect(plPage).toHaveURL(/\/questboard$/);
  await expect(plPage.getByText(campaign.name)).toHaveCount(0);

  // Their hero came home rather than staying at a table they left.
  const mine = await (await plPage.request.get("/api/me/characters")).json();
  expect(mine.find((c: { id: string }) => c.id === hero).campaignId ?? null).toBeNull();

  // The DM's ledger no longer lists them.
  const members = await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/members`)
  ).json();
  expect(members).toHaveLength(1);
});

/*
 * #231: the rail reads as families, and every chip in it has a door on the
 * Hall. Folk once reached the rail and never got a block, so the check that
 * matters is the parity one — walk the rail, and demand the Hall answer for
 * each destination.
 */

/** Every href in the section rail, and every href outside it. */
async function railAndDoors(page: Page): Promise<{ rail: string[]; doors: string[] }> {
  return page.evaluate(() => {
    const rail = Array.from(document.querySelectorAll("nav")).find((n) =>
      Array.from(n.querySelectorAll("a")).some(
        (a) => a.textContent?.trim() === "The Hall",
      ),
    );
    if (!rail) throw new Error("no section rail on the page");
    const href = (a: HTMLAnchorElement) => a.getAttribute("href") ?? "";
    return {
      rail: Array.from(rail.querySelectorAll("a")).map(href),
      doors: Array.from(document.querySelectorAll("a"))
        .filter((a) => !rail.contains(a))
        .map((a) => href(a as HTMLAnchorElement)),
    };
  });
}

test("every room on the rail has a door on the hall", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("raildm"));
  const campaign = await createCampaign(dmPage.request, unique("Families "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await registerViaAPI(plPage.request, newAccount("railpl"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  for (const [page, role] of [
    [dmPage, "dm"],
    [plPage, "player"],
  ] as const) {
    await page.goto(`/questboard/campaigns/${campaign.id}`);
    await expect(page.getByRole("heading", { name: "The Quest Board" })).toBeVisible();

    const { rail, doors } = await railAndDoors(page);
    const home = `/questboard/campaigns/${campaign.id}`;
    // Every chip but the Hall's own — you are already standing in that one.
    const rooms = rail.filter((h) => h !== home && h !== `${home}/`);
    expect(rooms.length).toBeGreaterThan(8);
    for (const room of rooms) {
      expect(doors, `${role}: no door on the hall for ${room}`).toContain(room);
    }

    // Folk is the one that shipped to the rail and never reached the Hall.
    expect(rooms).toContain(`${home}/npcs`);
    await expect(page.getByRole("heading", { name: "The Folk" })).toBeVisible();

    // The families read as headings over their clusters.
    const railNav = page.locator("nav").filter({
      has: page.getByRole("link", { name: "The Hall", exact: true }),
    });
    for (const word of ["the story", "the world", "the table"]) {
      await expect(railNav.getByText(word, { exact: true })).toBeVisible();
    }
    // The last family is whichever side is reading.
    await expect(
      railNav.getByText(role === "dm" ? "yours alone" : "yours to carry", {
        exact: true,
      }),
    ).toBeVisible();
  }

  // The Den is the DM's alone — it is in no player's family.
  const { rail: plRail } = await railAndDoors(plPage);
  expect(plRail.some((h) => h.endsWith("/den"))).toBe(false);
  expect(plRail.some((h) => h.endsWith("/player"))).toBe(true);
});
