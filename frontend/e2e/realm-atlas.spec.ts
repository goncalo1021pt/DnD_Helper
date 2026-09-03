import { expect, test, type APIRequestContext } from "@playwright/test";
import { createCampaign, createLocation, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
The atlas moves up (#234): two campaigns on one realm walk the same ground,
each behind its own veil and its own fog.

  - the DM charts a place and hangs a map ONCE, from campaign A; campaign B,
    founded on the same realm, sees the same rows — veiled, until B's DM says;
  - the veil is per table: revealing a place at A tells B's players nothing,
    and revealing it at B is B's own act;
  - fog is per table: A's stamps never light B's copy of the same map;
  - the lens is the resource's gate: the same map read through a campaign on
    another realm is 404, not 403 — a map you do not stand on cannot be told
    from one that never was;
  - a NAMED realm keeps its atlas after its last campaign is struck, and the
    next campaign founded there inherits it; an unnamed one sweeps as before.
*/

// A 1×1 PNG: the smallest picture the map upload accepts.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function foundOn(request: APIRequestContext, name: string, realmId: string) {
  const res = await request.post("/api/campaigns", { data: { name, realmId } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: string; realmId: string; inviteCode: string };
}

async function hangMap(request: APIRequestContext, campaignId: string, name: string) {
  const res = await request.post(`/api/campaigns/${campaignId}/maps`, {
    data: { name, imageBase64: PNG, visibleToParty: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

async function placesOf(request: APIRequestContext, campaignId: string) {
  const res = await request.get(`/api/campaigns/${campaignId}/locations`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Array<{ id: string; name: string; realmId: string; visibleToParty?: boolean }>;
}

async function mapThrough(request: APIRequestContext, mapId: string, campaignId: string) {
  return request.get(`/api/maps/${mapId}?campaignId=${campaignId}`);
}

test("two tables on one realm walk the same ground behind their own veils and fog (#234)", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const plCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await plCtx.newPage();

  // One DM, two campaigns on one realm.
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("realm-dm"));
  const a = await createCampaign(dm.request, unique("Thursday "));
  const b = await foundOn(dm.request, unique("One-shot "), a.realmId);
  expect(b.realmId).toBe(a.realmId);

  // Charted and hung once, from A.
  const porto = await createLocation(dm.request, a.id, "Porto");
  const crypt = await hangMap(dm.request, a.id, "The Crypt");
  const fogOn = await dm.request.patch(`/api/maps/${crypt}?campaignId=${a.id}`, {
    data: { name: "The Crypt", fogEnabled: true },
  });
  expect(fogOn.ok(), await fogOn.text()).toBeTruthy();
  const stamped = await dm.request.post(`/api/maps/${crypt}/reveals?campaignId=${a.id}`, {
    data: { circles: [{ x: 0.5, y: 0.5, r: 0.2 }] },
  });
  expect(stamped.ok(), await stamped.text()).toBeTruthy();

  // The same rows stand on B's ground — the DM sees them, veiled for B.
  const bPlaces = await placesOf(dm.request, b.id);
  expect(bPlaces.map((p) => p.name)).toContain("Porto");
  expect(bPlaces.find((p) => p.name === "Porto")!.realmId).toBe(a.realmId);
  expect(bPlaces.find((p) => p.name === "Porto")!.visibleToParty).toBe(false);

  // Revealing Porto AT A is A's knowledge alone.
  const atA = await dm.request.put(`/api/locations/${porto}/visibility?campaignId=${a.id}`, {
    data: { scope: "table", visible: true },
  });
  expect(atA.ok(), await atA.text()).toBeTruthy();
  expect((await placesOf(dm.request, a.id)).find((p) => p.name === "Porto")!.visibleToParty).toBe(true);
  expect((await placesOf(dm.request, b.id)).find((p) => p.name === "Porto")!.visibleToParty).toBe(false);

  // A player at B starts dark: no place, and the map is not there to be had.
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("realm-pl"));
  await joinCampaign(player.request, b.inviteCode);
  expect((await placesOf(player.request, b.id)).map((p) => p.name)).not.toContain("Porto");
  expect((await mapThrough(player.request, crypt, b.id)).status()).toBe(404);
  // …and cannot read it through a table they are not seated at.
  expect((await mapThrough(player.request, crypt, a.id)).status()).toBe(403);

  // B's DM reveals Porto and the map for B — B's own act.
  for (const url of [
    `/api/locations/${porto}/visibility?campaignId=${b.id}`,
    `/api/maps/${crypt}/visibility?campaignId=${b.id}`,
  ]) {
    const res = await dm.request.put(url, { data: { scope: "table", visible: true } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  expect((await placesOf(player.request, b.id)).map((p) => p.name)).toContain("Porto");
  const throughB = await mapThrough(player.request, crypt, b.id);
  expect(throughB.status()).toBe(200);
  // Fog is per table: A stamped, B has lifted nothing.
  expect(((await throughB.json()).revealed as unknown[]).length).toBe(0);
  expect((((await (await mapThrough(dm.request, crypt, a.id)).json()).revealed) as unknown[]).length).toBe(1);
  expect((((await (await mapThrough(dm.request, crypt, b.id)).json()).revealed) as unknown[]).length).toBe(0);

  // The lens is the gate: a campaign on another realm cannot see it at all.
  const c = await createCampaign(dm.request, unique("Elsewhere "));
  expect((await mapThrough(dm.request, crypt, c.id)).status()).toBe(404);
  expect((await placesOf(dm.request, c.id)).map((p) => p.name)).not.toContain("Porto");

  await dmCtx.close();
  await plCtx.close();
});

test("a named realm keeps its atlas after its last campaign is struck; an unnamed one sweeps (#234)", async ({
  page,
}) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("keep-dm"));

  // Named: the ground outlives the table, and the next table founded there
  // inherits it.
  const d = await createCampaign(page.request, unique("First Ride "));
  const named = await page.request.patch(`/api/realms/${d.realmId}`, { data: { name: unique("Barovia ") } });
  expect(named.ok(), await named.text()).toBeTruthy();
  await createLocation(page.request, d.id, "Vallaki");
  const chart = await hangMap(page.request, d.id, "Vallaki, by night");
  const struck = await page.request.delete(`/api/campaigns/${d.id}`);
  expect(struck.ok(), await struck.text()).toBeTruthy();

  const e = await foundOn(page.request, unique("Second Ride "), d.realmId);
  expect((await placesOf(page.request, e.id)).map((p) => p.name)).toContain("Vallaki");
  const atlas = (await (await page.request.get(`/api/campaigns/${e.id}/maps`)).json()) as Array<{ id: string }>;
  expect(atlas.map((m) => m.id)).toContain(chart);

  // Unnamed: the automatic realm every campaign gets still goes with it.
  const f = await createCampaign(page.request, unique("Lone Table "));
  await createLocation(page.request, f.id, "Nowhere");
  expect((await page.request.delete(`/api/campaigns/${f.id}`)).ok()).toBeTruthy();
  const again = await page.request.post("/api/campaigns", { data: { name: unique("Ghost "), realmId: f.realmId } });
  expect(again.ok()).toBeFalsy();
});
