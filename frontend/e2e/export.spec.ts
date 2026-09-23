import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createCampaign, forgeHero, joinCampaign, newAccount, postQuest, registerViaAPI, seatHero, unique } from "./helpers";

/*
Everything you own, as one document (#317).

What is worth pinning: the document is the screen's own reading — a player's
table carries the visible notice and not the draft, the DM's carries both —
images are links rather than bytes, a hero arrives as its sheet reads, and a
token gets only the sections its scopes could read, the rest named.
*/

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type Export = {
  exportVersion: number;
  omitted: string[];
  account: { user: { id: string; name: string }; friends: unknown; threads: unknown[] };
  heroes?: Array<{ sheet: { character: { id: string; name: string; hitDice?: unknown; sheet?: { abilities?: unknown } }; items?: unknown[] } }>;
  campaigns?: Array<{
    campaign: { id: string; name: string };
    role: string;
    members: unknown[];
    quests: Array<{ title: string }>;
    maps: Array<{ map: { map: { id: string } }; imageUrl: string }>;
    handouts: Array<{ handout: { id: string }; imageUrl: string }>;
    chronicle: unknown[];
  }>;
  homebrew?: { entries: unknown[] };
};

async function exportOf(ctx: APIRequestContext): Promise<Export> {
  const res = await ctx.get("/api/me/export");
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Export;
}

test("the document is the screen's own reading, and a token gets only what its scopes could read", async ({ page }) => {
  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("dm"));
  const campaign = await createCampaign(dm, unique("Table "));
  const visible = await postQuest(dm, campaign.id, "Rats in the cellar");
  const draft = await dm.post(`/api/campaigns/${campaign.id}/quests`, { data: { title: "The dragon", locationId: null, visibleToParty: false } });
  expect(draft.status(), await draft.text()).toBe(201);
  const map = await dm.post(`/api/campaigns/${campaign.id}/maps`, { data: { name: "The cellar", imageBase64: PNG_1x1, visibleToParty: true } });
  expect(map.status(), await map.text()).toBe(201);
  const handout = await dm.post(`/api/campaigns/${campaign.id}/handouts`, { data: { title: "A letter", caption: "", imageBase64: PNG_1x1, visibleToParty: true } });
  expect(handout.status(), await handout.text()).toBe(201);

  // The player, with a hero at the table.
  await registerViaAPI(page.request, newAccount("pl"));
  await joinCampaign(page.request, campaign.inviteCode);
  const heroId = await forgeHero(page.request, {
    name: unique("Grash "),
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });
  await seatHero(page.request, heroId, campaign.id);

  const mine = await exportOf(page.request);
  expect(mine.exportVersion).toBe(1);
  expect(mine.omitted).toEqual([]);
  expect(mine.account.user.name).toMatch(/^pl/);
  expect(mine.heroes?.map((h) => h.sheet.character.id)).toEqual([heroId]);
  // The sheet's own reading, derived facts included: hit dice are recomputed
  // from the class rows on every read, never stored.
  expect(mine.heroes?.[0].sheet.character.hitDice, "derived hit dice ride along").toBeTruthy();
  expect(mine.heroes?.[0].sheet.character.sheet?.abilities, "the forged sheet rides along").toBeTruthy();
  expect(Array.isArray(mine.heroes?.[0].sheet.items)).toBeTruthy();
  expect(mine.campaigns).toHaveLength(1);
  const table = mine.campaigns![0];
  expect(table.role).toBe("player");
  expect(table.quests.map((q) => q.title)).toEqual(["Rats in the cellar"]);
  expect(table.members).toHaveLength(2);
  expect(table.maps).toHaveLength(1);
  expect(table.maps[0].imageUrl).toBe(`/api/maps/${table.maps[0].map.map.id}/image?campaignId=${campaign.id}`);
  expect(table.handouts[0].imageUrl).toBe(`/api/handouts/${table.handouts[0].handout.id}/image`);
  expect(table.chronicle.length).toBeGreaterThan(0);
  expect(Array.isArray(mine.homebrew?.entries)).toBeTruthy();
  // The link is a real door, with the veil checked again on fetch.
  expect((await page.request.get(table.maps[0].imageUrl)).status()).toBe(200);

  // The DM's document carries the draft.
  const theirs = await exportOf(dm);
  expect(theirs.campaigns![0].role).toBe("dm");
  expect(theirs.campaigns![0].quests.map((q) => q.title).sort()).toEqual(["Rats in the cellar", "The dragon"]);

  // A token holding account:read alone gets the account and is told the rest
  // is missing; one holding heroes:read too gets the heroes.
  const mint = async (scopes: string[]) => {
    const res = await page.request.post("/api/me/tokens", { data: { name: scopes.join(" "), scopes, campaignId: null, expiresInDays: 90 } });
    expect(res.status(), await res.text()).toBe(201);
    return playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${(await res.json()).secret}` } });
  };
  const bare = await mint(["account:read"]);
  const bareDoc = await exportOf(bare);
  expect(bareDoc.omitted.sort()).toEqual(["campaigns", "heroes", "homebrew"]);
  expect(bareDoc.heroes).toBeUndefined();
  expect(bareDoc.campaigns).toBeUndefined();
  expect(bareDoc.account.user.id).toBe(mine.account.user.id);
  await bare.dispose();
  const heroic = await mint(["account:read", "heroes:read"]);
  const heroicDoc = await exportOf(heroic);
  expect(heroicDoc.omitted.sort()).toEqual(["campaigns", "homebrew"]);
  expect(heroicDoc.heroes?.[0].sheet.character.id).toBe(heroId);
  await heroic.dispose();
  // No account:read at all: the door itself is shut.
  const none = await mint(["heroes:read"]);
  expect((await none.get("/api/me/export")).status()).toBe(403);
  await none.dispose();

  // The profile hands it over as a file.
  await page.goto("/questboard/profile");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  expect((await download).suggestedFilename()).toMatch(/^questboard-export-\d{4}-\d{2}-\d{2}\.json$/);
  expect(visible).toBeTruthy();
  await dm.dispose();
});
