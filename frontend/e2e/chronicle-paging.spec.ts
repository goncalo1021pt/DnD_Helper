import { expect, test, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Reading the chronicle back past its newest page (#424): a cursor and a date
window, both applied in the query. What is worth pinning is that walking back
page by page reads every line exactly once and in order, that a window is exact
rather than the newest lines filtered afterwards, that a cursor is only ever a
line of this table, and that a line the veil withholds does not break the walk.
*/

type Line = { id: string; message: string; createdAt: string };

const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function page(ctx: APIRequestContext, campaignId: string, query: string): Promise<Line[]> {
  const res = await ctx.get(`/api/campaigns/${campaignId}/events?${query}`);
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

/** Walk the whole chronicle `size` lines at a time, as a client reading back would. */
async function walk(ctx: APIRequestContext, campaignId: string, size: number): Promise<Line[]> {
  const all: Line[] = [];
  let before = "";
  for (let i = 0; i < 100; i++) {
    const got = await page(ctx, campaignId, `limit=${size}${before}`);
    if (got.length === 0) return all;
    all.push(...got);
    before = `&before=${got[got.length - 1].id}`;
  }
  throw new Error("the chronicle never ended");
}

test("walking back page by page reads every line once, in order, and a window is exact", async () => {
  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("pgdm"));
  const campaign = await createCampaign(dm, unique("Long Campaign "));
  const other = await createCampaign(dm, unique("Elsewhere "));

  const pl = await playwrightRequest.newContext();
  await registerViaAPI(pl, newAccount("pgpl"));
  await joinCampaign(pl, campaign.inviteCode);

  for (let i = 1; i <= 7; i++) {
    const res = await dm.post(`/api/campaigns/${campaign.id}/events`, { data: { message: `Line ${i}` } });
    expect(res.status(), await res.text()).toBe(201);
  }
  // A prop brought to the table writes a line a player will not be offered once it is withdrawn.
  const prop = await dm.post(`/api/campaigns/${campaign.id}/handouts`, {
    data: { title: "A burned sigil", caption: "Sealed in red wax", imageBase64: PIXEL_PNG, visibleToParty: true },
  });
  expect(prop.ok(), await prop.text()).toBeTruthy();
  const propId = (await prop.json()).id as string;
  const gone = await dm.put(`/api/handouts/${propId}/visibility`, { data: { scope: "table", visible: false } });
  expect(gone.ok(), await gone.text()).toBeTruthy();
  await dm.post(`/api/campaigns/${campaign.id}/events`, { data: { message: "Line 8" } });

  // --- the cursor -----------------------------------------------------------
  const whole = await page(dm, campaign.id, "limit=200");
  expect(whole.length).toBeGreaterThanOrEqual(8);
  for (const size of [1, 3, 5]) {
    const walked = await walk(dm, campaign.id, size);
    expect(walked.map((l) => l.id), `walking ${size} at a time`).toEqual(whole.map((l) => l.id));
  }
  // The same walk for a player passes the withheld line without skipping or repeating another.
  const theirs = await page(pl, campaign.id, "limit=200");
  expect(theirs.length).toBeLessThan(whole.length);
  expect((await walk(pl, campaign.id, 2)).map((l) => l.id)).toEqual(theirs.map((l) => l.id));

  // --- the window -----------------------------------------------------------
  const newest = whole[0].createdAt;
  const oldest = whole[whole.length - 1].createdAt;
  expect((await page(dm, campaign.id, `since=${encodeURIComponent(newest)}`)).length).toBeGreaterThanOrEqual(1);
  expect(await page(dm, campaign.id, "since=2999-01-01T00:00:00Z")).toEqual([]);
  expect(await page(dm, campaign.id, "until=2000-01-01T00:00:00Z")).toEqual([]);
  // `until` is exclusive and `since` inclusive: a window from the oldest line to the newest holds all but the newest.
  const inside = await page(dm, campaign.id, `limit=200&since=${encodeURIComponent(oldest)}&until=${encodeURIComponent(newest)}`);
  expect(inside.map((l) => l.id)).toEqual(whole.slice(1).map((l) => l.id));
  const backwards = await dm.get(`/api/campaigns/${campaign.id}/events?since=${encodeURIComponent(newest)}&until=${encodeURIComponent(oldest)}`);
  expect(backwards.status()).toBe(400);

  // --- a cursor is a line of this table -----------------------------------
  await dm.post(`/api/campaigns/${other.id}/events`, { data: { message: "Somewhere else" } });
  const foreign = (await page(dm, other.id, "limit=1"))[0];
  const stray = await dm.get(`/api/campaigns/${campaign.id}/events?before=${foreign.id}`);
  expect(stray.status()).toBe(400);
  const nowhere = await dm.get(`/api/campaigns/${campaign.id}/events?before=00000000-0000-4000-8000-000000000000`);
  expect(nowhere.status()).toBe(400);

  await dm.dispose();
  await pl.dispose();
});
