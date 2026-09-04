import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { createCampaign, createLocation, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Co-DMs and ownership (#299).

A table has an owner and it has DMs, and they are no longer the same person by
accident. The rules worth guarding:

  - the OWNER appoints the screen: only they may make or unmake a DM;
  - a DM RUNS the table — every DM door opens for them;
  - nobody removes or demotes the owner; a DM is removed only by the owner;
    a co-DM may walk away, the owner may not;
  - only the owner ends the table;
  - handing the table over: the new owner becomes owner and DM, the old one
    stays a DM. A campaign ALONE in its realm takes the realm with it, atlas and
    all; one sharing a realm with the owner's other campaigns steps onto fresh
    ground of the new owner's — a world cannot be split.
*/

async function person(browser: Browser, prefix: string): Promise<{ page: Page; id: string }> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount(prefix));
  const me = (await (await page.request.get("/api/me")).json()) as { user: { id: string } };
  return { page, id: me.user.id };
}

async function roleAt(request: APIRequestContext, campaignId: string): Promise<string | null> {
  const me = (await (await request.get("/api/me")).json()) as {
    campaigns: Array<{ campaign: { id: string }; role: string }>;
  };
  return me.campaigns.find((m) => m.campaign.id === campaignId)?.role ?? null;
}

const setRole = (request: APIRequestContext, campaignId: string, userId: string, role: string) =>
  request.put(`/api/campaigns/${campaignId}/members/${userId}/role`, { data: { role } });

const chart = (request: APIRequestContext, campaignId: string) =>
  request.post(`/api/campaigns/${campaignId}/locations`, { data: { name: unique("Place "), parentId: null } });

test("the owner appoints the screen; DMs run the table; only the owner ends it (#299)", async ({
  browser,
}) => {
  const owner = await person(browser, "own");
  const p1 = await person(browser, "codm");
  const p2 = await person(browser, "pl");
  const c = await createCampaign(owner.page.request, unique("Two Screens "));
  await joinCampaign(p1.page.request, c.inviteCode);
  await joinCampaign(p2.page.request, c.inviteCode);

  // A player has no DM door.
  expect((await chart(p1.page.request, c.id)).status()).toBe(403);

  // The owner hands p1 the screen; every DM door opens for them.
  const promoted = await setRole(owner.page.request, c.id, p1.id, "dm");
  expect(promoted.ok(), await promoted.text()).toBeTruthy();
  expect((await promoted.json()).role).toBe("dm");
  expect((await promoted.json()).isOwner).toBe(false);
  expect(await roleAt(p1.page.request, c.id)).toBe("dm");
  expect((await chart(p1.page.request, c.id)).status()).toBe(201);

  // The roster says who holds the table.
  const roster = (await (await p1.page.request.get(`/api/campaigns/${c.id}/members`)).json()) as Array<{
    userId: string; role: string; isOwner: boolean;
  }>;
  expect(roster.find((m) => m.userId === owner.id)).toMatchObject({ role: "dm", isOwner: true });
  expect(roster.find((m) => m.userId === p1.id)).toMatchObject({ role: "dm", isOwner: false });

  // A co-DM cannot appoint, cannot touch the owner, but runs players.
  expect((await setRole(p1.page.request, c.id, p2.id, "dm")).status()).toBe(403);
  expect((await p1.page.request.delete(`/api/campaigns/${c.id}/members/${owner.id}`)).status()).toBe(400);
  expect((await p1.page.request.post(`/api/campaigns/${c.id}/bans`, { data: { userId: owner.id } })).status()).toBe(400);
  expect((await p1.page.request.delete(`/api/campaigns/${c.id}/members/${p2.id}`)).status()).toBe(204);
  await joinCampaign(p2.page.request, c.inviteCode);

  // Two DMs: one may not remove the other; the owner may.
  expect((await setRole(owner.page.request, c.id, p2.id, "dm")).ok()).toBeTruthy();
  expect((await p1.page.request.delete(`/api/campaigns/${c.id}/members/${p2.id}`)).status()).toBe(403);
  expect((await owner.page.request.delete(`/api/campaigns/${c.id}/members/${p2.id}`)).status()).toBe(204);

  // The owner's own role is not a thing to change; the table is handed over.
  expect((await setRole(owner.page.request, c.id, owner.id, "player")).status()).toBe(400);

  // Only the owner ends the table; a co-DM may walk away, the owner may not.
  expect((await p1.page.request.delete(`/api/campaigns/${c.id}`)).status()).toBe(403);
  expect((await owner.page.request.post(`/api/campaigns/${c.id}/leave`)).status()).toBe(400);
  expect((await p1.page.request.post(`/api/campaigns/${c.id}/leave`)).status()).toBe(204);
  expect(await roleAt(p1.page.request, c.id)).toBeNull();

  // Taking the screen back closes the DM doors again.
  await joinCampaign(p1.page.request, c.inviteCode);
  expect((await setRole(owner.page.request, c.id, p1.id, "dm")).ok()).toBeTruthy();
  expect((await setRole(owner.page.request, c.id, p1.id, "player")).ok()).toBeTruthy();
  expect(await roleAt(p1.page.request, c.id)).toBe("player");
  expect((await chart(p1.page.request, c.id)).status()).toBe(403);

  expect((await owner.page.request.delete(`/api/campaigns/${c.id}`)).status()).toBe(204);
});

test("handing over a table alone in its realm takes the realm with it; a shared one steps onto fresh ground (#299)", async ({
  browser,
}) => {
  const owner = await person(browser, "hand");
  const heir = await person(browser, "heir");

  // Alone in its realm: the realm — atlas and all — goes with the table.
  const d = await createCampaign(owner.page.request, unique("First Ride "));
  await createLocation(owner.page.request, d.id, "Vallaki");
  await joinCampaign(heir.page.request, d.inviteCode);
  const handed = await owner.page.request.post(`/api/campaigns/${d.id}/owner`, { data: { userId: heir.id } });
  expect(handed.ok(), await handed.text()).toBeTruthy();
  const after = (await handed.json()) as { ownerUserId: string; realmId: string };
  expect(after.ownerUserId).toBe(heir.id);
  expect(after.realmId).toBe(d.realmId);
  // The heir owns the ground now; the old owner no longer does.
  expect((await heir.page.request.patch(`/api/realms/${d.realmId}`, { data: { name: unique("Barovia ") } })).ok()).toBeTruthy();
  expect((await owner.page.request.patch(`/api/realms/${d.realmId}`, { data: { name: "Mine" } })).status()).toBe(404);
  // The heir is owner and DM, with the atlas intact; the old owner stays a DM.
  expect(await roleAt(heir.page.request, d.id)).toBe("dm");
  const places = (await (await heir.page.request.get(`/api/campaigns/${d.id}/locations`)).json()) as Array<{ name: string }>;
  expect(places.map((p) => p.name)).toContain("Vallaki");
  expect(await roleAt(owner.page.request, d.id)).toBe("dm");
  expect((await chart(owner.page.request, d.id)).status()).toBe(201);
  expect((await owner.page.request.delete(`/api/campaigns/${d.id}`)).status()).toBe(403);
  expect((await heir.page.request.delete(`/api/campaigns/${d.id}`)).status()).toBe(204);

  // Sharing a realm with the owner's other table: the handed campaign steps
  // onto fresh ground of the heir's; the world stays whole with its owner.
  const a = await createCampaign(owner.page.request, unique("Thursday "));
  const b = (await (
    await owner.page.request.post("/api/campaigns", { data: { name: unique("One-shot "), realmId: a.realmId } })
  ).json()) as { id: string; realmId: string; inviteCode: string };
  expect(b.realmId).toBe(a.realmId);
  await createLocation(owner.page.request, a.id, "Porto");
  await joinCampaign(heir.page.request, b.inviteCode);
  const moved = (await (
    await owner.page.request.post(`/api/campaigns/${b.id}/owner`, { data: { userId: heir.id } })
  ).json()) as { ownerUserId: string; realmId: string };
  expect(moved.ownerUserId).toBe(heir.id);
  expect(moved.realmId).not.toBe(a.realmId);
  expect((await heir.page.request.patch(`/api/realms/${moved.realmId}`, { data: { name: unique("Fresh ") } })).ok()).toBeTruthy();
  const heirs = (await (await heir.page.request.get(`/api/campaigns/${b.id}/locations`)).json()) as Array<{ name: string }>;
  expect(heirs.map((p) => p.name)).not.toContain("Porto");
  const owners = (await (await owner.page.request.get(`/api/campaigns/${a.id}/locations`)).json()) as Array<{ name: string }>;
  expect(owners.map((p) => p.name)).toContain("Porto");
});
