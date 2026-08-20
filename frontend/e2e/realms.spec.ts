import { expect, test, type APIRequestContext } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Realms: the ground a campaign stands on, and outlives it (#233).

Stage one is the container and nothing else — two campaigns in one realm see
nothing whatever of each other — so what there is to prove is mostly about what
did NOT change. Every table that existed got a realm of its own, named after
it, and reads exactly as it always did; the realm only becomes something you
notice once a second campaign stands on the same ground.

The other half is who the ground belongs to. A realm is its owner's, not the
table's: players read its NAME off their campaign and cannot list, rename, move
into or strike one, and another DM's realms are answered as if they were not
there rather than refused.
*/

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

async function realms(request: APIRequestContext) {
  const res = await request.get("/api/realms");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: string; name: string; campaignCount: number }[];
}

test("a table founded on its own ground reads exactly as it always did", async ({ browser }) => {
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("realmsolo"));

  const name = unique("Lost Mine ");
  const campaign = await createCampaign(dm.request, name);

  // It stands somewhere, and that somewhere is named after it.
  expect(campaign.realmId).toBeTruthy();
  expect(campaign.realmName).toBe(name);

  const mine = await realms(dm.request);
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ id: campaign.realmId, name, campaignCount: 1 });

  // And the ledger says nothing about it: one campaign on its own ground is a
  // private container, not a place worth announcing.
  await dm.goto("/questboard");
  await expect(dm.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  await expect(dm.getByRole("button", { name: "Rename the realm" })).toHaveCount(0);
  await expect(dm.getByText(/campaigns on this ground/)).toHaveCount(0);

  // Nor does the campaign header, which would otherwise read "in Lost Mine".
  await dm.goto(`/questboard/campaigns/${campaign.id}`);
  await expect(dm.getByText("Campaign", { exact: true })).toBeVisible({ timeout: 15_000 });

  await ctx.close();
});

test("a second campaign on the same ground makes the realm a place", async ({ browser }) => {
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("realmshare"));

  const first = await createCampaign(dm.request, unique("Curse of Strahd "));
  const second = await (
    await dm.request.post("/api/campaigns", {
      data: { name: unique("Death House "), realmId: first.realmId },
    })
  ).json();
  expect(second.realmId).toBe(first.realmId);

  const mine = await realms(dm.request);
  expect(mine).toHaveLength(1);
  expect(mine[0].campaignCount).toBe(2);

  // Now the ledger bands them, and the heading can be named.
  await dm.goto("/questboard");
  await expect(dm.getByText("2 campaigns on this ground")).toBeVisible({ timeout: 15_000 });
  await dm.getByRole("button", { name: "Rename the realm" }).click();
  await dm.getByLabel("Name of the realm").fill("Barovia");
  await dm.getByRole("button", { name: "Name it" }).click();
  // The heading, not the founding form's picker — the renamed realm shows up
  // in both, which is itself the point: it is now somewhere to found a table.
  await expect(dm.getByText("Barovia").first()).toBeVisible({ timeout: 15_000 });
  await expect(dm.getByLabel("On what ground")).toContainText("Barovia");

  // And both campaigns now say where they stand — including for a player, who
  // reads the name off the campaign and has no other door to it.
  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("realmpl"));
  await joinCampaign(pl.request, first.inviteCode);

  await pl.goto(`/questboard/campaigns/${first.id}`);
  await expect(pl.getByText("Campaign in Barovia")).toBeVisible({ timeout: 15_000 });

  // The name is all they get. The list, the rename and the move are not theirs.
  expect((await pl.request.get("/api/realms")).status()).toBe(200);
  expect(await (await pl.request.get("/api/realms")).json()).toEqual([]);
  const rename = await pl.request.patch(`/api/realms/${first.realmId}`, {
    data: { name: "Not Yours" },
  });
  expect(rename.status()).toBe(404);
  const move = await pl.request.put(`/api/campaigns/${first.id}/realm`, {
    data: { realmId: NIL_UUID },
  });
  expect(move.status()).toBe(403);

  await plCtx.close();
  await ctx.close();
});

test("a campaign can be moved onto other ground, and back onto its own", async ({ browser }) => {
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("realmmove"));

  const home = await createCampaign(dm.request, unique("Waterdeep "));
  const wanderer = await createCampaign(dm.request, unique("Undermountain "));
  expect(await realms(dm.request)).toHaveLength(2);

  // Onto the other's ground. The realm it left was never named, so it is a
  // container nobody made — swept, rather than left to clutter the picker.
  const moved = await dm.request.put(`/api/campaigns/${wanderer.id}/realm`, {
    data: { realmId: home.realmId },
  });
  expect(moved.ok(), await moved.text()).toBeTruthy();
  expect((await moved.json()).realmId).toBe(home.realmId);

  const after = await realms(dm.request);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: home.realmId, campaignCount: 2 });

  // Back onto ground of its own: a fresh realm named after the campaign, the
  // same thing founding a table does by default.
  const back = await dm.request.put(`/api/campaigns/${wanderer.id}/realm`, {
    data: { realmId: NIL_UUID },
  });
  expect(back.ok(), await back.text()).toBeTruthy();
  const body = await back.json();
  expect(body.realmId).not.toBe(home.realmId);
  expect(body.realmName).toBe(wanderer.name);
  expect(await realms(dm.request)).toHaveLength(2);

  await ctx.close();
});

test("a realm is its owner's, and holds its campaigns against deletion", async ({ browser }) => {
  const mineCtx = await browser.newContext();
  const mine = await mineCtx.newPage();
  await mine.goto("/");
  await registerViaAPI(mine.request, newAccount("realmowner"));
  const campaign = await createCampaign(mine.request, unique("Icewind Dale "));

  // A realm with a campaign in it is never a sideways way to delete it.
  const held = await mine.request.delete(`/api/realms/${campaign.realmId}`);
  expect(held.status()).toBe(400);
  expect(await held.text()).toContain("move or strike them first");

  // Another DM's realm is answered as if it were not there.
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await other.goto("/");
  await registerViaAPI(other.request, newAccount("realmother"));
  const theirs = await createCampaign(other.request, unique("Chult "));

  expect((await other.request.patch(`/api/realms/${campaign.realmId}`, {
    data: { name: "Stolen" },
  })).status()).toBe(404);
  expect((await other.request.delete(`/api/realms/${campaign.realmId}`)).status()).toBe(404);

  // Nor can they found a table on it, or move one onto it.
  const founded = await other.request.post("/api/campaigns", {
    data: { name: "Trespass", realmId: campaign.realmId },
  });
  expect(founded.status()).toBe(400);
  expect(await founded.text()).toContain("not one of yours");
  const moved = await other.request.put(`/api/campaigns/${theirs.id}/realm`, {
    data: { realmId: campaign.realmId },
  });
  expect(moved.status()).toBe(404);

  await otherCtx.close();
  await mineCtx.close();
});

/*
 * The reset. This is the shape #233 exists for: a campaign measured in years
 * ends, and the next one begins on the same ground — so a NAMED realm has to
 * outlive its campaigns. An unnamed one must not: it is nothing but the dead
 * campaign's name, and it would go on offering itself in the founding picker
 * forever.
 */
test("a named realm outlives its campaigns; an unnamed one goes with them", async ({ browser }) => {
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("realmreset"));

  const doomed = await createCampaign(dm.request, unique("Unnamed Ground "));
  const kept = await createCampaign(dm.request, unique("First Age "));
  const renamed = await dm.request.patch(`/api/realms/${kept.realmId}`, {
    data: { name: "Eberron" },
  });
  expect(renamed.ok(), await renamed.text()).toBeTruthy();
  expect(await realms(dm.request)).toHaveLength(2);

  // The unnamed one dies with its table.
  expect((await dm.request.delete(`/api/campaigns/${doomed.id}`)).status()).toBe(204);
  let left = await realms(dm.request);
  expect(left.map((r) => r.id)).toEqual([kept.realmId]);

  // The named one stands, empty, waiting.
  expect((await dm.request.delete(`/api/campaigns/${kept.id}`)).status()).toBe(204);
  left = await realms(dm.request);
  expect(left).toHaveLength(1);
  expect(left[0]).toMatchObject({ id: kept.realmId, name: "Eberron", campaignCount: 0 });

  // And the next age begins on it.
  const second = await (
    await dm.request.post("/api/campaigns", {
      data: { name: unique("Second Age "), realmId: kept.realmId },
    })
  ).json();
  expect(second.realmId).toBe(kept.realmId);
  expect(second.realmName).toBe("Eberron");

  await ctx.close();
});
