import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  quickAddHero,
  registerViaAPI,
  unique,
} from "./helpers";

/*
Conditions and death saves on the tracker (#173).

The tracker knew where everyone stood in the order and nothing about what was
happening to them. These assert the two rules that are invisible from the DM's
screen and so cannot be caught by looking:

  1. the pips reset themselves when a hero is healed above 0, wherever the heal
     came from — the reset rides on the SQL that writes hit points, not on the
     handler that asked for it;
  2. a player sees a friend's conditions and death saves, because that is the
     question the party asks between turns.

Most of the setup runs through the API — this is about state crossing the
server, not about the picker's chips.
*/

/** Prepare a fight with the party in it and trigger it. Returns its id. */
async function runFight(
  request: APIRequestContext,
  campaignId: string,
  characterId: string,
): Promise<string> {
  const created = await request.post(`/api/campaigns/${campaignId}/encounters`, {
    data: { name: unique("The Last Stand ") },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const encounterId = (await created.json()).id as string;

  const seated = await request.post(`/api/encounters/${encounterId}/combatants`, {
    data: { kind: "pc", characterId },
  });
  expect(seated.ok(), await seated.text()).toBeTruthy();

  // Triggering is a status change, not an endpoint of its own.
  const triggered = await request.patch(`/api/encounters/${encounterId}`, {
    data: { status: "active" },
  });
  expect(triggered.ok(), await triggered.text()).toBeTruthy();
  return encounterId;
}

async function combatants(request: APIRequestContext, encounterId: string) {
  const res = await request.get(`/api/encounters/${encounterId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).combatants as Array<{
    id: string;
    kind: string;
    conditions: string[];
    deathSaves?: { successes: number; failures: number };
  }>;
}

test("a heal above 0 clears the death saves, and does not cure the poison", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("dmcond"));
  const campaign = await createCampaign(page.request, unique("Dying Light "));
  const hero = await quickAddHero(page.request, campaign.id, unique("Vex "));
  const encounterId = await runFight(page.request, campaign.id, hero);

  const [pc] = await combatants(page.request, encounterId);
  expect(pc.kind).toBe("pc");

  // Down, poisoned, and two failures in.
  const down = await page.request.patch(`/api/combatants/${pc.id}`, {
    data: { hpCurrent: 0, conditions: ["Poisoned", "Exhaustion 2"], deathSaveFailures: 2 },
  });
  expect(down.ok(), await down.text()).toBeTruthy();

  let [state] = await combatants(page.request, encounterId);
  expect(state.deathSaves).toEqual({ successes: 0, failures: 2 });
  expect(state.conditions).toEqual(["Poisoned", "Exhaustion 2"]);

  // A cleric gets to them. The tally resets on its own; the poison does not,
  // because being healed is not being cured.
  const healed = await page.request.patch(`/api/combatants/${pc.id}`, { data: { hpCurrent: 9 } });
  expect(healed.ok(), await healed.text()).toBeTruthy();

  [state] = await combatants(page.request, encounterId);
  expect(state.deathSaves).toEqual({ successes: 0, failures: 0 });
  expect(state.conditions).toEqual(["Poisoned", "Exhaustion 2"]);
});

test("the vocabulary is closed, and pips belong to a hero who is down", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("dmvocab"));
  const campaign = await createCampaign(page.request, unique("Closed List "));
  const hero = await quickAddHero(page.request, campaign.id, unique("Rell "));
  const encounterId = await runFight(page.request, campaign.id, hero);
  const [pc] = await combatants(page.request, encounterId);

  // A chip nobody could ever filter on is refused rather than stored.
  const invented = await page.request.patch(`/api/combatants/${pc.id}`, {
    data: { conditions: ["Prone", "On fire"] },
  });
  expect(invented.status()).toBe(400);
  expect((await invented.json()).error).toContain("not a condition");

  // And the refusal is total — the legal half of that request did not land.
  expect((await combatants(page.request, encounterId))[0].conditions).toEqual([]);

  // Pips on a hero standing at full health would be wiped by the next write
  // that touches their hit points, so they are refused up front.
  const standing = await page.request.patch(`/api/combatants/${pc.id}`, {
    data: { deathSaveFailures: 1 },
  });
  expect(standing.status()).toBe(400);
  expect((await standing.json()).error).toContain("0 hit points");
});

test("a player sees what ails their party, and their friend bleeding out", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmparty"));
  const campaign = await createCampaign(dmPage.request, unique("Shared Sight "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  const player = newAccount("plparty");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);

  // The player's own hero is in the fight, which is what puts the tracker on
  // their screen at all (a player only ever sees the battle they stand in).
  const shelf = await plPage.request.post("/api/me/characters", {
    data: { name: unique("Mira "), class: "Hedge Knight", level: 3, hpCurrent: 21, hpMax: 21 },
  });
  expect(shelf.ok(), await shelf.text()).toBeTruthy();
  const heroId = (await shelf.json()).id as string;
  const seated = await plPage.request.put(`/api/characters/${heroId}/seat`, {
    data: { campaignId: campaign.id },
  });
  expect(seated.ok(), await seated.text()).toBeTruthy();

  const encounterId = await runFight(dmPage.request, campaign.id, heroId);
  const [pc] = await combatants(dmPage.request, encounterId);
  const marked = await dmPage.request.patch(`/api/combatants/${pc.id}`, {
    data: { hpCurrent: 0, conditions: ["Poisoned"], deathSaveFailures: 2 },
  });
  expect(marked.ok(), await marked.text()).toBeTruthy();

  // The player's payload carries both. Death saves are one of the very few
  // numbers a player is shown on another row — deliberately, because the table
  // watches a friend go down together.
  const seen = await plPage.request.get(`/api/campaigns/${campaign.id}/encounters/active`);
  expect(seen.ok(), await seen.text()).toBeTruthy();
  const theirs = (await seen.json()).combatants[0];
  expect(theirs.conditions).toEqual(["Poisoned"]);
  expect(theirs.deathSaves).toEqual({ successes: 0, failures: 2 });

  // And it reaches the screen, chips and all.
  await plPage.goto(`/questboard/campaigns/${campaign.id}/encounters`);
  await expect(plPage.getByText("Poisoned")).toBeVisible({ timeout: 20_000 });
});
