import { readFileSync } from "node:fs";
import { expect, test, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createCampaign, forgeHero, joinCampaign, newAccount, registerViaAPI, seatHero, unique } from "./helpers";

/*
Deleting an account (#322): ask, wait a week, be anonymised in place.

What is worth pinning is the part a person cannot see until it goes wrong: that
asking signs the account out of everywhere and stops its tokens, that signing in
again is the cancel, that a table you own is handed over first, and — through
the real purge, driven by the development-only sweep door — that what the
person leaves behind still reads. Their words and the other side of a
conversation stay, as from "a departed player"; their heroes, their address
and their way in do not; and what they ran for the table (a co-DM's NPC body)
goes back to it instead of dying with them.
*/

const DEPARTED = "a departed player";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function whoAmI(ctx: APIRequestContext): Promise<{ id: string; name: string }> {
  const res = await ctx.get("/api/me");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).user;
}

async function signIn(account: { username: string; password: string }): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext();
  const res = await ctx.post("/api/auth/login", { data: { identifier: account.username, password: account.password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ctx;
}

async function devAccount(opts: { name: string; email?: string }): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext();
  const q = new URLSearchParams({ name: opts.name, id: unique("door-") });
  if (opts.email) q.set("email", opts.email);
  const res = await ctx.get(`/api/auth/dev/login?${q.toString()}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ctx;
}

/** Purge one account as if its week were up (development only), so a spec never sweeps up another's. */
async function purge(ctx: APIRequestContext, userId: string): Promise<number> {
  const res = await ctx.post(`/api/dev/purge-accounts?id=${userId}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).purged as number;
}

test("scheduling signs the account out and stops its keys, signing in cancels it, and the purge keeps what it should", async () => {
  const owner = newAccount("delown");
  const leaver = newAccount("delgone");
  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, owner);
  const campaign = await createCampaign(dm, unique("Leaving Table "));
  const dmId = (await whoAmI(dm)).id;

  let gone = await playwrightRequest.newContext();
  await registerViaAPI(gone, leaver);
  const goneId = (await whoAmI(gone)).id;
  await joinCampaign(gone, campaign.inviteCode);

  // What the person will leave behind: a hero, a line they wrote, something said
  // to the DM, and a key.
  const heroName = unique("Grash ");
  const heroId = await forgeHero(gone, {
    name: heroName,
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });
  await seatHero(gone, heroId, campaign.id);
  const line = unique("The leaver was here ");
  expect((await gone.post(`/api/campaigns/${campaign.id}/events`, { data: { message: line } })).status()).toBe(201);
  const said = unique("see you friday ");
  expect((await gone.post(`/api/me/messages/${dmId}`, { data: { body: said } })).status()).toBe(201);
  const minted = await gone.post("/api/me/tokens", {
    data: { name: unique("key "), scopes: ["account:read", "campaigns:read"], campaignId: null, expiresInDays: 1 },
  });
  expect(minted.status(), await minted.text()).toBe(201);
  const key = (await minted.json()).secret as string;
  const withKey = await playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${key}` } });
  expect((await withKey.get("/api/me")).ok()).toBeTruthy();

  // Then the screen, and a body forged for one of the Folk: the table's, not theirs.
  expect((await dm.put(`/api/campaigns/${campaign.id}/members/${goneId}/role`, { data: { role: "dm" } })).ok()).toBeTruthy();
  const npcName = unique("Barthen ");
  const npc = (await (await gone.post(`/api/campaigns/${campaign.id}/npcs`, { data: { name: npcName } })).json()).id as string;
  const forged = await gone.post(`/api/npcs/${npc}/body`, {
    data: { name: npcName, class: "Commoner", level: 2, hpCurrent: 9, hpMax: 9 },
  });
  expect(forged.ok(), await forged.text()).toBeTruthy();
  const bodyId = (await forged.json()).characterId as string;

  // --- the terms -----------------------------------------------------------
  const terms = await (await gone.get("/api/me/deletion")).json();
  expect(terms).toMatchObject({ method: "password", graceDays: 7, blockers: [] });
  // A table you own blocks you: handed over or disbanded first.
  const ownerTerms = await (await dm.get("/api/me/deletion")).json();
  expect(ownerTerms.blockers.map((b: { campaignId: string }) => b.campaignId)).toEqual([campaign.id]);
  const blocked = await dm.post("/api/me/deletion", { data: { password: owner.password } });
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).error).toContain(campaign.name);
  expect((await whoAmI(dm)).id).toBe(dmId); // still signed in: nothing happened

  // --- asking --------------------------------------------------------------
  const wrong = await gone.post("/api/me/deletion", { data: { password: "not-my-password" } });
  expect(wrong.status()).toBe(403);
  const before = Date.now();
  const asked = await gone.post("/api/me/deletion", { data: { password: leaver.password } });
  expect(asked.status(), await asked.text()).toBe(200);
  const due = new Date((await asked.json()).scheduledFor).getTime();
  expect(due - before).toBeGreaterThan(WEEK_MS - 60_000);
  expect(due - before).toBeLessThan(WEEK_MS + 60_000);

  // Signed out everywhere, and the key stops with it.
  expect((await gone.get("/api/me")).status()).toBe(401);
  expect((await withKey.get("/api/me")).status()).toBe(401);
  // Nobody hands a table to somebody on the way out.
  const handed = await dm.post(`/api/campaigns/${campaign.id}/owner`, { data: { userId: goneId } });
  expect(handed.status()).toBe(400);
  expect((await handed.json()).error).toContain("delete their account");

  // --- signing in is the cancel -------------------------------------------
  gone = await signIn(leaver);
  expect((await whoAmI(gone)).id).toBe(goneId);
  expect(await purge(dm, goneId)).toBe(0); // nothing is due: the account is not scheduled any more
  expect((await whoAmI(gone)).id).toBe(goneId);
  // Cancelling does not bring the key back.
  expect((await withKey.get("/api/me")).status()).toBe(401);

  // --- and now for real ----------------------------------------------------
  expect((await gone.post("/api/me/deletion", { data: { password: leaver.password } })).status()).toBe(200);
  expect(await purge(dm, goneId)).toBe(1);

  // The way in is gone, and so is the address: the same person may start again.
  const retry = await playwrightRequest.newContext();
  const denied = await retry.post("/api/auth/login", { data: { identifier: leaver.username, password: leaver.password } });
  expect(denied.ok()).toBeFalsy();
  const again = await playwrightRequest.newContext();
  await registerViaAPI(again, leaver);
  expect((await whoAmI(again)).id).not.toBe(goneId);

  // Their hero went with them; the table lost a seat.
  const roster = await (await dm.get(`/api/campaigns/${campaign.id}/characters`)).json();
  expect(roster.map((c: { name: string }) => c.name)).not.toContain(heroName);
  const members = await (await dm.get(`/api/campaigns/${campaign.id}/members`)).json();
  expect(members.map((m: { userId: string }) => m.userId)).not.toContain(goneId);

  // What they wrote stays, as from a departed player.
  const chronicle = await (await dm.get(`/api/campaigns/${campaign.id}/events?limit=200`)).json();
  const kept = chronicle.find((e: { message: string }) => e.message === line);
  expect(kept, "the line they wrote is still in the chronicle").toBeTruthy();
  expect(kept.actorName).toBe(DEPARTED);

  // The other side of the conversation keeps theirs, from the same peer.
  const inbox = await (await dm.get("/api/me/messages")).json();
  const thread = inbox.find((t: { peerId: string }) => t.peerId === goneId);
  expect(thread, "the DM's inbox still holds the conversation").toBeTruthy();
  expect(thread.peerName).toBe(DEPARTED);
  const read = await (await dm.get(`/api/me/messages/${goneId}`)).json();
  expect(read.map((m: { body: string }) => m.body)).toContain(said);

  // What they forged for the table is the table's: the owner reads it now.
  const body = await dm.get(`/api/characters/${bodyId}`);
  expect(body.status(), await body.text()).toBe(200);

  for (const c of [dm, gone, withKey, retry, again]) await c.dispose();
});

test("an account with no password confirms by email, and the link is not enough alone", async () => {
  const email = `${unique("prov")}@example.test`;
  const ctx = await devAccount({ name: unique("Provider "), email });

  const terms = await (await ctx.get("/api/me/deletion")).json();
  expect(terms.method).toBe("email");
  // There is no password to type, and no name will do while there is an address.
  expect((await ctx.post("/api/me/deletion", { data: { password: "anything" } })).status()).toBe(400);
  expect((await ctx.post("/api/me/deletion", { data: { name: "anything" } })).status()).toBe(400);
  // A made-up token schedules nothing.
  expect((await ctx.post("/api/me/deletion/confirm", { data: { token: "nonsense" } })).status()).toBe(400);

  expect((await ctx.post("/api/me/deletion/email")).status()).toBe(202);
  // One link is enough a minute.
  expect((await ctx.post("/api/me/deletion/email")).status()).toBe(429);

  // The link itself exists only in the message the server sent. With no Resend
  // key the server logs it, so when the harness says where that log is we can
  // follow it as a person would (the same as auth.spec.ts does).
  const logPath = process.env.E2E_SERVER_LOG;
  if (!logPath) {
    test.info().annotations.push({ type: "skipped", description: "set E2E_SERVER_LOG to follow the emailed link" });
    await ctx.dispose();
    return;
  }
  await expect.poll(() => readFileSync(logPath, "utf8").includes("/confirm-deletion?token="), { timeout: 10_000 }).toBe(true);
  const log = readFileSync(logPath, "utf8");
  const after = log.slice(log.lastIndexOf(email));
  const token = after.match(/\/confirm-deletion\?token=([^\s"&]+)/)?.[1];
  expect(token, "no deletion link was logged for this address").toBeTruthy();

  // The mail proves the address; somebody else's session proves nothing.
  const stranger = await devAccount({ name: unique("Stranger ") });
  expect((await stranger.post("/api/me/deletion/confirm", { data: { token } })).status()).toBe(400);
  // A token alone is no key: the session is needed too.
  const nobody = await playwrightRequest.newContext();
  expect((await nobody.post("/api/me/deletion/confirm", { data: { token } })).status()).toBe(401);

  const done = await ctx.post("/api/me/deletion/confirm", { data: { token } });
  expect(done.status(), await done.text()).toBe(200);
  expect((await ctx.get("/api/me")).status()).toBe(401);

  for (const c of [ctx, stranger, nobody]) await c.dispose();
});

test("an account with neither a password nor an address types its name", async () => {
  const name = unique("Nameless ");
  const ctx = await devAccount({ name });
  expect((await (await ctx.get("/api/me/deletion")).json()).method).toBe("name");
  const wrong = await ctx.post("/api/me/deletion", { data: { name: "somebody else" } });
  expect(wrong.status()).toBe(403);
  const right = await ctx.post("/api/me/deletion", { data: { name: ` ${name.toUpperCase()} ` } });
  expect(right.status(), await right.text()).toBe(200);
  expect((await ctx.get("/api/me")).status()).toBe(401);
  await ctx.dispose();
});

test("a token can never delete an account", async () => {
  const account = newAccount("deltok");
  const ctx = await playwrightRequest.newContext();
  await registerViaAPI(ctx, account);
  const minted = await ctx.post("/api/me/tokens", {
    data: { name: unique("key "), scopes: ["account:write", "campaigns:own"], campaignId: null, expiresInDays: 1 },
  });
  const key = (await minted.json()).secret as string;
  const withKey = await playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${key}` } });
  expect((await withKey.get("/api/me/deletion")).status()).toBe(403);
  expect((await withKey.post("/api/me/deletion", { data: { password: account.password } })).status()).toBe(403);
  expect((await withKey.post("/api/me/deletion/email")).status()).toBe(403);
  expect((await ctx.get("/api/me")).ok()).toBeTruthy(); // and nothing was scheduled
  await ctx.dispose();
  await withKey.dispose();
});

test("the profile says what goes and what stays, blocks an owner, and lands a scheduled account on the front door", async ({ browser }) => {
  const account = newAccount("deluix");
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await registerViaAPI(page.request, account);
  const table = await createCampaign(page.request, unique("Mine To Hand Over "));

  await page.goto("/questboard/profile");
  await page.getByRole("button", { name: "Delete account" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByText("What goes")).toBeVisible();
  await expect(modal.getByText("What stays")).toBeVisible();
  await expect(modal.getByText("a departed player")).toBeVisible();
  // An owner is told which table to hand over, and cannot go on.
  await expect(modal.getByRole("link", { name: table.name })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Delete my account" })).toBeDisabled();
  await page.screenshot({ path: "test-results/account-deletion-blocked.png" });

  // Disband it, and the way is open.
  expect((await page.request.delete(`/api/campaigns/${table.id}`)).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Delete account" }).click();
  const open = page.getByRole("dialog");
  await expect(open.getByRole("button", { name: "Delete my account" })).toBeDisabled(); // no password yet
  await page.screenshot({ path: "test-results/account-deletion-password.png" });
  await open.getByLabel("Your password").fill("not-my-password");
  await open.getByRole("button", { name: "Delete my account" }).click();
  await expect(open.getByText(/password is incorrect/i)).toBeVisible();

  await open.getByLabel("Your password").fill(account.password);
  await open.getByRole("button", { name: "Delete my account" }).click();
  await expect(open.getByText(/will be deleted on/i)).toBeVisible();
  await page.screenshot({ path: "test-results/account-deletion-scheduled.png" });
  await open.getByRole("button", { name: "Done" }).click();

  // The day they have to come back by is waiting on the front door.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("status").getByText(/scheduled to be deleted on/i)).toBeVisible();
  await page.screenshot({ path: "test-results/account-deletion-landing.png" });
  await page.context().close();
});

test("the emailed link's page asks before it acts, and needs a signed-in account", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  // Signed out: told to sign in, nothing offered.
  await page.goto("/confirm-deletion?token=whatever");
  await expect(page.getByText(/Sign in to the account you want to delete/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Yes, delete my account/i })).toHaveCount(0);

  // Signed in, a bad token reads as a bad link, and nothing was scheduled.
  await registerViaAPI(page.request, newAccount("delpage"));
  await page.goto("/confirm-deletion?token=whatever");
  await expect(page.getByText(/Delete the account/i)).toBeVisible();
  await page.getByRole("button", { name: /Yes, delete my account/i }).click();
  await expect(page.getByText(/not valid any more/i)).toBeVisible();
  expect((await page.request.get("/api/me")).ok()).toBeTruthy();
  await page.screenshot({ path: "test-results/account-deletion-confirm-page.png" });
  await page.context().close();
});
