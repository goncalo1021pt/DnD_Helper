import { expect, test } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  joinCampaign,
  newAccount,
  registerViaAPI,
  revealLocation,
  seatHero,
  unique,
} from "./helpers";

/*
The people of a campaign, and who has been told about them (#215).

An NPC is prep, like a shop: drafted at home, met at the table. Two veils
stand over each person — being known at all, and having their numbers
readable — and the place tree above them has the final word on the first.

The assertions that matter are made from the PLAYER's browser, against both
the page and the API: a hidden person is not sent with a flag for the UI to
respect, they are not sent at all. And a person can be known while their stat
block still is not — the second veil moves on its own.
*/
test("a person is a rumor until the DM says otherwise — and their numbers are a second secret", async ({ browser }) => {
  const dm = newAccount("dmfolk");
  const player = newAccount("plfolk");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Harbour Watch "));
  const town = await createLocation(dmPage.request, campaign.id, unique("Porto "));

  const captain = unique("Captain Amélia ");
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await dmPage.getByPlaceholder("Bring in a person — name them…").fill(captain);
  await dmPage.getByLabel("Where they are found").selectOption(town);
  await dmPage.getByRole("button", { name: "Bring in", exact: true }).click();
  await expect(dmPage.getByText(captain)).toBeVisible({ timeout: 20_000 });

  // A stat block stands behind her: an SRD monster out of the Den.
  await dmPage.getByLabel(`Attach a stat block to ${captain}`).fill("Aboleth");
  await dmPage.getByRole("button", { name: "Aboleth", exact: true }).click();
  await expect(
    dmPage.getByRole("button", { name: `Read their stat block — Aboleth` }),
  ).toBeVisible({ timeout: 20_000 });

  // --- the player, before anything is shown --------------------------------
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);
  await plPage.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await expect(plPage.getByText(/You have met no one worth writing down/)).toBeVisible({
    timeout: 20_000,
  });
  const unseen = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)
  ).json()) as unknown[];
  expect(unseen, "an unrevealed person must not reach the player at all").toEqual([]);

  // --- the DM reveals HER, but Porto itself is still veiled -----------------
  await dmPage.getByRole("button", { name: "Unknown to the party" }).click();
  await expect(dmPage.getByRole("button", { name: "The party knows them" })).toBeVisible();

  const stillDark = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)
  ).json()) as unknown[];
  expect(stillDark, "a veiled place hides its people, whatever their own veil says").toEqual([]);

  // --- Porto's veil lifts: the person is known, the numbers are not ---------
  await revealLocation(dmPage.request, town, campaign.id);

  await plPage.reload();
  await expect(plPage.getByText(captain)).toBeVisible({ timeout: 20_000 });
  await expect(plPage.getByRole("button", { name: /Read their stat block/ })).toHaveCount(0);
  const known = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)
  ).json()) as Array<{ name: string; locationName: string; statBlock?: unknown }>;
  expect(known).toHaveLength(1);
  expect(known[0].locationName, "the person carries the place they are found in").toContain("Porto");
  expect(known[0].statBlock, "the stats stay behind their own veil").toBeUndefined();

  // --- the second veil opens ------------------------------------------------
  await dmPage.getByRole("button", { name: "Stats veiled" }).click();
  await expect(dmPage.getByRole("button", { name: "Stats open" })).toBeVisible();

  await plPage.reload();
  await plPage.getByRole("button", { name: `Read their stat block — Aboleth` }).click();
  await expect(plPage.getByText(/Aberration/i).first()).toBeVisible({ timeout: 20_000 });

  // And the player cannot reach in and change anyone.
  const npcId = (
    (await (await plPage.request.get(`/api/campaigns/${campaign.id}/npcs`)).json()) as Array<{
      id: string;
    }>
  )[0].id;
  const refused = await plPage.request.patch(`/api/npcs/${npcId}`, {
    data: { name: "Nobody" },
  });
  expect(refused.ok(), "a player cannot amend a person").toBeFalsy();

  await dmCtx.close();
  await plCtx.close();
});

/*
A hidden person must be indistinguishable from one who does not exist (#240).
The DM-only doors used to split 403-for-real-ids / 404-for-fake-ids, which let
a player probe the id space. Now every non-DM caller reads "no such person".
*/
test("a player probing the folk doors cannot tell a hidden person from a fake id", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("probedm"));
  const campaign = await createCampaign(dm.request, unique("Probe Table "));
  const npcRes = await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, {
    data: { name: "The Quiet One" }, // veiled by default
  });
  expect(npcRes.ok(), await npcRes.text()).toBeTruthy();
  const hiddenId = (await npcRes.json()).id as string;

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("probepl"));
  await joinCampaign(pl.request, campaign.inviteCode);

  const fakeId = "00000000-0000-4000-8000-000000000001";
  for (const [what, id] of [
    ["a hidden person", hiddenId],
    ["a fake id", fakeId],
  ] as const) {
    const patch = await pl.request.patch(`/api/npcs/${id}`, { data: { name: "Probe" } });
    expect(patch.status(), `PATCH on ${what}`).toBe(404);
    const del = await pl.request.delete(`/api/npcs/${id}`);
    expect(del.status(), `DELETE on ${what}`).toBe(404);
    const vis = await pl.request.put(`/api/npcs/${id}/visibility`, {
      data: { scope: "table", visible: true },
    });
    expect(vis.status(), `visibility PUT on ${what}`).toBe(404);
  }

  // The DM's own doors still open — the person is real and editable.
  const dmPatch = await dm.request.patch(`/api/npcs/${hiddenId}`, {
    data: { name: "The Quiet One" },
  });
  expect(dmPatch.ok(), await dmPatch.text()).toBeTruthy();

  await dmCtx.close();
  await plCtx.close();
});

/*
 * #227: a sheet makes a person statted; it never makes them a party member.
 *
 * Statting the tavern keeper used to mean quick-adding them onto the Party
 * page and walking back here to attach it — so they sat in the roster with an
 * HP bar, were counted among the adventurers, and resolved veils as one of the
 * DM's own heroes. The sheet is forged here now, and is a body from the first
 * moment: off the roster, off the count, off My Heroes, and struck with the
 * person it was forged for.
 */
test("a sheet forged for one of the Folk is a body, not a seat at the table", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmbody"));
  const campaign = await createCampaign(dmPage.request, unique("The Yawning Portal "));
  const town = await createLocation(dmPage.request, campaign.id, unique("Waterdeep "));

  const keeper = unique("Durnan ");
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await dmPage.getByPlaceholder("Bring in a person — name them…").fill(keeper);
  await dmPage.getByLabel("Where they are found").selectOption(town);
  await dmPage.getByRole("button", { name: "Bring in", exact: true }).click();
  await expect(dmPage.getByText(keeper)).toBeVisible({ timeout: 20_000 });

  // Forge them a sheet, right here — no walk through the Party page.
  await dmPage.getByRole("button", { name: "…or forge them a sheet" }).click();
  await expect(dmPage.getByRole("heading", { name: `A Sheet for ${keeper}` })).toBeVisible();
  await dmPage.getByLabel("Class & ancestry").fill("Fighter");
  await dmPage.getByRole("button", { name: "Forge the sheet" }).click();
  await expect(dmPage.getByRole("link", { name: new RegExp(`Open their sheet`) })).toBeVisible();

  // The body exists and is theirs...
  const npcs = await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/npcs`)
  ).json();
  const person = npcs.find((n: { name: string }) => n.name === keeper);
  expect(person.characterId).toBeTruthy();

  // ...but it is on no roster, in no count, and on no shelf.
  const roster = await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/characters`)
  ).json();
  expect(roster).toHaveLength(0);
  const shelf = await (await dmPage.request.get("/api/me/characters")).json();
  expect(shelf.find((c: { id: string }) => c.id === person.characterId)).toBeUndefined();

  await dmPage.goto(`/questboard/campaigns/${campaign.id}/party`);
  await expect(dmPage.getByText(keeper)).toHaveCount(0);
  await dmPage.goto(`/questboard/campaigns/${campaign.id}`);
  // The Hall's party block counts nobody — its stamp is absent, and its body
  // still says the ledger is empty.
  await expect(dmPage.getByText(/^\d+ adventurers?$/)).toHaveCount(0);
  await expect(dmPage.getByText("No adventurers yet", { exact: false })).toBeVisible();

  // It holds no seat to give up either.
  const unseat = await dmPage.request.put(`/api/characters/${person.characterId}/seat`, {
    data: { campaignId: null },
  });
  expect(unseat.status()).toBe(400);

  // And a real hero is still a hero: the roster filters by kind, not by owner.
  const hero = await (
    await dmPage.request.post(`/api/campaigns/${campaign.id}/characters`, {
      data: { name: "Ledger Hand", class: "Rogue", level: 1, hpCurrent: 8, hpMax: 8 },
    })
  ).json();
  const roster2 = await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/characters`)
  ).json();
  expect(roster2.map((c: { id: string }) => c.id)).toEqual([hero.id]);

  // A hero cannot be pressed into service as somebody's body, either.
  const wrong = await dmPage.request.patch(`/api/npcs/${person.id}`, {
    data: { name: keeper, characterId: hero.id },
  });
  expect(wrong.status()).toBe(400);

  // Parting with the sheet strikes it — a body outlives nobody.
  dmPage.once("dialog", (d) => d.accept());
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await dmPage.getByLabel(`Strike the sheet of ${keeper}`).click();
  await expect(dmPage.getByRole("button", { name: "…or forge them a sheet" })).toBeVisible();
  const gone = await dmPage.request.get(`/api/characters/${person.characterId}`);
  expect(gone.status()).toBe(404);

  await dmCtx.close();
});

/*
 * #267: a body is read through its person, not through the table's sheet veil.
 *
 * A body is DM-owned and seated only because a sheet has to live somewhere, so
 * `GET /characters/{id}` used to judge it exactly like anybody's hero — asking
 * `campaigns.hidden_sheets`, which is about players not reading one another's
 * heroes and has no opinion at all about the Folk. It got the answer wrong
 * twice over: with the table veil down (nearly every table) it consulted
 * nothing and handed the sheet to any member holding the id, and with the veil
 * drawn it refused a sheet the DM had deliberately opened.
 *
 * The whole point is that the two doors agree, so the test walks them together:
 * every step asks `/npcs` what the player is OFFERED and `/characters/{id}`
 * what the player is GIVEN, and they must say the same thing every time.
 */
test("a body is read through its person — the sheet door and the Folk page agree", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmveil"));
  const campaign = await createCampaign(dm.request, unique("Two Doors "));

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plveil"));
  await joinCampaign(pl.request, campaign.inviteCode);
  const hero = (
    await (
      await pl.request.post("/api/me/characters", {
        data: { name: unique("Nib "), class: "Rogue", level: 2, hpCurrent: 14, hpMax: 14 },
      })
    ).json()
  ).id as string;
  await seatHero(pl.request, hero, campaign.id);

  // A person, veiled by default, with a sheet forged for them on the Folk page.
  const keeper = unique("Barthen ");
  const npc = (
    await (
      await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, { data: { name: keeper } })
    ).json()
  ).id as string;
  const forged = await dm.request.post(`/api/npcs/${npc}/body`, {
    data: { name: keeper, class: "Commoner", level: 3, hpCurrent: 18, hpMax: 18 },
  });
  expect(forged.ok(), await forged.text()).toBeTruthy();
  const bodyId = (await forged.json()).characterId as string;
  expect(bodyId).toBeTruthy();

  /** What the Folk page offers this player, and what the sheet door gives them. */
  async function doors(): Promise<{ offered: boolean; given: number }> {
    const folk = await (await pl.request.get(`/api/campaigns/${campaign.id}/npcs`)).json();
    const person = (folk as { id: string; characterId?: string }[]).find((n) => n.id === npc);
    const sheet = await pl.request.get(`/api/characters/${bodyId}`);
    return { offered: !!person?.characterId, given: sheet.status() };
  }

  // Nobody has been told this person exists. The sheet is not theirs to read —
  // and before #267 this was a 200 with the whole thing in it.
  expect(await doors()).toEqual({ offered: false, given: 404 });

  // Known to the party. Knowing somebody is not reading their sheet.
  await dm.request.put(`/api/npcs/${npc}/visibility`, {
    data: { scope: "table", visible: true },
  });
  expect(await doors()).toEqual({ offered: false, given: 404 });

  // The DM opens their numbers to that one hero. Both doors open together.
  await dm.request.put(`/api/npcs/${npc}/stats-visibility`, {
    data: { scope: "character", characterId: hero, visible: true },
  });
  expect(await doors()).toEqual({ offered: true, given: 200 });

  // And the sheet says what it is, so the page can stop calling one of the
  // Folk a freeform hero with a Forge waiting for them.
  const read = await (await pl.request.get(`/api/characters/${bodyId}`)).json();
  expect(read.character.kind).toBe("npc");
  const ownSheet = await (await pl.request.get(`/api/characters/${hero}`)).json();
  expect(ownSheet.character.kind).toBe("hero");

  // The table draws its veil over the party's own sheets. It rules the heroes
  // and says nothing about the Folk, so the person the DM opened stays open —
  // this was the 403 that contradicted the link right beside it.
  const drawn = await dm.request.put(`/api/campaigns/${campaign.id}/hidden-sheets`, {
    data: { enabled: true },
  });
  expect(drawn.ok(), await drawn.text()).toBeTruthy();
  expect(await doors()).toEqual({ offered: true, given: 200 });

  // And it is not the switch for a body either: the DM is told where the real
  // one is rather than writing a row that decides nothing.
  const wrongSwitch = await dm.request.put(`/api/characters/${bodyId}/reveal`, {
    data: { revealed: true },
  });
  expect(wrongSwitch.status()).toBe(400);
  expect(await wrongSwitch.text()).toContain("Folk page");

  // The DM closes their numbers again. Both doors close together.
  await dm.request.put(`/api/npcs/${npc}/stats-visibility`, {
    data: { scope: "character", characterId: hero, visible: false },
  });
  expect(await doors()).toEqual({ offered: false, given: 404 });

  // The DM reads their own Folk throughout, veils or no veils.
  expect((await dm.request.get(`/api/characters/${bodyId}`)).status()).toBe(200);

  await dmCtx.close();
  await plCtx.close();
});

/*
 * One body, one person (#267). Nothing else ever points at a body, which is
 * what lets parting with it strike it — so two people sharing one is a sheet
 * that dies under somebody still using it, and a body with no single person to
 * be read through.
 */
test("a body stands behind one person and no other", async ({ browser }) => {
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmonebody"));
  const campaign = await createCampaign(dm.request, unique("One Body "));

  const first = (
    await (
      await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, { data: { name: "Elmar" } })
    ).json()
  ).id as string;
  const second = (
    await (
      await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, { data: { name: "Halia" } })
    ).json()
  ).id as string;

  const body = (
    await (
      await dm.request.post(`/api/npcs/${first}/body`, {
        data: { name: "Elmar", class: "Commoner", level: 1, hpCurrent: 9, hpMax: 9 },
      })
    ).json()
  ).characterId as string;

  const stolen = await dm.request.patch(`/api/npcs/${second}`, {
    data: { name: "Halia", characterId: body },
  });
  expect(stolen.status()).toBe(400);
  expect(await stolen.text()).toContain("forged for somebody else");

  // The first person still has them, and re-stating the same link is not theft.
  const same = await dm.request.patch(`/api/npcs/${first}`, {
    data: { name: "Elmar", characterId: body },
  });
  expect(same.ok(), await same.text()).toBeTruthy();

  await ctx.close();
});
