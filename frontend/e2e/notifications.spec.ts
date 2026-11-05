import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { createCampaign, forgeHero, joinCampaign, newAccount, postQuest, registerViaAPI, seatHero, unique } from "./helpers";

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
  // The picker speaks to a person (#347): groups, a sentence per row, no catalogue names.
  await expect(section.getByText("The board", { exact: true })).toBeVisible();
  await expect(section.getByText("The next gathering changes date")).toBeVisible();
  await expect(section.getByText("session.moved")).toHaveCount(0);
  const mode = (event: string, value: string) => section.locator(`input[name="email-${event}"][value="${value}"]`);
  // Each event is off, now or daily (#339): a radio group, and the defaults show as "now".
  await expect(mode("session.moved", "now")).toBeChecked();
  await expect(mode("quest.posted", "off")).toBeChecked();
  // The chronicle is daily or nothing: a line per email is a flood, so it has no "now".
  await expect(mode("chronicle.written", "now")).toHaveCount(0);
  await expect(mode("chronicle.written", "off")).toBeChecked();
  // The digest hour appears only once something is daily.
  await expect(page.getByTestId("digest-hour")).toHaveCount(0);

  await mode("session.moved", "off").check();
  await mode("quest.posted", "now").check();
  await mode("chronicle.written", "daily").check();
  await expect(page.getByTestId("digest-hour")).toBeVisible();
  await expect(mode("quest.posted", "now")).toBeChecked();
  await page.reload();
  const again = page.getByTestId("notifications-settings");
  await expect(again.locator('input[name="email-session.moved"][value="off"]')).toBeChecked();
  await expect(again.locator('input[name="email-quest.posted"][value="now"]')).toBeChecked();
  await expect(again.locator('input[name="email-chronicle.written"][value="daily"]')).toBeChecked();

  // The hour is a UTC hour on the wire, shown in the reader's own time.
  await again.locator('select[name="digest-hour"]').selectOption("7");
  await expect.poll(async () => (await (await page.request.get("/api/me/notifications")).json()).digestHour).toBe(7);

  // Through the API: the chronicle is refused as it happens, an empty list is none,
  // and the digest list is left alone when a script does not send it.
  const refused = await page.request.put("/api/me/notifications", { data: { emailEvents: ["chronicle.written"] } });
  expect(refused.status()).toBe(400);
  const both = await page.request.put("/api/me/notifications", { data: { emailEvents: ["quest.posted"], digestEvents: ["quest.posted"] } });
  expect(both.status(), "one event, one cadence").toBe(400);
  const badHour = await page.request.put("/api/me/notifications", { data: { emailEvents: [], digestHour: 24 } });
  expect(badHour.status()).toBe(400);
  const none = await page.request.put("/api/me/notifications", { data: { emailEvents: [] } });
  expect(none.status()).toBe(200);
  const kept = await none.json();
  expect(kept.emailEvents).toEqual([]);
  expect(kept.digestEvents, "absent leaves the digest alone, so an older script keeps working").toEqual(["chronicle.written"]);
  expect(kept.digestHour).toBe(7);
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
    // A second player, so a reveal to one hero of two can be seen not to
    // be public (#344); joining is itself an event, so it happens before
    // the channel is hung.
    const other = await playwrightRequest.newContext();
    await registerViaAPI(other, newAccount("other"));
    await joinCampaign(other, campaign.inviteCode);

    // Hung from the DM menu.
    await page.goto(`/questboard/campaigns/${campaign.id}/dm`);
    const herald = page.getByTestId("herald-section");
    await expect(herald).toContainText("no channel");
    await herald.getByRole("button", { name: "Connect a channel" }).click();
    await page.locator('input[name="herald-url"]').fill(hookUrl(rx.port, "/discord"));
    // The Herald's picker opens on Everything and never shows a catalogue name (#347).
    await expect(page.getByRole("dialog").locator('input[name="herald-everything"]')).toBeChecked();
    await expect(page.getByRole("dialog").getByText("session.scheduled")).toHaveCount(0);
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
    const draftId = (await draft.json()).id as string;
    await new Promise((r) => setTimeout(r, 5000));
    expect(rx.got.length).toBe(2);

    // Publicness is the emitter's word, not the audience's (#344). Two
    // heroes at the table: revealing the draft to one of them tells one
    // player and posts nothing; revealing it to the table tells only the
    // player newly reached, yet every player may see it now — posted.
    const aHero = (name: string) => ({
      name,
      className: "Barbarian",
      speciesName: "Dwarf",
      backgroundName: "Acolyte",
      abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
      skills: ["Athletics", "Survival"],
    });
    const first = await forgeHero(player, aHero(unique("First ")));
    await seatHero(player, first, campaign.id);
    const second = await forgeHero(other, aHero(unique("Second ")));
    await seatHero(other, second, campaign.id);
    const toOne = await page.request.put(`/api/quests/${draftId}/visibility`, { data: { scope: "character", visible: true, characterId: first } });
    expect(toOne.status(), await toOne.text()).toBe(200);
    await new Promise((r) => setTimeout(r, 4000));
    expect(rx.got.length, "revealed to one hero of two: not public").toBe(2);
    const toTable = await page.request.put(`/api/quests/${draftId}/visibility`, { data: { scope: "table", visible: true } });
    expect(toTable.status(), await toTable.text()).toBe(200);
    await waitFor(() => rx.got.length >= 3);
    expect((JSON.parse(rx.got[2].body) as { content: string }).content).toContain("The dragon");

    // XP is told to each hero's owner and the DMs, and stands on the roster
    // for all: public, one post per hero.
    const xp = await page.request.post(`/api/campaigns/${campaign.id}/xp`, { data: { amount: 50 } });
    expect(xp.status(), await xp.text()).toBe(200);
    await waitFor(() => rx.got.length >= 5);
    expect(rx.got.slice(3).every((r) => (JSON.parse(r.body) as { content: string }).content.includes("XP"))).toBeTruthy();
    await other.dispose();

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
    expect(rx.got.length).toBe(5);
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

/*
The daily digest (#339). Events a person asked for daily are held and sent as
one message at their hour; the dev door (`POST /api/dev/send-digests`, never
mounted in production) makes everything held due and runs both passes once, so
nothing here waits for 18:00.
*/

const sendDigests = async (ctx: APIRequestContext) => {
  const res = await ctx.post("/api/dev/send-digests");
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { emails: number; deliveries: number };
};

test("a daily Discord hook gets one message for the day, one embed per table; a signed hook cannot be daily", async ({ page }) => {
  const rx = await receiver();
  try {
    await registerViaAPI(page.request, newAccount("dd"));
    const campaign = await createCampaign(page.request, unique("Digest "));

    // Daily is for a Discord message alone: a script wants each event as it happens.
    const refused = await page.request.post("/api/me/webhooks", { data: { url: hookUrl(rx.port, "/signed"), events: [], campaignId: null, cadence: "daily" } });
    expect(refused.status(), "a signed hook cannot be daily").toBe(400);
    const badHour = await page.request.post("/api/me/webhooks", { data: { url: hookUrl(rx.port, "/h"), events: [], campaignId: null, format: "discord", cadence: "daily", digestHour: 30 } });
    expect(badHour.status()).toBe(400);

    // Through the form: pick Discord, then "Once a day".
    await page.goto("/questboard/profile");
    await page.getByRole("button", { name: "New webhook" }).click();
    await page.locator('input[name="webhook-url"]').fill(hookUrl(rx.port, "/daily"));
    await page.getByRole("radio", { name: /Discord message/ }).check();
    await page.getByRole("radio", { name: /Once a day/ }).check();
    await page.locator('input[name="event-quest.posted"]').check();
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.getByTestId("hook-daily")).toBeVisible();

    // Two events, nothing sent yet.
    await postQuest(page.request, campaign.id, "Rats in the cellar");
    await postQuest(page.request, campaign.id, "Wolves on the road");
    await new Promise((r) => setTimeout(r, 3000));
    expect(rx.got.length, "held for the digest, not sent as it happens").toBe(0);

    // The hour strikes: one delivery carrying both.
    const first = await sendDigests(page.request);
    expect(first.deliveries).toBe(1);
    await waitFor(() => rx.got.length >= 1);
    expect(rx.got.length).toBe(1);
    const msg = JSON.parse(rx.got[0].body) as { embeds: { title: string; description: string; url?: string }[]; allowed_mentions: { parse: string[] } };
    expect(msg.embeds).toHaveLength(1);
    expect(msg.embeds[0].title).toBe(campaign.name);
    expect(msg.embeds[0].description).toContain("Rats in the cellar");
    expect(msg.embeds[0].description).toContain("Wolves on the road");
    expect(msg.embeds[0].url).toContain(`/questboard/campaigns/${campaign.id}`);
    expect(msg.allowed_mentions.parse).toEqual([]);

    // The log shows one delivery carrying two events.
    const hook = (await (await page.request.get("/api/me/webhooks")).json())[0] as { id: string };
    const log = (await (await page.request.get(`/api/me/webhooks/${hook.id}/deliveries`)).json()) as { name: string; carries: number }[];
    expect(log.filter((d) => d.name === "digest")).toEqual([expect.objectContaining({ carries: 2 })]);
    await page.getByRole("button", { name: "Deliveries" }).click();
    await expect(page.getByTestId("delivery-log")).toContainText("daily digest");
    await expect(page.getByTestId("delivery-log")).toContainText("2 events");

    // A digest with nothing in it sends nothing.
    const quiet = await sendDigests(page.request);
    expect(quiet.deliveries).toBe(0);
    await new Promise((r) => setTimeout(r, 3000));
    expect(rx.got.length).toBe(1);
  } finally {
    rx.server.close();
  }
});

test("the table's channel can be daily: it hears nothing until the hour, then one message", async ({ page }) => {
  const rx = await receiver();
  try {
    await registerViaAPI(page.request, newAccount("hd"));
    const campaign = await createCampaign(page.request, unique("Herald "));
    await page.goto(`/questboard/campaigns/${campaign.id}/dm`);
    const herald = page.getByTestId("herald-section");
    await herald.getByRole("button", { name: "Connect a channel" }).click();
    await page.locator('input[name="herald-url"]').fill(hookUrl(rx.port, "/herald"));
    await page.getByRole("dialog").getByRole("radio", { name: /Once a day/ }).check();
    await page.getByRole("button", { name: "Hang it" }).click();
    await expect(herald.getByTestId("herald-daily")).toBeVisible();

    await postQuest(page.request, campaign.id, "Rats in the cellar");
    await postQuest(page.request, campaign.id, "Wolves on the road");
    await new Promise((r) => setTimeout(r, 3000));
    expect(rx.got.length).toBe(0);
    expect((await sendDigests(page.request)).deliveries).toBe(1);
    await waitFor(() => rx.got.length >= 1);
    const msg = JSON.parse(rx.got[0].body) as { embeds: { description: string }[] };
    expect(msg.embeds[0].description).toContain("Rats in the cellar");
    expect(msg.embeds[0].description).toContain("Wolves on the road");

    // Setting it back to immediate: what is held is sent on the next pass,
    // and from then on each event goes at once.
    await postQuest(page.request, campaign.id, "A third thing");
    const back = await page.request.put(`/api/campaigns/${campaign.id}/channel`, { data: { url: hookUrl(rx.port, "/herald"), events: [], cadence: "immediate" } });
    expect(back.status(), await back.text()).toBe(200);
    expect((await sendDigests(page.request)).deliveries).toBe(1);
    await waitFor(() => rx.got.length >= 2);
    await postQuest(page.request, campaign.id, "A fourth thing");
    await waitFor(() => rx.got.length >= 3);
    expect((JSON.parse(rx.got[2].body) as { content: string }).content).toContain("A fourth thing");
  } finally {
    rx.server.close();
  }
});

test("a player's daily email is one message with both lines, and a quiet day sends none", async () => {
  const logPath = process.env.E2E_SERVER_LOG;
  test.skip(!logPath, "set E2E_SERVER_LOG to the server's log file to read the mail it would have sent");

  const dm = await playwrightRequest.newContext();
  await registerViaAPI(dm, newAccount("dm"));
  const campaign = await createCampaign(dm, unique("Table "));
  const fan = newAccount("fan");
  const fanCtx = await playwrightRequest.newContext();
  await registerViaAPI(fanCtx, fan);
  await confirmAddress(fanCtx, logPath!, fan.email);
  await joinCampaign(fanCtx, campaign.inviteCode);

  // Chronicle lines daily, nothing else.
  const set = await fanCtx.put("/api/me/notifications", { data: { emailEvents: [], digestEvents: ["chronicle.written"] } });
  expect(set.status(), await set.text()).toBe(200);

  const mark = readFileSync(logPath!, "utf8").length;
  for (const line of ["The bridge is out", "Torches at the ford"]) {
    expect((await dm.post(`/api/campaigns/${campaign.id}/events`, { data: { message: line } })).status()).toBe(201);
  }
  await new Promise((r) => setTimeout(r, 3000));
  expect(mailsTo(readFileSync(logPath!, "utf8").slice(mark), fan.email), "held, not sent as it happens").toHaveLength(0);

  expect((await sendDigests(dm)).emails).toBeGreaterThanOrEqual(1);
  await expect.poll(() => mailsTo(readFileSync(logPath!, "utf8").slice(mark), fan.email).length, { timeout: 10_000 }).toBe(1);
  const mail = mailsTo(readFileSync(logPath!, "utf8").slice(mark), fan.email)[0];
  expect(mail).toContain(campaign.name);
  expect(mail).toContain("The bridge is out");
  expect(mail).toContain("Torches at the ford");
  expect(mail).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");

  // Nothing new: nothing sent.
  const mark2 = readFileSync(logPath!, "utf8").length;
  await sendDigests(dm);
  await new Promise((r) => setTimeout(r, 2000));
  expect(mailsTo(readFileSync(logPath!, "utf8").slice(mark2), fan.email)).toHaveLength(0);

  // A line held, then taken out of the digest, never arrives.
  await dm.post(`/api/campaigns/${campaign.id}/events`, { data: { message: "A late line" } });
  await new Promise((r) => setTimeout(r, 1500));
  expect((await fanCtx.put("/api/me/notifications", { data: { emailEvents: [], digestEvents: [] } })).status()).toBe(200);
  const mark3 = readFileSync(logPath!, "utf8").length;
  await sendDigests(dm);
  await new Promise((r) => setTimeout(r, 2000));
  expect(mailsTo(readFileSync(logPath!, "utf8").slice(mark3), fan.email)).toHaveLength(0);

  await dm.dispose();
  await fanCtx.dispose();
});
