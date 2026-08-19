import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  joinCampaign,
  newAccount,
  registerViaAPI,
  seatHero,
  unique,
} from "./helpers";

/*
Allies: the person who walks with the party (#228).

The paper practice is a line in the margin of the party page — "Sildar travels
with you to Phandalin" — present, marked, removable, and never confused with a
PC. #227 took the Folk off the roster; this is what puts one of them back
beside it, deliberately apart.

Three things are worth holding still. A traveler is known to the party by the
act of traveling, and their NUMBERS are not — the bar moves without the block
being handed over. Control is what carries the numbers: whoever runs an ally
reads their sheet and moves their hit points, and a player who does not run
them is answered as if the door were not there. And an ally seated in a fight
mirrors home, so the roster bar the table watches is the same one the tracker
moves.
*/

/** A player's own hero, forged on their shelf and seated at the table. */
async function ownHero(
  request: APIRequestContext,
  campaignId: string,
  name: string,
): Promise<string> {
  const res = await request.post("/api/me/characters", {
    data: { name, class: "Wandering Sellsword", level: 2, hpCurrent: 16, hpMax: 16 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const id = (await res.json()).id as string;
  await seatHero(request, id, campaignId);
  return id;
}

/** Bring in a person carrying a Den stat block, filed in a place. */
async function bringIn(
  request: APIRequestContext,
  campaignId: string,
  name: string,
  locationId: string,
  monster: string,
): Promise<string> {
  const res = await request.post(`/api/campaigns/${campaignId}/npcs`, {
    data: { name, description: "One of the folk.", locationId },
  });
  const npc = (await res.json()).id as string;
  const monsters = await (await request.get("/api/rules/monster")).json();
  const block = (monsters as { id: string; name: string }[]).find((m) => m.name === monster);
  expect(block, `${monster} should be in the Den`).toBeTruthy();
  const patched = await request.patch(`/api/npcs/${npc}`, {
    data: { name, contentId: block!.id },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();
  return npc;
}

test("a traveler is known to the party, watched by it, and run by whoever is handed them", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmally"));
  const campaign = await createCampaign(dm.request, unique("The Triboar Trail "));
  const town = await createLocation(dm.request, campaign.id, unique("Phandalin "));

  const sildar = unique("Sildar ");
  const npcId = await bringIn(dm.request, campaign.id, sildar, town, "Knight");

  // Two players, so "handed to one" can be told from "handed to the table".
  const runnerCtx = await browser.newContext();
  const runner = await runnerCtx.newPage();
  await runner.goto("/");
  const runnerAcct = newAccount("runner");
  await registerViaAPI(runner.request, runnerAcct);
  await joinCampaign(runner.request, campaign.inviteCode);
  await ownHero(runner.request, campaign.id, "Kaelen");

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await other.goto("/");
  await registerViaAPI(other.request, newAccount("other"));
  await joinCampaign(other.request, campaign.inviteCode);
  await ownHero(other.request, campaign.id, "Sera");

  // Veiled and off the roster to begin with: the players have never heard of him.
  expect(await (await runner.request.get(`/api/campaigns/${campaign.id}/npcs`)).json()).toHaveLength(0);

  // --- he sets out with them ----------------------------------------------
  await dm.goto(`/questboard/campaigns/${campaign.id}/npcs`);
  await dm.getByRole("button", { name: "Travels with the party?" }).click();
  await expect(dm.getByRole("button", { name: "Travels with the party", exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // Traveling opened the veil on his existence — but NOT on his numbers.
  const seen = await (await runner.request.get(`/api/campaigns/${campaign.id}/npcs`)).json();
  expect(seen).toHaveLength(1);
  expect(seen[0].traveling).toBe(true);
  expect(seen[0].hpCurrent).toBe(52);
  expect(seen[0].hpMax).toBe(52);
  expect(seen[0].statBlock ?? null).toBeNull();
  expect(seen[0].yoursToRun).toBe(false);

  // He stands on the roster, beside the party and counted among nobody.
  await runner.goto(`/questboard/campaigns/${campaign.id}/party`);
  await expect(runner.getByRole("heading", { name: "Traveling with you" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(runner.getByText(sildar)).toBeVisible();
  await expect(runner.getByLabel(`${sildar} takes 1 damage`)).toHaveCount(0);
  await runner.goto(`/questboard/campaigns/${campaign.id}`);
  await expect(runner.getByText(/^\d+ adventurers?$/)).toHaveText("2 adventurers");

  // A player who does not run him cannot move him — and is told nothing.
  const refused = await runner.request.put(`/api/npcs/${npcId}/hp`, { data: { hpCurrent: 3 } });
  expect(refused.status()).toBe(404);

  // --- the DM hands him to one player -------------------------------------
  await dm.getByLabel(`Who runs ${sildar}`).selectOption({ label: runnerAcct.username });
  await expect(dm.getByText(/they may move their hit points/)).toBeVisible({ timeout: 20_000 });

  const mine = (await (await runner.request.get(`/api/campaigns/${campaign.id}/npcs`)).json())[0];
  expect(mine.yoursToRun).toBe(true);
  // Control carries the numbers: you cannot play someone you may not read.
  expect(mine.statBlock?.name).toBe("Knight");

  // The other player still only watches.
  const theirs = (await (await other.request.get(`/api/campaigns/${campaign.id}/npcs`)).json())[0];
  expect(theirs.yoursToRun).toBe(false);
  expect(theirs.statBlock ?? null).toBeNull();
  expect(theirs.hpCurrent).toBe(52);
  expect((await other.request.put(`/api/npcs/${npcId}/hp`, { data: { hpCurrent: 1 } })).status()).toBe(404);

  // --- and the runner takes his wounds for him ----------------------------
  await runner.goto(`/questboard/campaigns/${campaign.id}/party`);
  await expect(runner.getByLabel(`${sildar} takes 1 damage`)).toBeVisible({ timeout: 20_000 });
  await runner.getByLabel(`${sildar} takes 1 damage`).click();
  await expect(runner.getByText("51/52")).toBeVisible({ timeout: 20_000 });

  // The whole table can be handed him too.
  await dm.getByLabel(`Who runs ${sildar}`).selectOption("table");
  await expect
    .poll(async () => (await (await other.request.get(`/api/campaigns/${campaign.id}/npcs`)).json())[0].yoursToRun)
    .toBe(true);

  // Calling him home puts him back in the DM's hands...
  await dm.getByRole("button", { name: "Travels with the party", exact: true }).click();
  await expect
    .poll(async () =>
      (await (await dm.request.get(`/api/campaigns/${campaign.id}/npcs`)).json())[0].traveling,
    )
    .toBe(false);
  const home = (await (await dm.request.get(`/api/campaigns/${campaign.id}/npcs`)).json())[0];
  expect(home.control).toBe("dm");
  // He stays known to the party — nobody forgets who they travelled with —
  // but his home town is still veiled, and once he is no longer walking
  // beside them the place tree has the final word again.
  expect(home.visibleToParty).toBe(true);
  expect(await (await runner.request.get(`/api/campaigns/${campaign.id}/npcs`)).json()).toHaveLength(0);

  await dmCtx.close();
  await runnerCtx.close();
  await otherCtx.close();
});

test("an ally seated in a fight is named to the party, and their wounds follow them home", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("dmfight"));
  const campaign = await createCampaign(dm.request, unique("Cragmaw Hideout "));
  const town = await createLocation(dm.request, campaign.id, unique("Neverwinter "));
  const sildar = unique("Sildar ");
  const npcId = await bringIn(dm.request, campaign.id, sildar, town, "Knight");
  await dm.request.put(`/api/npcs/${npcId}/travel`, { data: { traveling: true } });

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("plfight"));
  await joinCampaign(pl.request, campaign.inviteCode);
  const kaelen = await ownHero(pl.request, campaign.id, "Kaelen");

  const enc = await (
    await dm.request.post(`/api/campaigns/${campaign.id}/encounters`, {
      data: { name: "Goblin Ambush" },
    })
  ).json();

  // Only a traveler may be called in.
  const stranger = await (
    await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, { data: { name: "A Stranger" } })
  ).json();
  const refused = await dm.request.post(`/api/encounters/${enc.id}/combatants`, {
    data: { kind: "ally", npcId: stranger.id },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toMatch(/walking with the party/);

  const added = await dm.request.post(`/api/encounters/${enc.id}/combatants`, {
    data: { kind: "ally", npcId },
  });
  expect(added.ok(), await added.text()).toBeTruthy();
  const [combatant] = await added.json();
  expect(combatant.hpMax).toBe(52);
  expect(combatant.npcId).toBe(npcId);

  // One ally, one fight — the same rule a hero keeps, because both mirror home.
  const second = await (
    await dm.request.post(`/api/campaigns/${campaign.id}/encounters`, { data: { name: "Another" } })
  ).json();
  const triggered = await dm.request.patch(`/api/encounters/${enc.id}`, {
    data: { status: "active" },
  });
  expect(triggered.ok(), await triggered.text()).toBeTruthy();
  const twice = await dm.request.post(`/api/encounters/${second.id}/combatants`, {
    data: { kind: "ally", npcId },
  });
  expect(twice.status()).toBe(400);

  // The party reads their traveler's real name, not "Unknown". (A player is
  // shown the fight their own hero stands in, so seat them beside him.)
  const seated = await dm.request.post(`/api/encounters/${enc.id}/combatants`, {
    data: { kind: "pc", characterId: kaelen },
  });
  expect(seated.ok(), await seated.text()).toBeTruthy();
  const active = await pl.request.get(`/api/campaigns/${campaign.id}/encounters/active`);
  expect(active.ok(), await active.text()).toBeTruthy();
  const seenByPlayer = await active.json();
  const line = seenByPlayer.combatants.find((c: { kind: string }) => c.kind === "ally");
  expect(line.name).toBe(sildar);

  // A wound in the tracker follows him back to the roster bar.
  const hit = await dm.request.patch(`/api/combatants/${combatant.id}`, {
    data: { hpCurrent: 30, hpMax: 52, ac: combatant.ac, initiative: null, label: combatant.name },
  });
  expect(hit.ok(), await hit.text()).toBeTruthy();
  await expect
    .poll(async () => {
      const all = await (await pl.request.get(`/api/campaigns/${campaign.id}/npcs`)).json();
      return all.find((n: { id: string }) => n.id === npcId).hpCurrent;
    })
    .toBe(30);

  await dmCtx.close();
  await plCtx.close();
});
