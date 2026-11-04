import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  forgeHero,
  joinCampaign,
  newAccount,
  postQuest,
  registerViaAPI,
  revealLocation,
  seatHero,
  unique,
} from "./helpers";

/*
The MCP server (#318), spoken to as a client speaks to it: JSON-RPC over one
POST, with a token. What is worth pinning is that it is the screen's own
reading — a player's tools answer what the board shows that player and a DM's
carry the drafts, marked — that a token is shown only the tools its scopes
cover, and that a browser's session is no key to it.
*/

type ToolResult = { content: Array<{ type: string; text: string; data?: string; mimeType?: string }>; isError?: boolean };

let nextId = 1;

async function rpc(ctx: APIRequestContext, method: string, params: unknown = {}) {
  const res = await ctx.post("/api/mcp", {
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: nextId++, method, params },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  return body as { result?: unknown; error?: { message: string } };
}

async function call(ctx: APIRequestContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const body = await rpc(ctx, "tools/call", { name, arguments: args });
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result as ToolResult;
}

async function text(ctx: APIRequestContext, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const r = await call(ctx, name, args);
  expect(r.isError, r.content[0]?.text).toBeFalsy();
  return r.content.map((c) => c.text).join("\n");
}

async function toolNames(ctx: APIRequestContext): Promise<string[]> {
  const body = await rpc(ctx, "tools/list");
  return ((body.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name).sort();
}

async function mint(session: APIRequestContext, scopes: string[]): Promise<APIRequestContext> {
  const res = await session.post("/api/me/tokens", { data: { name: unique("mcp "), scopes, campaignId: null, expiresInDays: 1 } });
  expect(res.status(), await res.text()).toBe(201);
  return playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${(await res.json()).secret}` } });
}

test("the tools read as the screen does, for the person whose token it is", async () => {
  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("dm"));
  const tableName = unique("Barovia Table ");
  const campaign = await createCampaign(dm, tableName);
  const barovia = await createLocation(dm, campaign.id, "Village of Barovia");
  await revealLocation(dm, barovia, campaign.id);
  await createLocation(dm, campaign.id, "Castle Ravenloft"); // charted, never revealed
  await postQuest(dm, campaign.id, "Rats in the cellar");
  const draft = await dm.post(`/api/campaigns/${campaign.id}/quests`, { data: { title: "The dragon", locationId: null, visibleToParty: false } });
  expect(draft.status(), await draft.text()).toBe(201);

  const pl = await playwrightRequest.newContext();
  await registerViaAPI(pl, newAccount("pl"));
  await joinCampaign(pl, campaign.inviteCode);
  const heroName = unique("Grash ");
  const heroId = await forgeHero(pl, {
    name: heroName,
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });
  await seatHero(pl, heroId, campaign.id);
  // Coin in the purse: stored in copper, read in the table's coin (#418).
  const gift = await dm.post(`/api/campaigns/${campaign.id}/gifts`, { data: { heroIds: [heroId], coin: "2 gp, 3 sp" } });
  expect(gift.ok(), await gift.text()).toBeTruthy();

  // A browser's session is not a key: the door wants a token.
  const viaCookie = await pl.post("/api/mcp", {
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(viaCookie.status()).toBe(401);

  // --- the player ---------------------------------------------------------
  const player = await mint(pl, ["heroes:read", "campaigns:read", "rules:read"]);
  const hello = await rpc(player, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  expect((hello.result as { serverInfo: { name: string } }).serverInfo.name).toBe("questboard");
  expect(await toolNames(player)).toEqual(
    ["chronicle", "handouts", "hero_sheet", "lookup", "my_heroes", "my_tables", "party", "quest", "table_board", "whats_known"],
  );

  expect(await text(player, "my_tables")).toContain(tableName);
  const board = await text(player, "table_board"); // their only table: no name needed
  expect(board).toContain("Rats in the cellar");
  expect(board).not.toContain("The dragon");
  expect(board).not.toContain("hidden from the party");

  const world = await text(player, "whats_known", { table: campaign.id });
  expect(world).toContain("Village of Barovia");
  expect(world).not.toContain("Ravenloft");
  // A veiled place cannot be named into view either.
  const probe = await call(player, "whats_known", { place: "Ravenloft" });
  expect(probe.isError).toBeTruthy();

  const sheet = await text(player, "hero_sheet", { hero: heroName.toLowerCase() });
  expect(sheet).toContain(heroName);
  expect(sheet).toMatch(/Barbarian 1/);
  expect(sheet).toMatch(/\*\*AC\*\* \d+/);
  expect(sheet).toContain("Rage"); // a feature earned at level 1
  expect(sheet).toContain("Purse: 2 gp 3 sp");
  expect(sheet).not.toMatch(/×230/);

  // The sheet sends the reader to lookup for a feature, and lookup finds it
  // inside its class (#419).
  const secondWind = await text(player, "lookup", { name: "Second Wind" });
  expect(secondWind).toContain("feature of Fighter (class), level 1");
  expect(secondWind).toContain("Bonus Action");

  // An ambiguous name says what each candidate is (#420).
  const shield = await call(player, "lookup", { name: "Shield" });
  expect(shield.isError).toBeTruthy();
  expect(shield.content[0].text).toMatch(/Shield \(spell · srd · /);
  expect(shield.content[0].text).toMatch(/Shield \(item · srd · /);

  // A full page of the chronicle says where to read on from, and the cursor
  // it prints leads to the older lines (#424).
  const newest = await text(player, "chronicle", { limit: 1 });
  expect(newest).toContain("Older lines exist");
  const cursor = newest.match(/before=`([0-9a-f-]{36})`/)![1];
  const older = await text(player, "chronicle", { limit: 1, before: cursor });
  expect(older).toContain("Chronicle of");
  expect(older).not.toBe(newest);
  // A window is exact, in days: today holds what this test wrote, 2000 holds nothing.
  const today = new Date().toISOString().slice(0, 10);
  expect(await text(player, "chronicle", { since: today, until: today })).toContain("Chronicle of");
  expect(await text(player, "chronicle", { since: "2000-01-01", until: "2000-01-01" })).toContain("Nothing in the chronicle");
  expect((await call(player, "chronicle", { before: "not-an-id" })).isError).toBeTruthy();
  expect((await call(player, "chronicle", { since: "2026-08-02", until: "2026-08-01" })).isError).toBeTruthy();

  const fireball = await text(player, "lookup", { name: "Fireball", kind: "spell" });
  expect(fireball).toContain("# Fireball");
  expect(fireball).toMatch(/level\*\*: 3/);

  // A tool the token is not shown is not callable by name either.
  const sneak = await rpc(player, "tools/call", { name: "den_search", arguments: {} });
  expect(sneak.error ?? (sneak.result as ToolResult).isError).toBeTruthy();

  // --- the DM -------------------------------------------------------------
  const runner = await mint(dm, ["heroes:read", "campaigns:run", "rules:read"]);
  expect(await toolNames(runner)).toContain("encounter_check");

  const dmBoard = await text(runner, "table_board", { table: tableName });
  expect(dmBoard).toContain("Rats in the cellar");
  expect(dmBoard).toMatch(/The dragon.*hidden from the party/);
  expect(await text(runner, "whats_known")).toMatch(/Castle Ravenloft.*hidden from the party/);
  // The DM reads the player's hero through the roster.
  expect(await text(runner, "hero_sheet", { hero: heroName })).toContain(heroName);

  const undead = await text(runner, "den_search", { type: "undead", cr_max: 0.25 });
  expect(undead).toContain("Skeleton");

  // Eight skeletons at 50 XP against one level-1 hero (high budget 100).
  const check = await text(runner, "encounter_check", { monsters: [{ name: "Skeleton", count: 8 }] });
  expect(check).toContain("8 × Skeleton");
  expect(check).toMatch(/Total 400 XP → high/);
  expect(check).toContain(heroName);

  // The player cannot check an encounter by naming levels either: the tool is
  // the DM's, and a token without campaigns:run never sees it.
  const theirs = await rpc(player, "tools/call", { name: "encounter_check", arguments: { monsters: [{ name: "Skeleton" }], levels: [1] } });
  expect(theirs.error ?? (theirs.result as ToolResult).isError).toBeTruthy();

  // A token with rules alone is shown the codex and nothing else.
  const reader = await mint(pl, ["rules:read"]);
  expect(await toolNames(reader)).toEqual(["lookup"]);

  for (const ctx of [dm, pl, player, runner, reader]) await ctx.dispose();
});

/** A 1x1 PNG: the handouts' bytes only need to be a picture the server can measure. */
const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("a whole quest, and the handouts a player was given (#425)", async () => {
  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("dm"));
  const campaign = await createCampaign(dm, unique("Letters Table "));

  const description = `${"The sea is wide and the road is long. ".repeat(12)}\n\nBring word back to the Guildmistress.`;
  const made = await dm.post(`/api/campaigns/${campaign.id}/quests`, {
    data: { title: "Reach the sea", description, locationId: null, rewards: [{ type: "gold", label: "Gold", value: "50 gp" }] },
  });
  expect(made.status(), await made.text()).toBe(201);
  const draft = await dm.post(`/api/campaigns/${campaign.id}/quests`, { data: { title: "The vault job", locationId: null, visibleToParty: false } });
  expect(draft.status(), await draft.text()).toBe(201);

  const hand = async (title: string, visibleToParty: boolean) => {
    const res = await dm.post(`/api/campaigns/${campaign.id}/handouts`, {
      data: { title, caption: "Sealed in red wax", imageBase64: PIXEL_PNG, visibleToParty },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  await hand("Letter from the Guildmistress", true);
  await hand("Vault plans", false);

  const pl = await playwrightRequest.newContext();
  await registerViaAPI(pl, newAccount("pl"));
  await joinCampaign(pl, campaign.inviteCode);

  // --- the player ---------------------------------------------------------
  const player = await mint(pl, ["campaigns:read"]);
  expect(await toolNames(player)).toEqual(["chronicle", "handouts", "my_tables", "party", "quest", "table_board", "whats_known"]);

  const board = await text(player, "table_board");
  expect(board).toContain("Use quest for a whole notice");
  expect(board).not.toContain("Bring word back"); // the board still cuts the description to a line

  const whole = await text(player, "quest", { quest: "reach the sea" });
  expect(whole).toContain("Bring word back to the Guildmistress."); // the second paragraph is there
  expect(whole).toContain("Gold (50 gp)");
  // A drafted notice cannot be named into view.
  expect((await call(player, "quest", { quest: "vault" })).isError).toBeTruthy();

  const list = await text(player, "handouts");
  expect(list).toContain("Letter from the Guildmistress");
  expect(list).not.toContain("Vault plans");
  expect(list).not.toContain("hidden from the party");

  const letter = await call(player, "handouts", { handout: "guildmistress" });
  expect(letter.isError, letter.content[0]?.text).toBeFalsy();
  expect(letter.content[0].text).toContain("Sealed in red wax");
  const picture = letter.content.find((c) => c.type === "image");
  expect(picture?.mimeType).toBe("image/png");
  expect(picture?.data).toBe(PIXEL_PNG);
  // A veiled prop is no more readable by name than it is in the list.
  expect((await call(player, "handouts", { handout: "Vault plans" })).isError).toBeTruthy();

  // --- the DM -------------------------------------------------------------
  const runner = await mint(dm, ["campaigns:read"]);
  expect(await text(runner, "quest", { quest: "vault" })).toContain("hidden from the party");
  expect(await text(runner, "handouts")).toMatch(/Vault plans.*hidden from the party/);
  const plans = await call(runner, "handouts", { handout: "Vault plans" });
  expect(plans.content.some((c) => c.type === "image")).toBeTruthy();

  for (const ctx of [dm, pl, player, runner]) await ctx.dispose();
});
