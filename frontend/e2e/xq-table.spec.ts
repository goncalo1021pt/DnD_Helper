import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  joinCampaign,
  newAccount,
  quickAddHero,
  registerViaAPI,
  registerViaUI,
  unique,
} from "./helpers";

/*
Exploratory QA — the table itself (slug: table).

Founding, invite, seating approval, the two menus, chronicle, liveness:
  1. The whole front door through the UI: register, found, read the invite
     code, mark the Next Gathering, player joins by code, countdown checks.
  2. The barred door: player requests a seat, DM approves at the door, DM
     benches the hero — and at each step, what the OTHER side actually sees
     (and whether it sees it live).
  3. Props: a party handout must reach the player's open page live; one
     handed to somebody else's hero must never reach them in any payload.
  4. Dice from both roles, landing in the other role's open view live, with
     the arithmetic checked against the server's own JSON.
Timings logged as "TIMING <action> <ms>ms"; observations as "OBS ...".
*/

const SHOTS = "exp-shots/table";

function watch(page: Page, sink: string[], who: string) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // A 401 from /api/me is the login gate doing its job (see AGENTS.md), not
    // a defect — every logged-out page load makes one.
    const url = m.location()?.url ?? "";
    if (/\/api\/(auth\/)?me\b/.test(url) && /401/.test(m.text())) return;
    sink.push(`[${who}] console.error: ${m.text()} (${url})`);
  });
  page.on("pageerror", (e) => sink.push(`[${who}] pageerror: ${e.message}`));
}

async function timeUntil(locator: Locator, label: string, timeout = 12_000): Promise<number> {
  const t0 = Date.now();
  await expect(locator).toBeVisible({ timeout });
  const ms = Date.now() - t0;
  console.log(`TIMING ${label} ${ms}ms`);
  return ms;
}

async function openTimed(page: Page, url: string, ready: Locator, label: string) {
  const t0 = Date.now();
  await page.goto(url);
  await expect(ready).toBeVisible({ timeout: 20_000 });
  console.log(`TIMING ${label} ${Date.now() - t0}ms`);
}

async function propPng(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3d5a7a";
    ctx.fillRect(0, 0, 240, 160);
    return canvas.toDataURL("image/png");
  });
}

async function eventsOf(request: APIRequestContext, campaignId: string) {
  const res = await request.get(`/api/campaigns/${campaignId}/events?limit=100&category=all`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Array<{ kind: string; message: string }>;
}

/* ────────────────────────────────────────────────────────────────────────── */

test("the front door: register, found, invite, gathering, join — all through the UI", async ({
  browser,
}) => {
  const errors: string[] = [];
  const dm = newAccount("dmtable");
  const player = newAccount("pltable");
  const campaignName = unique("The Long Table ");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watch(dmPage, errors, "dm");

  // Register through the real gate.
  let t0 = Date.now();
  await registerViaUI(dmPage, dm);
  console.log(`TIMING dm-register-ui ${Date.now() - t0}ms`);

  // Found the campaign from the hall.
  t0 = Date.now();
  await dmPage.getByPlaceholder("Name of the campaign").fill(campaignName);
  await dmPage.getByRole("button", { name: "Found", exact: true }).click();
  await expect(dmPage.getByText(campaignName).first()).toBeVisible({ timeout: 15_000 });
  console.log(`TIMING found-campaign ${Date.now() - t0}ms`);
  await dmPage.screenshot({ path: `${SHOTS}/01-dm-hall-founded.png`, fullPage: true });

  // Open the hub.
  t0 = Date.now();
  await dmPage.getByText(campaignName).first().click();
  await expect(dmPage.getByText("Next Gathering", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  console.log(`TIMING open-hub ${Date.now() - t0}ms`);
  await dmPage.screenshot({ path: `${SHOTS}/02-dm-hub.png`, fullPage: true });

  // The invite: masked until deliberately revealed.
  await dmPage.getByRole("button", { name: "Invite" }).click();
  const inviteDialog = dmPage.getByRole("dialog");
  await expect(inviteDialog.getByText("••••••")).toBeVisible();
  await inviteDialog.getByRole("button", { name: "Reveal it" }).click();
  const invite = ((await inviteDialog.getByText(/^[A-Z0-9]{6}$/).textContent()) ?? "").trim();
  expect(invite).toMatch(/^[A-Z0-9]{6}$/);
  await dmPage.screenshot({ path: `${SHOTS}/03-dm-invite-revealed.png`, fullPage: true });
  await inviteDialog.getByRole("button", { name: "Done" }).click();

  // Mark the Next Gathering: 2 days, 3 hours, 30 minutes out.
  const target = new Date(Date.now() + (2 * 24 * 60 + 3 * 60 + 30) * 60_000);
  const pad = (x: number) => String(x).padStart(2, "0");
  const localInput = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(
    target.getDate(),
  )}T${pad(target.getHours())}:${pad(target.getMinutes())}`;

  await dmPage.getByTitle("Mark the date").click();
  await expect(dmPage.getByText("When Does the Table Meet?")).toBeVisible();
  await dmPage.locator('input[type="datetime-local"]').fill(localInput);
  t0 = Date.now();
  // The pencil (title) and the submit share the accessible name — take the form's.
  await dmPage.locator("form").getByRole("button", { name: "Mark the date" }).click();

  const dmCard = dmPage
    .locator("div.panel-hall")
    .filter({ has: dmPage.getByText("Next Gathering") });
  await expect(dmCard.getByText("Days")).toBeVisible({ timeout: 10_000 });
  console.log(`TIMING mark-gathering ${Date.now() - t0}ms`);
  // The countdown arithmetic on the DM's own card.
  await expect(dmCard.getByText("02", { exact: true })).toBeVisible();
  await expect(dmCard.getByText("03", { exact: true })).toBeVisible();
  await dmPage.screenshot({ path: `${SHOTS}/04-dm-gathering-set.png`, fullPage: true });

  // The player walks in with the code, through the UI.
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watch(plPage, errors, "player");
  t0 = Date.now();
  await registerViaUI(plPage, player);
  console.log(`TIMING player-register-ui ${Date.now() - t0}ms`);

  t0 = Date.now();
  await plPage.getByPlaceholder("Invite code").fill(invite);
  await plPage.getByRole("button", { name: "Join", exact: true }).click();
  await expect(plPage.getByText(campaignName).first()).toBeVisible({ timeout: 15_000 });
  console.log(`TIMING join-by-code ${Date.now() - t0}ms`);

  // Their hub shows the same countdown, not "no session marked".
  t0 = Date.now();
  await plPage.getByText(campaignName).first().click();
  await expect(plPage.getByText("Next Gathering", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  console.log(`TIMING player-open-hub ${Date.now() - t0}ms`);
  const plCard = plPage
    .locator("div.panel-hall")
    .filter({ has: plPage.getByText("Next Gathering") });
  await expect(plCard.getByText("Days")).toBeVisible({ timeout: 10_000 });
  await expect(plCard.getByText("02", { exact: true })).toBeVisible();
  await expect(plPage.getByText("No session marked")).toHaveCount(0);
  // And no pencil: the date is the DM's to move.
  await expect(plCard.getByTitle("Move or clear the date")).toHaveCount(0);
  await plPage.screenshot({ path: `${SHOTS}/05-player-hub-countdown.png`, fullPage: true });

  // The chronicle recorded the founding-day actions.
  const campaigns = (await (await dmPage.request.get("/api/campaigns")).json()) as Array<{
    campaign: { id: string; name: string };
  }>;
  const found = campaigns.find((m) => m.campaign.name === campaignName)!;
  const events = await eventsOf(plPage.request, found.campaign.id);
  expect(
    events.some((e) => e.kind === "session_set" && /The next gathering is set for/.test(e.message)),
    "marking the gathering writes a chronicle line the player can read",
  ).toBeTruthy();

  expect(errors, `console/page errors: ${errors.join(" | ")}`).toHaveLength(0);
  await dmCtx.close();
  await plCtx.close();
});

/* ────────────────────────────────────────────────────────────────────────── */

test("the barred door: request, approve, bench — and what the player sees at each step", async ({
  browser,
}) => {
  const errors: string[] = [];
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watch(dmPage, errors, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmdoor"));
  const campaign = await createCampaign(dmPage.request, unique("The Guarded Hall "));

  const player = newAccount("pldoor");
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watch(plPage, errors, "player");
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);

  // The player forges a hero (setup, not under test).
  await forgeHero(plPage.request, {
    name: "Sella",
    className: "Rogue",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 15, con: 13, int: 12, wis: 8, cha: 14 },
    skills: ["Acrobatics", "Stealth", "Perception", "Investigation"],
  });

  // ── The DM walks their menu and bars the door ────────────────────────────
  await openTimed(
    dmPage,
    `/questboard/campaigns/${campaign.id}/dm`,
    dmPage.getByRole("heading", { name: "Table Rules" }),
    "load-dm-menu",
  );
  await expect(dmPage.getByRole("heading", { name: "The Table", exact: true })).toBeVisible();
  await expect(dmPage.getByRole("heading", { name: "Disband the Table" })).toBeVisible();
  // Both members are on the ledger, and only the player can be kicked/banned.
  await expect(dmPage.getByText(player.username)).toBeVisible();
  await expect(dmPage.getByRole("button", { name: "Kick", exact: true })).toHaveCount(1);
  await expect(dmPage.getByRole("button", { name: "Ban", exact: true })).toHaveCount(1);
  await dmPage.screenshot({ path: `${SHOTS}/06-dm-menu.png`, fullPage: true });

  await dmPage
    .getByRole("combobox")
    .filter({ hasText: /heroes seat freely/ })
    .selectOption("barred");
  await expect(
    dmPage.getByRole("combobox").filter({ hasText: /you approve seats/ }),
  ).toHaveValue("barred");

  // ── The player asks for a seat from the Party page ───────────────────────
  await openTimed(
    plPage,
    `/questboard/campaigns/${campaign.id}/party`,
    plPage.getByRole("heading", { name: "The Party" }),
    "load-player-party",
  );
  const seatResp = plPage.waitForResponse(
    (r) => r.url().includes("/seat") && r.request().method() === "PUT",
  );
  await plPage.getByRole("combobox").last().selectOption({ label: "Sella" });
  await plPage.getByRole("button", { name: "Summon", exact: true }).click();
  const resp = await seatResp;
  expect(resp.status(), "a barred door lodges the request instead of seating").toBe(202);

  // What does the player see for their 202? Probe the page for ANY feedback.
  await plPage.waitForTimeout(1_500);
  const feedback = await plPage
    .getByText(/wait|door|nod|request|pending/i)
    .count();
  console.log(`OBS party-page feedback elements after 202 request: ${feedback}`);
  await plPage.screenshot({ path: `${SHOTS}/07-player-after-202.png`, fullPage: true });
  expect
    .soft(
      feedback,
      "requesting a seat at a barred door should say so on the page where the player did it",
    )
    .toBeGreaterThan(0);

  // The Player Menu does know.
  await openTimed(
    plPage,
    `/questboard/campaigns/${campaign.id}/player`,
    plPage.getByRole("heading", { name: "Your Seat" }),
    "load-player-menu",
  );
  await expect(plPage.getByText(/waiting at the door/)).toBeVisible();
  await expect(plPage.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expect(plPage.getByRole("heading", { name: "Leave the Table" })).toBeVisible();
  await plPage.screenshot({ path: `${SHOTS}/08-player-menu-waiting.png`, fullPage: true });

  // Nobody is actually seated yet.
  const rosterBefore = (await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/characters`)
  ).json()) as Array<{ name: string }>;
  expect(rosterBefore.map((c) => c.name)).not.toContain("Sella");

  // ── The DM approves at the door ──────────────────────────────────────────
  await dmPage.reload();
  await expect(dmPage.getByRole("heading", { name: "At the Door" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(dmPage.getByText("Sella")).toBeVisible();
  await dmPage.screenshot({ path: `${SHOTS}/09-dm-at-the-door.png`, fullPage: true });
  await dmPage.getByRole("button", { name: "Let them in" }).click();
  await expect(dmPage.getByRole("button", { name: "Let them in" })).toHaveCount(0, {
    timeout: 15_000,
  });

  // Does the approval reach the player's open menu without a refresh?
  let seatedLive = true;
  try {
    await expect(plPage.getByRole("button", { name: "Unseat" })).toBeVisible({
      timeout: 9_000,
    });
  } catch {
    seatedLive = false;
  }
  const stillWaiting = await plPage.getByText(/waiting at the door/).count();
  console.log(
    `OBS approval reached player live: ${seatedLive}; stale "waiting at the door" rows: ${stillWaiting}`,
  );
  await plPage.screenshot({ path: `${SHOTS}/10-player-menu-after-approval.png`, fullPage: true });
  expect
    .soft(seatedLive, "the DM's nod should reach the waiting player's open menu without a refresh")
    .toBeTruthy();

  // After a refresh the seat is real.
  await plPage.reload();
  await expect(plPage.getByRole("link", { name: "Sella" })).toBeVisible({ timeout: 20_000 });
  await expect(plPage.getByRole("button", { name: "Unseat" })).toBeVisible();
  await expect(plPage.getByText(/waiting at the door/)).toHaveCount(0);

  // ── The DM benches the hero ──────────────────────────────────────────────
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/party`);
  dmPage.on("dialog", (d) => d.accept());
  await expect(dmPage.getByRole("button", { name: "Bench" })).toBeVisible({ timeout: 20_000 });
  await dmPage.getByRole("button", { name: "Bench" }).click();
  await expect(dmPage.getByRole("button", { name: "Bench" })).toHaveCount(0, { timeout: 15_000 });

  // The player's open menu: does the bench land without a refresh?
  let benchLive = true;
  try {
    await expect(plPage.getByRole("button", { name: "Unseat" })).toHaveCount(0, {
      timeout: 9_000,
    });
  } catch {
    benchLive = false;
  }
  console.log(`OBS bench reached player live: ${benchLive}`);
  await plPage.screenshot({ path: `${SHOTS}/11-player-menu-after-bench.png`, fullPage: true });
  expect
    .soft(benchLive, "being benched should reach the player's open menu without a refresh")
    .toBeTruthy();

  // The hero is home on the shelf, and the menu says so after refresh.
  const mine = (await (await plPage.request.get("/api/me/characters")).json()) as Array<{
    name: string;
    campaignId?: string;
  }>;
  expect(mine.find((c) => c.name === "Sella")!.campaignId ?? null).toBeNull();
  await plPage.reload();
  await expect(plPage.getByText(/None of your heroes sit here yet/)).toBeVisible({
    timeout: 20_000,
  });
  await plPage.screenshot({ path: `${SHOTS}/12-player-menu-benched.png`, fullPage: true });

  // Every step wrote its chronicle line.
  const messages = (await eventsOf(plPage.request, campaign.id)).map((e) => e.message);
  expect(messages).toContain("Sella waits at the door for the DM's nod");
  expect(messages).toContain(
    "The DM waves Sella through the door — they take a seat at the table",
  );
  expect(messages).toContain(
    `The DM benches Sella — the hero returns to ${player.username}'s shelf`,
  );

  expect(errors, `console/page errors: ${errors.join(" | ")}`).toHaveLength(0);
  await dmCtx.close();
  await plCtx.close();
});

/* ────────────────────────────────────────────────────────────────────────── */

test("a party prop crosses live; one handed to somebody else's hero never leaks", async ({
  browser,
}) => {
  const errors: string[] = [];
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watch(dmPage, errors, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmsatchel"));
  const campaign = await createCampaign(dmPage.request, unique("The Satchel Table "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watch(plPage, errors, "player");
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plsatchel"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  // A table-born hero of the DM's — the "somebody else" the secret goes to.
  const captainId = await quickAddHero(dmPage.request, campaign.id, "Guard Captain");

  // The player sits on their chronicle and never refreshes again.
  await openTimed(
    plPage,
    `/questboard/campaigns/${campaign.id}/chronicle`,
    plPage.getByRole("heading", { name: "The Chronicle" }),
    "load-player-chronicle",
  );
  await plPage.waitForTimeout(1_200); // let the stream connect

  const png = await propPng(dmPage);

  // A party-visible prop must arrive on its own.
  const letterRes = await dmPage.request.post(`/api/campaigns/${campaign.id}/handouts`, {
    data: {
      title: "The tavern letter",
      caption: "Read aloud at the bar",
      imageBase64: png,
      visibleToParty: true,
    },
  });
  expect(letterRes.ok(), await letterRes.text()).toBeTruthy();
  await timeUntil(plPage.getByRole("button", { name: "The tavern letter" }), "sse-party-handout");
  await expect(
    plPage.getByText("The DM hands the table The tavern letter — Read aloud at the bar"),
  ).toBeVisible();
  await plPage.screenshot({ path: `${SHOTS}/13-player-party-prop-live.png`, fullPage: true });

  // A second prop, veiled, then handed to the DM's OWN hero — not the player's.
  const secretRes = await dmPage.request.post(`/api/campaigns/${campaign.id}/handouts`, {
    data: {
      title: "The captain's orders",
      caption: "For the captain alone",
      imageBase64: png,
      visibleToParty: false,
    },
  });
  expect(secretRes.ok(), await secretRes.text()).toBeTruthy();
  const secretId = (await secretRes.json()).id as string;
  const toCaptain = await dmPage.request.put(`/api/handouts/${secretId}/visibility`, {
    data: { scope: "character", characterId: captainId, visible: true },
  });
  expect(toCaptain.ok(), await toCaptain.text()).toBeTruthy();

  // Give the nudge time to do its worst, then check every direction.
  await plPage.waitForTimeout(2_500);
  const satchel = (await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/handouts`)
  ).json()) as Array<{ title: string }>;
  expect(
    satchel.map((h) => h.title),
    "a prop handed to somebody else's hero must be absent from the player's payload",
  ).not.toContain("The captain's orders");
  expect(
    (await plPage.request.get(`/api/handouts/${secretId}/image`)).status(),
    "its picture must not serve to a player who guesses the URL",
  ).toBe(404);
  const playerFeed = (await eventsOf(plPage.request, campaign.id)).map((e) => e.message);
  expect(
    playerFeed.some((m) => m.includes("The captain's orders")),
    "the chronicle line naming it must be withheld with it",
  ).toBeFalsy();
  await expect(plPage.getByText("The captain's orders")).toHaveCount(0);
  await plPage.screenshot({ path: `${SHOTS}/14-player-secret-absent.png`, fullPage: true });

  // The DM opens it to the whole party — it must arrive live.
  const toParty = await dmPage.request.put(`/api/handouts/${secretId}/visibility`, {
    data: { scope: "party", visible: true },
  });
  expect(toParty.ok(), await toParty.text()).toBeTruthy();
  await timeUntil(
    plPage.getByRole("button", { name: "The captain's orders" }),
    "sse-revealed-handout",
  );
  expect((await plPage.request.get(`/api/handouts/${secretId}/image`)).ok()).toBeTruthy();
  await plPage.screenshot({ path: `${SHOTS}/15-player-secret-revealed-live.png`, fullPage: true });

  expect(errors, `console/page errors: ${errors.join(" | ")}`).toHaveLength(0);
  await dmCtx.close();
  await plCtx.close();
});

/* ────────────────────────────────────────────────────────────────────────── */

test("dice from both roles land in the other's open view live, math intact", async ({
  browser,
}) => {
  const errors: string[] = [];
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watch(dmPage, errors, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmtower"));
  const campaign = await createCampaign(dmPage.request, unique("The Tower Table "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watch(plPage, errors, "player");
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("pltower"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  // DM reads the chronicle; player sits on the hub, whose tower is built in.
  await openTimed(
    dmPage,
    `/questboard/campaigns/${campaign.id}/chronicle`,
    dmPage.getByRole("heading", { name: "The Chronicle" }),
    "load-dm-chronicle",
  );
  await openTimed(
    plPage,
    `/questboard/campaigns/${campaign.id}`,
    plPage.getByText("Next Gathering"),
    "load-player-hub",
  );
  await plPage.waitForTimeout(1_200);

  // ── Player rolls 3d6 + 2 in the open ─────────────────────────────────────
  for (let i = 0; i < 3; i++) await plPage.getByLabel("Add a d6").click();
  await plPage.getByTitle("Raise modifier").click();
  await plPage.getByTitle("Raise modifier").click();
  await plPage.getByLabel(/Roll in the open/).check();
  const plRollResp = plPage.waitForResponse(
    (r) => r.url().includes("/rolls") && r.request().method() === "POST",
  );
  await plPage.getByRole("button", { name: "Roll 3d6 + 2" }).click();
  const plResp = await plRollResp;
  expect(plResp.status(), await plResp.text()).toBe(201);
  const plRoll = (await plResp.json()) as {
    total: number;
    modifier: number;
    groups: Array<{ sides: number; results: number[] }>;
  };
  const faces = plRoll.groups.flatMap((g) => g.results);
  expect(faces).toHaveLength(3);
  for (const f of faces) {
    expect(f).toBeGreaterThanOrEqual(1);
    expect(f).toBeLessThanOrEqual(6);
  }
  expect(
    faces.reduce((a, b) => a + b, 0) + 2,
    "the server's faces plus the modifier must equal its total",
  ).toBe(plRoll.total);

  // The DM's open chronicle hears it without navigation.
  const dmLine = dmPage.getByText(/rolls 3d6 \+ 2:/);
  await timeUntil(dmLine, "sse-player-roll-to-dm-chronicle");
  const dmText = (await dmLine.textContent()) ?? "";
  const m = dmText.match(/3d6 \+ 2: (\d+), (\d+), (\d+) \+ 2 = (\d+)/);
  expect(m, `the line shows its working: "${dmText}"`).toBeTruthy();
  const printed = m!.slice(1, 4).map(Number);
  expect(printed.reduce((a, b) => a + b, 0) + 2).toBe(Number(m![4]));
  expect(Number(m![4]), "the printed total is the server's total").toBe(plRoll.total);
  await dmPage.screenshot({ path: `${SHOTS}/16-dm-chronicle-player-roll.png`, fullPage: true });

  // And the Rolls channel filter carries it too.
  await dmPage.getByRole("button", { name: "Rolls", exact: true }).click();
  await expect(dmPage.getByText(/rolls 3d6 \+ 2:/)).toBeVisible({ timeout: 10_000 });

  // ── DM rolls 1d20 − 1 in the open from the hub ───────────────────────────
  await openTimed(
    dmPage,
    `/questboard/campaigns/${campaign.id}`,
    dmPage.getByText("Next Gathering"),
    "load-dm-hub",
  );
  await dmPage.getByLabel("Add a d20").click();
  await dmPage.getByTitle("Lower modifier").click();
  await dmPage.getByLabel(/Roll in the open/).check();
  const dmRollResp = dmPage.waitForResponse(
    (r) => r.url().includes("/rolls") && r.request().method() === "POST",
  );
  await dmPage.getByRole("button", { name: "Roll 1d20 − 1" }).click();
  const dmResp = await dmRollResp;
  expect(dmResp.status(), await dmResp.text()).toBe(201);
  const dmRoll = (await dmResp.json()) as {
    total: number;
    groups: Array<{ sides: number; results: number[] }>;
  };
  const face = dmRoll.groups[0].results[0];
  expect(face - 1, "a negative modifier subtracts").toBe(dmRoll.total);

  // The player's open hub (chronicle block) hears the DM's roll live.
  const plLine = plPage.getByText(/rolls 1d20 − 1:/);
  await timeUntil(plLine, "sse-dm-roll-to-player-hub");
  const plText = (await plLine.textContent()) ?? "";
  const n = plText.match(/1d20 − 1: (\d+) − 1 = (-?\d+)/);
  expect(n, `the line shows its working: "${plText}"`).toBeTruthy();
  expect(Number(n![1])).toBe(face);
  expect(Number(n![2])).toBe(dmRoll.total);
  await plPage.screenshot({ path: `${SHOTS}/17-player-hub-dm-roll.png`, fullPage: true });

  // Exactly two rolls on the record.
  const rolls = (await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/events?limit=50&category=rolls`)
  ).json()) as unknown[];
  expect(rolls).toHaveLength(2);

  expect(errors, `console/page errors: ${errors.join(" | ")}`).toHaveLength(0);
  await dmCtx.close();
  await plCtx.close();
});
