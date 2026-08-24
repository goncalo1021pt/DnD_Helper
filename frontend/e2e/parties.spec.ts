import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  postQuest,
  registerViaAPI,
  seatHero,
  unique,
} from "./helpers";

/*
Parties: named groups of heroes, and the three grains of every veil (#232).

The table this exists for has ten or twelve players split across session
groups on different objectives in one world. Its governing rule is that
knowledge belongs to the heroes who were there — so a party is a BRUSH and
never a gate. Everything worth holding still falls out of that one decision:

  - revealing to a party writes the same per-hero rows a DM could click;
  - a hero who moves keeps every one of them;
  - disbanding a party takes nothing from anybody;
  - a hero who joins later inherits nothing they were never told.
*/

/** A player with a seated hero, ready to be sorted into a party. */
async function playerWithHero(
  browser: Browser,
  inviteCode: string,
  campaignId: string,
  heroName: string,
) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("pl"));
  await joinCampaign(page.request, inviteCode);
  const hero = (await (
    await page.request.post("/api/me/characters", {
      data: { name: heroName, class: "Half-Elf Ranger", level: 2, hpCurrent: 14, hpMax: 14 },
    })
  ).json()).id as string;
  await seatHero(page.request, hero, campaignId);
  return { ctx, page, hero };
}

async function knownQuests(request: APIRequestContext, campaignId: string): Promise<string[]> {
  const qs = await (await request.get(`/api/campaigns/${campaignId}/quests`)).json();
  return (qs as { title: string }[]).map((q) => q.title);
}

test("a party paints per-hero, and what it painted stays with the hero", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmparty"));
  const campaign = await createCampaign(dm.request, unique("The Sword Coast "));

  const a = await playerWithHero(browser, campaign.inviteCode, campaign.id, "Kaelen");
  const b = await playerWithHero(browser, campaign.inviteCode, campaign.id, "Sera");

  // --- form two parties and sort the heroes -------------------------------
  await dm.goto(`/questboard/campaigns/${campaign.id}/party`);
  await dm.getByLabel("Form a party").fill("The Harbour Crew");
  await dm.getByRole("button", { name: "Form" }).click();
  await expect(dm.getByRole("button", { name: "The Harbour Crew" }).first()).toBeVisible({
    timeout: 20_000,
  });
  await dm.getByLabel("Form a party").fill("The Deep Road");
  await dm.getByRole("button", { name: "Form" }).click();
  await expect(dm.getByRole("button", { name: "The Deep Road" }).first()).toBeVisible({
    timeout: 20_000,
  });

  const parties = await (await dm.request.get(`/api/campaigns/${campaign.id}/parties`)).json();
  const harbour = parties.find((p: { name: string }) => p.name === "The Harbour Crew");
  const deep = parties.find((p: { name: string }) => p.name === "The Deep Road");

  await dm.getByLabel("Which party Kaelen rides with").selectOption(harbour.id);
  await dm.getByLabel("Which party Sera rides with").selectOption(deep.id);
  await expect
    .poll(async () =>
      (await (await dm.request.get(`/api/campaigns/${campaign.id}/parties`)).json()).find(
        (p: { id: string }) => p.id === harbour.id,
      ).heroCount,
    )
    .toBe(1);

  // The roster groups by party once there is more than one.
  await expect(dm.getByRole("heading", { name: "The Harbour Crew" })).toBeVisible();
  await expect(dm.getByRole("heading", { name: "The Deep Road" })).toBeVisible();

  // --- a notice for one party only ----------------------------------------
  const secret = unique("The Bilge Ledger ");
  const quest = await postQuest(dm.request, campaign.id, secret);
  // A notice starts public; veil it first, so what follows is the party grain
  // and not the default.
  await dm.request.put(`/api/quests/${quest}/visibility`, {
    data: { scope: "table", visible: false },
  });
  expect(await knownQuests(a.page.request, campaign.id)).not.toContain(secret);

  const granted = await dm.request.put(`/api/quests/${quest}/visibility`, {
    data: { scope: "party", partyId: harbour.id, visible: true },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  expect(await knownQuests(a.page.request, campaign.id)).toContain(secret);
  expect(await knownQuests(b.page.request, campaign.id)).not.toContain(secret);

  // It landed as an ordinary per-hero row — a party is a brush, and the DM's
  // hero-by-hero view is the honest picture afterwards.
  const dmView = await (await dm.request.get(`/api/campaigns/${campaign.id}/quests`)).json();
  const row = dmView.find((q: { title: string }) => q.title === secret);
  expect(row.visibleToParty).toBe(false);
  expect(row.visibility).toHaveLength(1);
  expect(row.visibility[0].characterId).toBe(a.hero);

  // --- moving a hero takes nothing away ------------------------------------
  await dm.request.put(`/api/characters/${a.hero}/party`, { data: { partyId: deep.id } });
  expect(await knownQuests(a.page.request, campaign.id)).toContain(secret);
  // ...and joining a party hands nothing over: Sera rode with the Deep Road
  // all along and still has never heard of it.
  expect(await knownQuests(b.page.request, campaign.id)).not.toContain(secret);

  // --- disbanding takes nothing away either --------------------------------
  const gone = await dm.request.delete(`/api/parties/${harbour.id}`);
  expect(gone.status()).toBe(204);
  expect(await knownQuests(a.page.request, campaign.id)).toContain(secret);

  // --- and the grain is checked at the door --------------------------------
  const noParty = await dm.request.put(`/api/quests/${quest}/visibility`, {
    data: { scope: "party", visible: true },
  });
  expect(noParty.status()).toBe(400);
  const stranger = await dm.request.put(`/api/quests/${quest}/visibility`, {
    data: { scope: "party", partyId: "00000000-0000-0000-0000-000000000000", visible: true },
  });
  expect(stranger.status()).toBe(400);

  // Choosing the whole table is still choosing everyone, exceptions and all.
  await dm.request.put(`/api/quests/${quest}/visibility`, {
    data: { scope: "table", visible: true },
  });
  expect(await knownQuests(b.page.request, campaign.id)).toContain(secret);

  await dmCtx.close();
  await a.ctx.close();
  await b.ctx.close();
});

test("fog remembers the heroes who were there, not the party they were in", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmfog"));
  const campaign = await createCampaign(dm.request, unique("Fogged "));

  const a = await playerWithHero(browser, campaign.inviteCode, campaign.id, "Kaelen");
  const b = await playerWithHero(browser, campaign.inviteCode, campaign.id, "Sera");

  const scouts = (await (
    await dm.request.post(`/api/campaigns/${campaign.id}/parties`, { data: { name: "The Scouts" } })
  ).json()) as { id: string };
  await dm.request.put(`/api/characters/${a.hero}/party`, { data: { partyId: scouts.id } });

  const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const map = (await (
    await dm.request.post(`/api/campaigns/${campaign.id}/maps`, {
      data: { name: "The Reach", imageBase64: TINY_PNG, visibleToParty: true },
    })
  ).json()) as { id: string };
  // Fog is opt-in per map; a fresh one is open ground.
  const fogged = await dm.request.patch(`/api/maps/${map.id}`, {
    data: { name: "The Reach", fogEnabled: true },
  });
  expect(fogged.ok(), await fogged.text()).toBeTruthy();

  // Stamped for the scouts alone.
  const stamped = await dm.request.post(`/api/maps/${map.id}/reveals`, {
    data: {
      note: "session 3 — the ridge",
      partyId: scouts.id,
      circles: [{ x: 0.25, y: 0.5, r: 0.2 }],
    },
  });
  expect(stamped.ok(), await stamped.text()).toBeTruthy();
  const batch = await stamped.json();
  expect(batch.partyName).toBe("The Scouts");
  expect(batch.heroCount).toBe(1);

  const seen = async (page: Page) =>
    ((await (await page.request.get(`/api/maps/${map.id}`)).json()).revealed as unknown[]).length;
  expect(await seen(a.page)).toBe(1);
  expect(await seen(b.page)).toBe(0);

  // Kaelen leaves the Scouts and keeps the ground he walked; Sera joins them
  // and gains nothing she never saw.
  await dm.request.put(`/api/characters/${a.hero}/party`, { data: { partyId: null } });
  await dm.request.put(`/api/characters/${b.hero}/party`, { data: { partyId: scouts.id } });
  expect(await seen(a.page)).toBe(1);
  expect(await seen(b.page)).toBe(0);

  // A stamp for nobody is refused rather than quietly belonging to no one.
  await dm.request.put(`/api/characters/${b.hero}/party`, { data: { partyId: null } });
  const empty = await dm.request.post(`/api/maps/${map.id}/reveals`, {
    data: { partyId: scouts.id, circles: [{ x: 0.9, y: 0.9, r: 0.1 }] },
  });
  expect(empty.status()).toBe(400);

  await dmCtx.close();
  await a.ctx.close();
  await b.ctx.close();
});

/*
 * From the table: two parties were reading each other's roster, and one ally
 * walked beside both at once (#232). Grouping was never the whole ask —
 * a party partitions the cast list, not just the headings.
 */
test("a party sees its own roster, its own allies, and no sign of the other", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmsplit"));
  const campaign = await createCampaign(dm.request, unique("Two Roads "));

  const a = await playerWithHero(browser, campaign.inviteCode, campaign.id, "Kaelen");
  const b = await playerWithHero(browser, campaign.inviteCode, campaign.id, "Sera");

  const mk = async (name: string) =>
    (await (
      await dm.request.post(`/api/campaigns/${campaign.id}/parties`, { data: { name } })
    ).json()).id as string;
  const one = await mk("Party One");
  const two = await mk("Party Two");

  // Before anyone is sorted, everybody rides with nobody — and so sees
  // everybody, which is the page a table has always had.
  const roster = async (page: typeof a.page) =>
    ((await (await page.request.get(`/api/campaigns/${campaign.id}/characters`)).json()) as {
      name: string;
    }[]).map((c) => c.name);
  expect(await roster(a.page)).toHaveLength(2);

  await dm.request.put(`/api/characters/${a.hero}/party`, { data: { partyId: one } });
  await dm.request.put(`/api/characters/${b.hero}/party`, { data: { partyId: two } });

  // Sorted, each sees only their own — and the DM still sees the table.
  expect(await roster(a.page)).toEqual(["Kaelen"]);
  expect(await roster(b.page)).toEqual(["Sera"]);
  expect(await roster(dm as unknown as typeof a.page)).toHaveLength(2);

  // The other party's NAME does not leak either.
  const seenParties = async (page: typeof a.page) =>
    ((await (await page.request.get(`/api/campaigns/${campaign.id}/parties`)).json()) as {
      name: string;
    }[]).map((p) => p.name);
  expect(await seenParties(a.page)).toEqual(["Party One"]);
  expect(await seenParties(b.page)).toEqual(["Party Two"]);
  expect(await seenParties(dm as unknown as typeof a.page)).toHaveLength(2);

  // --- an ally rides with one party ---------------------------------------
  const greg = (await (
    await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, { data: { name: "Greg" } })
  ).json()).id as string;
  const rides = await dm.request.put(`/api/npcs/${greg}/travel`, {
    data: { traveling: true, partyId: one },
  });
  expect(rides.ok(), await rides.text()).toBeTruthy();

  const travelers = async (page: typeof a.page) =>
    ((await (await page.request.get(`/api/campaigns/${campaign.id}/npcs`)).json()) as {
      name: string;
      traveling?: boolean;
    }[]).filter((n) => n.traveling).map((n) => n.name);
  expect(await travelers(a.page)).toEqual(["Greg"]);
  expect(await travelers(b.page)).toEqual([]);

  // Filed with nobody, he walks with the whole table again.
  await dm.request.put(`/api/npcs/${greg}/travel`, {
    data: { traveling: true, partyId: "00000000-0000-0000-0000-000000000000" },
  });
  expect(await travelers(b.page)).toEqual(["Greg"]);

  // And a party from another table is refused at the door.
  const elsewhere = await createCampaign(dm.request, unique("Elsewhere "));
  const foreign = (await (
    await dm.request.post(`/api/campaigns/${elsewhere.id}/parties`, { data: { name: "Theirs" } })
  ).json()).id as string;
  const refused = await dm.request.put(`/api/npcs/${greg}/travel`, {
    data: { traveling: true, partyId: foreign },
  });
  expect(refused.status()).toBe(400);

  await dmCtx.close();
  await a.ctx.close();
  await b.ctx.close();
});
