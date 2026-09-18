import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createCampaign, joinCampaign, newAccount, postQuest, registerViaAPI, unique } from "./helpers";

/*
Webhooks (#295): a person's standing order, told at a URL of their choosing.

The receiver is a tiny HTTP server inside this test process. Playwright runs
on the host network, and the app container reaches the host as
host.docker.internal (aliased in compose), which the URL guard lets through
outside production. What is worth pinning: a delivery arrives signed and
verifies, a drafted quest reaches no hook because the emitter left the player
out, a token-born hook is refused a name past its scopes and never hears one,
and a URL that is gone shows a failed attempt with its next try.
*/

type Received = { headers: Record<string, string>; body: string };

async function receiver(): Promise<{ server: Server; port: number; got: Received[]; answer: { status: number } }> {
  const got: Received[] = [];
  const answer = { status: 200 };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])), body });
      res.statusCode = answer.status;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, port, got, answer };
}

const hookUrl = (port: number, path: string) => `http://host.docker.internal:${port}${path}`;

function verify(secret: string, r: Received): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(`${r.headers["x-questboard-timestamp"]}.${r.body}`).digest("hex");
  const given = r.headers["x-questboard-signature"] ?? "";
  return expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

async function waitFor(check: () => boolean, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(check(), "waited for a delivery that never came").toBeTruthy();
}

async function register(
  ctx: APIRequestContext,
  input: { url: string; events: string[]; campaignId?: string | null },
): Promise<{ id: string; secret: string; status: number; text: string }> {
  const res = await ctx.post("/api/me/webhooks", { data: { campaignId: null, ...input } });
  const text = await res.text();
  if (res.status() !== 201) return { id: "", secret: "", status: res.status(), text };
  const body = JSON.parse(text);
  return { id: body.webhook.id as string, secret: body.secret as string, status: 201, text };
}

test("registered on the profile, a delivery arrives signed; a veiled notice never does", async ({ page }) => {
  const rx = await receiver();
  try {
    const dm = await playwrightRequest.newContext();
    await registerViaAPI(dm, newAccount("dm"));
    const campaign = await createCampaign(dm, unique("Table "));

    // The player registers on their profile.
    await registerViaAPI(page.request, newAccount("pl"));
    await joinCampaign(page.request, campaign.inviteCode);
    await page.goto("/questboard/profile");
    await expect(page.getByText("No webhooks yet.")).toBeVisible();
    await page.getByRole("button", { name: "New webhook" }).click();
    await page.locator('input[name="webhook-url"]').fill(hookUrl(rx.port, "/player"));
    await page.locator('input[name="event-quest.posted"]').check();
    await page.getByRole("button", { name: "Register" }).click();
    const secret = (await page.getByTestId("webhook-secret").textContent())?.trim() ?? "";
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    await page.getByRole("button", { name: "I've saved it" }).click();
    const row = page.getByTestId("webhook-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("quest.posted");
    await expect(row).toContainText("nothing delivered yet");

    // A notice on the board: the player is in its audience, the hook hears it.
    const questId = await postQuest(dm, campaign.id, "Rats in the cellar");
    await waitFor(() => rx.got.length >= 1);
    const first = rx.got[0];
    expect(first.headers["x-questboard-event"]).toBe("quest.posted");
    expect(first.headers["content-type"]).toBe("application/json");
    expect(first.headers["user-agent"]).toMatch(/^QuestBoard-Hookshot\//);
    expect(first.headers["x-questboard-delivery"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(verify(secret, first), "the signature verifies under the secret shown once").toBeTruthy();
    const env = JSON.parse(first.body) as { name: string; campaign: { id: string; name: string }; actor: { id: string }; payload: { questId: string }; audience?: unknown };
    expect(env.name).toBe("quest.posted");
    expect(env.campaign).toEqual({ id: campaign.id, name: campaign.name });
    expect(env.payload.questId).toBe(questId);
    expect(env.audience, "the audience never leaves the server").toBeUndefined();

    // A drafted notice: the emitter left the player out, so nothing arrives —
    // and a claim is a name the hook did not pick.
    const draft = await dm.post(`/api/campaigns/${campaign.id}/quests`, { data: { title: "The dragon", locationId: null, visibleToParty: false } });
    expect(draft.status(), await draft.text()).toBe(201);
    expect((await page.request.post(`/api/quests/${questId}/claim`)).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 5000));
    expect(rx.got.length).toBe(1);

    // The profile shows the delivery, and a ping lands too.
    await page.reload();
    await expect(page.getByTestId("webhook-row")).toContainText("last delivered");
    await page.getByRole("button", { name: "Ping" }).click();
    await waitFor(() => rx.got.length >= 2);
    expect(rx.got[1].headers["x-questboard-event"]).toBe("ping");
    expect(verify(secret, rx.got[1])).toBeTruthy();
    await expect(page.getByTestId("delivery-log")).toContainText("ping");
    await expect(page.getByTestId("delivery-log")).toContainText("delivered");

    // Removed: gone from the list, and a later notice reaches nobody.
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).last().click();
    await expect(page.getByText("No webhooks yet.")).toBeVisible();
    await postQuest(dm, campaign.id, "Wolves on the road");
    await new Promise((r) => setTimeout(r, 4000));
    expect(rx.got.length).toBe(2);
    await dm.dispose();
  } finally {
    rx.server.close();
  }
});

test("a hook born of a token hears no more than the token could read", async ({ page }) => {
  const rx = await receiver();
  try {
    await registerViaAPI(page.request, newAccount("bot"));
    const campaign = await createCampaign(page.request, unique("Table "));
    const minted = await page.request.post("/api/me/tokens", {
      data: { name: "the bot", scopes: ["webhooks:write", "heroes:read"], campaignId: null, expiresInDays: 90 },
    });
    expect(minted.status(), await minted.text()).toBe(201);
    const bot = await playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${(await minted.json()).secret}` } });

    // A name past its scopes is refused, and told which scope.
    const refused = await register(bot, { url: hookUrl(rx.port, "/bot"), events: ["quest.posted"] });
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("campaigns:read");

    // An unfiltered hook is capped: it records the token's scopes…
    const capped = await register(bot, { url: hookUrl(rx.port, "/bot"), events: [] });
    expect(capped.status, capped.text).toBe(201);
    const listed = (await (await bot.get("/api/me/webhooks")).json()) as Array<{ id: string; scopes?: string[] }>;
    expect(listed.find((h) => h.id === capped.id)?.scopes).toEqual(["webhooks:write", "heroes:read"]);

    // …and a table event never reaches it, while a hero event does.
    await postQuest(page.request, campaign.id, "Rats in the cellar");
    await new Promise((r) => setTimeout(r, 4000));
    expect(rx.got.length).toBe(0);
    const hero = await page.request.post(`/api/campaigns/${campaign.id}/characters`, {
      data: { name: unique("Grash "), class: "Orc Barbarian", level: 3, hpCurrent: 24, hpMax: 24 },
    });
    expect(hero.status(), await hero.text()).toBe(201);
    const xp = await page.request.post(`/api/campaigns/${campaign.id}/xp`, { data: { amount: 50 } });
    expect(xp.status(), await xp.text()).toBe(200);
    await waitFor(() => rx.got.length >= 1);
    expect(rx.got[0].headers["x-questboard-event"]).toBe("hero.xp_awarded");
    expect(verify(capped.secret, rx.got[0])).toBeTruthy();

    // The token can read its log and remove its hook; a session-born hook
    // made in the browser carries no cap.
    const log = await bot.get(`/api/me/webhooks/${capped.id}/deliveries`);
    expect(log.status()).toBe(200);
    expect(((await log.json()) as Array<{ name: string }>)[0].name).toBe("hero.xp_awarded");
    expect((await bot.delete(`/api/me/webhooks/${capped.id}`)).status()).toBe(204);
    const free = await register(page.request, { url: hookUrl(rx.port, "/me"), events: [] });
    expect(free.status).toBe(201);
    const mine = (await (await page.request.get("/api/me/webhooks")).json()) as Array<{ id: string; scopes?: string[] }>;
    expect(mine.find((h) => h.id === free.id)?.scopes).toBeUndefined();
    await bot.dispose();
  } finally {
    rx.server.close();
  }
});

test("a URL that is gone: a failed attempt, a next try, and the log says so", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("gone"));
  // A closed port on the host answers nobody.
  const dead = await register(page.request, { url: hookUrl(1, "/nobody"), events: [] });
  expect(dead.status, dead.text).toBe(201);
  const ping = await page.request.post(`/api/me/webhooks/${dead.id}/ping`);
  expect(ping.status(), await ping.text()).toBe(202);

  type Attempt = { attempts: number; nextAttemptAt?: string; deliveredAt?: string; lastError?: string };
  let attempt: Attempt | undefined;
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const rows = (await (await page.request.get(`/api/me/webhooks/${dead.id}/deliveries`)).json()) as Attempt[];
    attempt = rows[0];
    if (attempt && attempt.attempts >= 1) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(attempt?.attempts).toBe(1);
  expect(attempt?.deliveredAt).toBeUndefined();
  expect(attempt?.lastError).toBeTruthy();
  // The first retry is about a minute out.
  expect(new Date(attempt!.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() + 30_000);

  // Bad URLs are refused at the door, in words.
  for (const [url, word] of [
    ["ftp://example.com/x", "https"],
    ["not a url", "absolute"],
    ["https://user:pw@example.com/x", "credentials"],
  ]) {
    const res = await register(page.request, { url, events: [] });
    expect(res.status, url).toBe(400);
    expect(res.text).toContain(word);
  }
  const unknown = await register(page.request, { url: hookUrl(8, "/x"), events: ["quest.exploded"] });
  expect(unknown.status).toBe(400);
  expect(unknown.text).toContain("unknown event");
});
