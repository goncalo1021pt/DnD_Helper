import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { createCampaign, joinCampaign, newAccount, postQuest, registerViaAPI, unique } from "./helpers";

/*
Notifications that reach you outside the app (#316).

Email cannot be watched from here — the e2e server has no RESEND_API_KEY and
logs it — so what is pinned is everything around it: the profile's choices
persist and start at the defaults, the chronicle is refused by email, a mute
is a fact about the seat, and the unsubscribe page acts on a press and never
on a look. A Discord channel CAN be watched: the receiver below plays
Discord, and what is worth pinning is that the table's own channel receives
a Discord-shaped message for a notice the whole table may see and nothing
for one the DM kept veiled, that a player's payload never carries it, and
that a person's own Discord-format hook is registered without a secret.
*/

type Received = { headers: Record<string, string>; body: string };

async function receiver(): Promise<{ server: Server; port: number; got: Received[] }> {
  const got: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])), body });
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, port, got };
}

const RECEIVER_HOST = process.env.E2E_RECEIVER_HOST ?? "127.0.0.1";
const hookUrl = (port: number, path: string) => `http://${RECEIVER_HOST}:${port}${path}`;

async function waitFor(check: () => boolean, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(check(), "waited for a delivery that never came").toBeTruthy();
}

test("the profile's email choices start at the defaults, persist, and refuse the chronicle", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("mail"));

  const before = await (await page.request.get("/api/me/notifications")).json();
  expect(before.emailEvents).toEqual(["handout.given", "session.scheduled", "session.moved"]);
  expect(before.emailVerified).toBe(false);
  expect(before.mutedCampaignIds).toEqual([]);

  await page.goto("/questboard/profile");
  const section = page.getByTestId("notifications-settings");
  await expect(section).toContainText("once it is confirmed");
  await expect(section.locator('input[name="email-session.moved"]')).toBeChecked();
  await expect(section.locator('input[name="email-quest.posted"]')).not.toBeChecked();
  // The chronicle is not offered at all.
  await expect(section.locator('input[name="email-chronicle.written"]')).toHaveCount(0);

  await section.locator('input[name="email-session.moved"]').uncheck();
  await section.locator('input[name="email-quest.posted"]').check();
  await expect(section.locator('input[name="email-quest.posted"]')).toBeChecked();
  await page.reload();
  await expect(page.getByTestId("notifications-settings").locator('input[name="email-session.moved"]')).not.toBeChecked();
  await expect(page.getByTestId("notifications-settings").locator('input[name="email-quest.posted"]')).toBeChecked();

  // Through the API: the chronicle is refused, and an empty list is none.
  const refused = await page.request.put("/api/me/notifications", { data: { emailEvents: ["chronicle.written"] } });
  expect(refused.status()).toBe(400);
  const none = await page.request.put("/api/me/notifications", { data: { emailEvents: [] } });
  expect(none.status()).toBe(200);
  expect((await none.json()).emailEvents).toEqual([]);
});

test("a mute is a fact about the seat: set from the player menu, read on /me, gone on leaving", async ({ page }) => {
  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("dm"));
  const campaign = await createCampaign(dm, unique("Table "));
  await registerViaAPI(page.request, newAccount("pl"));
  await joinCampaign(page.request, campaign.inviteCode);

  await page.goto(`/questboard/campaigns/${campaign.id}/player`);
  const mute = page.getByTestId("mute-section");
  await expect(mute).toContainText("reaching you");
  await mute.getByRole("button", { name: "Mute this table" }).click();
  await expect(mute).toContainText("muted");
  await expect(mute.getByRole("button", { name: "Unmute this table" })).toBeVisible();

  const me = await (await page.request.get("/api/me")).json();
  expect(me.campaigns.find((m: { campaign: { id: string } }) => m.campaign.id === campaign.id).muted).toBe(true);
  const settings = await (await page.request.get("/api/me/notifications")).json();
  expect(settings.mutedCampaignIds).toEqual([campaign.id]);

  // The profile names the muted table.
  await page.goto("/questboard/profile");
  await expect(page.getByTestId("notifications-settings")).toContainText(campaign.name);

  // A stranger cannot mute a table they do not sit at.
  const stranger = await playwrightRequest.newContext();
  await registerViaAPI(stranger, newAccount("st"));
  expect((await stranger.put(`/api/campaigns/${campaign.id}/mute`, { data: { muted: true } })).status()).toBe(403);

  // Leaving drops it.
  expect((await page.request.post(`/api/campaigns/${campaign.id}/leave`)).ok()).toBeTruthy();
  await joinCampaign(page.request, campaign.inviteCode);
  const again = await (await page.request.get("/api/me/notifications")).json();
  expect(again.mutedCampaignIds).toEqual([]);
  await dm.dispose();
  await stranger.dispose();
});

test("the table's channel receives a Discord-shaped message for what the whole table may see, and nothing else", async ({ page }) => {
  const rx = await receiver();
  try {
    await registerViaAPI(page.request, newAccount("dm"));
    const campaign = await createCampaign(page.request, unique("Table "));
    const player = await playwrightRequest.newContext();
    await registerViaAPI(player, newAccount("pl"));
    await joinCampaign(player, campaign.inviteCode);

    // Hung from the DM menu.
    await page.goto(`/questboard/campaigns/${campaign.id}/dm`);
    const herald = page.getByTestId("herald-section");
    await expect(herald).toContainText("no channel");
    await herald.getByRole("button", { name: "Hang a channel" }).click();
    await page.locator('input[name="herald-url"]').fill(hookUrl(rx.port, "/discord"));
    await page.getByRole("button", { name: "Hang it" }).click();
    await expect(herald.getByTestId("herald-url")).toContainText("/discord");
    await expect(herald).toContainText("posting");

    // The test message is Discord's shape: content, no signature headers.
    await herald.getByRole("button", { name: "Send a test" }).click();
    await waitFor(() => rx.got.length >= 1);
    expect(JSON.parse(rx.got[0].body)).toMatchObject({ content: "Quest Board can reach this channel.", username: "Quest Board", allowed_mentions: { parse: [] } });
    expect(rx.got[0].headers["x-questboard-signature"]).toBeUndefined();

    // A notice for the party reaches it, said in words with a link.
    await postQuest(page.request, campaign.id, "Rats in the cellar");
    await waitFor(() => rx.got.length >= 2);
    const posted = JSON.parse(rx.got[1].body) as { content: string };
    expect(posted.content).toContain("Rats in the cellar");
    expect(posted.content).toContain(campaign.name);
    expect(posted.content).toContain(`/questboard/campaigns/${campaign.id}>`);

    // A veiled notice is the DM's alone — not the whole table — so the
    // channel is not told, whatever it was set to hear.
    const draft = await page.request.post(`/api/campaigns/${campaign.id}/quests`, { data: { title: "The dragon", locationId: null, visibleToParty: false } });
    expect(draft.status(), await draft.text()).toBe(201);
    await new Promise((r) => setTimeout(r, 5000));
    expect(rx.got.length).toBe(2);

    // The DM's payload carries the channel; the player's never does.
    const mine = await (await page.request.get("/api/campaigns")).json();
    expect(mine.find((m: { campaign: { id: string } }) => m.campaign.id === campaign.id).campaign.channel.format).toBe("discord");
    const theirs = await (await player.get("/api/campaigns")).json();
    expect(theirs.find((m: { campaign: { id: string } }) => m.campaign.id === campaign.id).campaign.channel).toBeUndefined();
    expect((await player.put(`/api/campaigns/${campaign.id}/channel`, { data: { url: hookUrl(rx.port, "/x"), events: [] } })).status()).toBe(403);

    // Taken down: gone from the payload, and a later notice reaches nobody.
    await herald.getByRole("button", { name: "Take it down" }).click();
    await page.getByRole("button", { name: "Take it down", exact: true }).last().click();
    await expect(herald).toContainText("no channel");
    await postQuest(page.request, campaign.id, "Wolves on the road");
    await new Promise((r) => setTimeout(r, 4000));
    expect(rx.got.length).toBe(2);
    await player.dispose();
  } finally {
    rx.server.close();
  }
});

test("a person's own Discord-format hook is registered without a secret and delivers a message", async ({ page }) => {
  const rx = await receiver();
  try {
    await registerViaAPI(page.request, newAccount("dc"));
    await page.goto("/questboard/profile");
    await page.getByRole("button", { name: "New webhook" }).click();
    await page.locator('input[name="webhook-url"]').fill(hookUrl(rx.port, "/mine"));
    await page.getByRole("radio", { name: /Discord message/ }).check();
    await page.getByRole("button", { name: "Register" }).click();
    // No secret to copy: the door closes on success and the row says Discord.
    await expect(page.getByTestId("webhook-secret")).toHaveCount(0);
    const row = page.getByTestId("webhook-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("DISCORD");

    await page.getByRole("button", { name: "Ping" }).click();
    await waitFor(() => rx.got.length >= 1);
    expect(JSON.parse(rx.got[0].body)).toMatchObject({ content: "Quest Board can reach this channel." });
    await expect(page.getByTestId("delivery-log")).toContainText("delivered");

    // Through the API, the answer carries an empty secret.
    const made = await page.request.post("/api/me/webhooks", { data: { url: hookUrl(rx.port, "/api"), events: [], campaignId: null, format: "discord" } });
    expect(made.status(), await made.text()).toBe(201);
    expect((await made.json()).secret).toBe("");
  } finally {
    rx.server.close();
  }
});

test("the unsubscribe page acts on a press, never on a look, and refuses a link that is not ours", async ({ page }) => {
  await page.goto("/unsubscribe?token=not-ours");
  await expect(page.getByRole("button", { name: "Stop the emails" })).toBeVisible();
  await page.getByRole("button", { name: "Stop the emails" }).click();
  await expect(page.getByText("This link is not one of ours.")).toBeVisible();

  // No token at all: nothing to press.
  await page.goto("/unsubscribe");
  await expect(page.getByText("This link is not one of ours.")).toBeVisible();

  // The header URL: a GET is sent to the page, a bad POST is refused.
  const res = await page.request.get("/api/notifications/unsubscribe?token=abc", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("/unsubscribe?token=abc");
  const post = await page.request.post("/api/notifications/unsubscribe?token=abc", { form: { "List-Unsubscribe": "One-Click" } });
  expect(post.status()).toBe(400);
});

/*
The email itself, when the server's log can be read (E2E_SERVER_LOG, as
auth.spec.ts follows the verification link): a confirmed player is emailed
when the DM sets the next gathering — with the unsubscribe headers on it —
an unconfirmed one is not, and a muted one is not.
*/

/** Follow the logged verification link, so the address counts as confirmed. */
async function confirmAddress(ctx: APIRequestContext, logPath: string, email: string): Promise<void> {
  await expect.poll(() => readFileSync(logPath, "utf8").includes(email), { timeout: 10_000 }).toBe(true);
  const log = readFileSync(logPath, "utf8");
  const after = log.slice(log.lastIndexOf(email));
  const token = after.match(/\/verify-email\?token=([^\s"]+)/)?.[1];
  expect(token, "no verification link was logged").toBeTruthy();
  const res = await ctx.post("/api/auth/verify-email", { data: { token: decodeURIComponent(token!) } });
  expect(res.status(), await res.text()).toBe(204);
}

/** The logged mails to one address after a point in the log. */
function mailsTo(log: string, email: string): string[] {
  return log.split("mail (dev, not sent) → ").slice(1).filter((m) => m.startsWith(email));
}

test("a confirmed player is emailed about the next gathering, with a way out; the unconfirmed and the muted are not", async () => {
  const logPath = process.env.E2E_SERVER_LOG;
  test.skip(!logPath, "set E2E_SERVER_LOG to the server's log file to read the mail it would have sent");

  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("dm"));
  const campaign = await createCampaign(dm, unique("Table "));

  const confirmed = newAccount("yes");
  const confirmedCtx = await playwrightRequest.newContext();
  await registerViaAPI(confirmedCtx, confirmed);
  await confirmAddress(confirmedCtx, logPath!, confirmed.email);
  await joinCampaign(confirmedCtx, campaign.inviteCode);

  const unconfirmed = newAccount("no");
  const unconfirmedCtx = await playwrightRequest.newContext();
  await registerViaAPI(unconfirmedCtx, unconfirmed);
  await joinCampaign(unconfirmedCtx, campaign.inviteCode);

  const muted = newAccount("mute");
  const mutedCtx = await playwrightRequest.newContext();
  await registerViaAPI(mutedCtx, muted);
  await confirmAddress(mutedCtx, logPath!, muted.email);
  await joinCampaign(mutedCtx, campaign.inviteCode);
  expect((await mutedCtx.put(`/api/campaigns/${campaign.id}/mute`, { data: { muted: true } })).status()).toBe(204);

  const mark = readFileSync(logPath!, "utf8").length;
  const when = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const set = await dm.put(`/api/campaigns/${campaign.id}/next-session`, { data: { nextSessionAt: when } });
  expect(set.status(), await set.text()).toBe(200);

  await expect
    .poll(() => mailsTo(readFileSync(logPath!, "utf8").slice(mark), confirmed.email).length, { timeout: 10_000 })
    .toBe(1);
  const log = readFileSync(logPath!, "utf8").slice(mark);
  const mail = mailsTo(log, confirmed.email)[0];
  expect(mail).toContain("gathers next on");
  expect(mail).toContain(campaign.name);
  expect(mail).toContain("List-Unsubscribe: <http://localhost:8080/api/notifications/unsubscribe?token=");
  expect(mail).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  expect(mail).toContain(`/questboard/campaigns/${campaign.id}`);
  expect(mailsTo(log, unconfirmed.email)).toHaveLength(0);
  expect(mailsTo(log, muted.email)).toHaveLength(0);

  // The link in that mail is the way out: one press, and the next change
  // reaches nobody.
  const token = mail.match(/unsubscribe\?token=([^\s>]+)/)?.[1];
  expect(token).toBeTruthy();
  const stop = await confirmedCtx.post(`/api/notifications/unsubscribe?token=${token}`, { form: { "List-Unsubscribe": "One-Click" } });
  expect(stop.status()).toBe(204);
  expect((await (await confirmedCtx.get("/api/me/notifications")).json()).emailEvents).toEqual([]);
  const mark2 = readFileSync(logPath!, "utf8").length;
  await dm.put(`/api/campaigns/${campaign.id}/next-session`, { data: { nextSessionAt: new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString() } });
  await new Promise((r) => setTimeout(r, 3000));
  expect(mailsTo(readFileSync(logPath!, "utf8").slice(mark2), confirmed.email)).toHaveLength(0);

  for (const c of [dm, confirmedCtx, unconfirmedCtx, mutedCtx]) await c.dispose();
});
