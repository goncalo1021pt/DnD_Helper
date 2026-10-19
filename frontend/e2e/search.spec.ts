import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  joinCampaign,
  newAccount,
  registerViaAPI,
  revealLocation,
  unique,
} from "./helpers";

/*
One box over a table (#321).

What is worth pinning is the veil: search is composed from the same doors the
screens read, so it must find exactly what the viewer could already read — a
veiled person is not found by a player and is by the DM, a banned spell is not
found at the table that banned it, and the Den is the DM's. And then that a
result opens the thing it names.
*/

type Hit = { kind: string; id: string; title: string; subtitle?: string; snippet?: string; nameMatch: boolean };

async function search(request: APIRequestContext, campaignId: string, q: string) {
  const res = await request.get(`/api/campaigns/${campaignId}/search?q=${encodeURIComponent(q)}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { query: string; hits: Hit[]; counts: Record<string, number> };
}

async function npc(request: APIRequestContext, campaignId: string, name: string, description: string, locationId?: string) {
  const res = await request.post(`/api/campaigns/${campaignId}/npcs`, {
    data: { name, description, locationId: locationId ?? null },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

test("search finds what a viewer may read, and nothing they may not", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("srchdm"));
  const campaign = await createCampaign(dm.request, unique("Search Table "));

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("srchpl"));
  await joinCampaign(pl.request, campaign.inviteCode!);

  const town = await createLocation(dm.request, campaign.id, "Vallaki");
  await revealLocation(dm.request, town, campaign.id);
  const innkeeper = await npc(dm.request, campaign.id, "Brûna Ostrova", "Keeps a cellar nobody may enter.", town);
  await dm.request.put(`/api/npcs/${innkeeper}/visibility`, { data: { scope: "table", visible: true } });
  const spy = await npc(dm.request, campaign.id, "Kolyan the Watcher", "Reports to the castle.", town);
  await dm.request.post(`/api/campaigns/${campaign.id}/quests`, {
    data: { title: "Find the missing bones", description: "Ask Brûna what she saw in the cellar." },
  });

  // Case and accents do not matter, a name ranks above the text, and a text
  // hit carries the words around it as written.
  const bruna = await search(pl.request, campaign.id, "BRUNA");
  expect(bruna.hits.map((h) => [h.kind, h.title])).toEqual([
    ["person", "Brûna Ostrova"],
    ["quest", "Find the missing bones"],
  ]);
  expect(bruna.hits[0]).toMatchObject({ nameMatch: true, subtitle: "Vallaki" });
  expect(bruna.hits[1].snippet).toContain("Ask Brûna what she saw");

  // A veiled person is not found by a player — not by name, not by the text —
  // and is by the DM.
  expect((await search(pl.request, campaign.id, "kolyan")).hits).toEqual([]);
  expect((await search(pl.request, campaign.id, "castle")).hits).toEqual([]);
  const dmFinds = await search(dm.request, campaign.id, "kolyan");
  expect(dmFinds.hits.map((h) => h.id)).toEqual([spy]);

  // The rules come as this table rules them: a banned spell is not found here.
  const fireball = (await search(pl.request, campaign.id, "fireball")).hits.find(
    (h) => h.kind === "spell" && h.title === "Fireball",
  );
  expect(fireball?.title).toBe("Fireball");
  const banned = await dm.request.put(`/api/campaigns/${campaign.id}/codex/${fireball!.id}`, {
    data: { status: "banned" },
  });
  expect(banned.ok(), await banned.text()).toBeTruthy();
  const after = (await search(pl.request, campaign.id, "fireball")).hits.filter((h) => h.kind === "spell");
  expect(after.map((h) => h.title)).not.toContain("Fireball");
  // Delayed Blast Fireball was not banned, and is still found.
  expect(after.map((h) => h.title)).toContain("Delayed Blast Fireball");

  // The Den is the DM's; a player meets creatures in the Bestiary.
  expect((await search(pl.request, campaign.id, "goblin")).hits.filter((h) => h.kind === "monster")).toEqual([]);
  expect((await search(dm.request, campaign.id, "goblin")).hits.some((h) => h.kind === "monster")).toBeTruthy();

  // Too short a question answers nothing, and a stranger is not let in.
  expect((await search(pl.request, campaign.id, "b")).hits).toEqual([]);
  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  await stranger.goto("/");
  await registerViaAPI(stranger.request, newAccount("srchst"));
  const refused = await stranger.request.get(`/api/campaigns/${campaign.id}/search?q=bruna`);
  expect(refused.status()).toBe(403);

  await dmCtx.close();
  await plCtx.close();
  await strangerCtx.close();
});

test("a result opens the thing it names", async ({ browser }) => {
  const ctx = await browser.newContext();
  const dm = await ctx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("srchui"));
  const campaign = await createCampaign(dm.request, unique("Search UI "));
  await npc(dm.request, campaign.id, "Brûna Ostrova", "Keeps a cellar nobody may enter.");

  await dm.goto(`/questboard/campaigns/${campaign.id}`);
  // "/" opens the box from anywhere at the table.
  await dm.locator("body").press("/");
  const box = dm.getByRole("dialog", { name: "Search this table" });
  await expect(box).toBeVisible();
  await box.getByLabel("Search").fill("bruna");
  await expect(box.getByText("People")).toBeVisible();
  await box.getByLabel("Search").press("Enter");

  // It lands on the Folk page, at the person.
  await expect(dm).toHaveURL(new RegExp(`/campaigns/${campaign.id}/npcs$`));
  await expect(dm.getByText("Brûna Ostrova").first()).toBeInViewport();

  // A rules hit opens the shared reader.
  await dm.getByRole("button", { name: "Search", exact: true }).click();
  await box.getByLabel("Search").fill("fireball");
  await box.getByRole("option", { name: /^Fireball/ }).click();
  const reader = dm.getByRole("dialog");
  await expect(reader).toContainText("Fireball");
  await expect(reader).toContainText("8d6");

  await ctx.close();
});
