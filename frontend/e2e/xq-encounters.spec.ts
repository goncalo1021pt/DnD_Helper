import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  forgeHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  seatHero,
  unique,
} from "./helpers";

/*
Exploratory QA — Encounters: the Den, initiative, the Bestiary.

Three journeys:
  1. The DM scribes a custom monster through the Den UI and its numbers land
     as integers (the ac/hp string gotcha silently blanks stat blocks).
  2. A fight: prepared from the Den + the seated party, filed under a session
     tag and a place, triggered, run — HP, conditions, and what a player is
     allowed to see of it (payloads checked, not just pixels).
  3. The Bestiary: the fought creature revealed to the party one section at a
     time, with the unrevealed sections never crossing the wire.
*/

type Timing = { action: string; ms: number };

async function timed<T>(sink: Timing[], action: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  const ms = Date.now() - t0;
  sink.push({ action, ms });
  console.log(`TIMING ${action} ${ms}ms`);
  return out;
}

function wireConsole(page: Page, label: string, sink: string[]) {
  page.on("console", (msg) => {
    if (msg.type() === "error") sink.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => sink.push(`[${label}] pageerror: ${err.message}`));
}

function dumpConsole(sink: string[]) {
  for (const line of sink) console.log(`CONSOLE ${line}`);
  if (sink.length === 0) console.log("CONSOLE clean — no errors captured");
}

/* The custom monster both fights and bestiary reveals lean on. The description
   carries a distinctive trait and action so a leak of either is greppable in
   any payload. */
const MONSTER_DESC =
  "**Traits**\n\n**Mire Camouflage.** While in swampy terrain, the tyrant has Advantage on Dexterity (Stealth) checks.\n\n**Actions**\n\n**Bite.** _Melee Attack Roll:_ +6, reach 5 ft. _Hit:_ 12 (2d8 + 3) Piercing damage.";

function monsterData() {
  return {
    size: "Large",
    type: "Monstrosity",
    alignment: "Neutral Evil",
    ac: 17,
    hp: 45,
    speed: "30 ft., Swim 30 ft.",
    cr: "3 (XP 700; PB +2)",
    crValue: 3,
    abilities: { str: 18, dex: 14, con: 16, int: 6, wis: 12, cha: 7 },
    description: MONSTER_DESC,
  };
}

async function scribeMonsterViaAPI(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/rules/monster", {
    data: { name, summary: "A terror of the fen", data: monsterData() },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

/* A combatant row in the tracker (lone rows and group roots both wear
   rounded-[3px]); scoped by the name it carries and the HP amount box only a
   real row has. */
function rowOf(page: Page, name: string) {
  return page
    .locator('div.rounded-\\[3px\\]')
    .filter({ hasText: name })
    .filter({ has: page.getByTitle("Amount to damage or heal") })
    .last();
}

/* ══════════════════════ 1. The Den, through the UI ═══════════════════════ */

test("Den: a monster scribed in the guided form lands with integer ac/hp and a live stat card", async ({
  page,
}) => {
  const timings: Timing[] = [];
  const errors: string[] = [];
  wireConsole(page, "dm", errors);

  await registerViaAPI(page.request, newAccount("xqden"));
  const campaign = await createCampaign(page.request, unique("Fen Table "));
  const name = unique("Bog Tyrant ");

  await timed(timings, "den page load", async () => {
    await page.goto(`/questboard/campaigns/${campaign.id}/den`);
    await expect(page.getByRole("heading", { name: "The Monster Den" })).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ creatures/)).toBeVisible();
  });
  await page.screenshot({ path: "exp-shots/encounters/01-den.png", fullPage: true });

  await page.getByRole("button", { name: "Scribe a Monster" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "Scribe a Monster" })).toBeVisible();

  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Summary").fill("A terror of the fen");
  await form.getByLabel("Type", { exact: true }).fill("Monstrosity");
  await form.getByLabel("Alignment").fill("Neutral Evil");
  await form.getByLabel("AC", { exact: true }).fill("17");
  await form.getByLabel("Hit points", { exact: true }).fill("45");
  await form.getByLabel("Speed").fill("30 ft., Swim 30 ft.");
  await form.getByLabel("Challenge").fill("3 (XP 700; PB +2)");
  // The derived note tells the DM what the Den will sort/weigh this by.
  await expect(form.getByText(/sorts and weighs as CR 3/)).toBeVisible();
  await form.getByLabel("STR", { exact: true }).fill("18");
  await form.getByLabel("DEX", { exact: true }).fill("14");
  await form.getByLabel(/The stat block/).fill(MONSTER_DESC);
  await page.screenshot({ path: "exp-shots/encounters/02-scribe-form.png", fullPage: true });

  await timed(timings, "scribe it (create monster)", async () => {
    await form.getByRole("button", { name: "Scribe It" }).click();
    await page.getByPlaceholder("Search by name or type…").fill(name);
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible({
      timeout: 15_000,
    });
  });

  // Its card wears the CR the DM wrote, and the stat block renders numbers.
  const card = page.getByRole("button", { name: new RegExp(`^${name}`) });
  await expect(card).toContainText("CR 3");
  await card.click();
  const reading = page.getByRole("dialog");
  await expect(reading.getByText("17", { exact: true })).toBeVisible();
  await expect(reading.getByText("45", { exact: true })).toBeVisible();
  await expect(reading.getByText(/Mire Camouflage/)).toBeVisible();
  await page.screenshot({ path: "exp-shots/encounters/03-stat-card.png", fullPage: true });

  // And under the covers: numbers, not strings — the silent killer.
  const list = (await (await page.request.get("/api/rules/monster")).json()) as Array<{
    name: string;
    data: Record<string, unknown>;
  }>;
  const mine = list.find((m) => m.name === name);
  expect(mine, "the scribed monster is in the Den list").toBeTruthy();
  expect(typeof mine!.data.ac, "ac must be stored as a number").toBe("number");
  expect(typeof mine!.data.hp, "hp must be stored as a number").toBe("number");
  expect(mine!.data.ac).toBe(17);
  expect(mine!.data.hp).toBe(45);
  expect(mine!.data.crValue).toBe(3);

  dumpConsole(errors);
});

/* ═══════════ 2. The fight: prepare, file, trigger, run, watch ════════════ */

test("a filed fight from Den + party: initiative, HP, conditions — and the player's redacted window", async ({
  browser,
}) => {
  test.slow();
  const timings: Timing[] = [];
  const errors: string[] = [];

  // --- setup, all API: two people, a campaign, a place, a monster, a hero ---
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  wireConsole(dmPage, "dm", errors);
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("xqedm"));
  const campaign = await createCampaign(dmPage.request, unique("Mill Table "));
  const locId = await createLocation(dmPage.request, campaign.id, "The Sunken Mill");
  const monsterName = unique("Marsh Horror ");
  await scribeMonsterViaAPI(dmPage.request, monsterName);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  wireConsole(plPage, "player", errors);
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("xqepl"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  const heroName = unique("Grash ");
  const heroId = await forgeHero(plPage.request, {
    name: heroName,
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });
  await seatHero(plPage.request, heroId, campaign.id);

  // --- prepare + file, through the UI --------------------------------------
  await timed(timings, "encounters page load (DM)", async () => {
    await dmPage.goto(`/questboard/campaigns/${campaign.id}/encounters`);
    await expect(dmPage.getByPlaceholder("Prepare a new encounter — name it…")).toBeVisible();
  });

  await dmPage.getByPlaceholder("Prepare a new encounter — name it…").fill("The Mill Ambush");
  await dmPage.getByPlaceholder("Session or act…").fill("Session 12");
  await dmPage.getByTitle("The place this fight is prepared for").selectOption(locId);
  await timed(timings, "prepare encounter", async () => {
    await dmPage.getByRole("button", { name: "Prepare", exact: true }).click();
    await expect(dmPage.getByText("The Mill Ambush")).toBeVisible();
  });

  // Preparing lands us inside the fight, filing intact.
  await expect(dmPage.getByText(/INACTIVE/i)).toBeVisible();
  await expect(dmPage.getByText("Filed under")).toBeVisible();
  await expect(dmPage.getByPlaceholder("Session or act…")).toHaveValue("Session 12");
  await expect(dmPage.getByTitle("The place this fight is prepared for")).toHaveValue(locId);

  // --- stock it: the custom horror, plus a mob of two goblins --------------
  await dmPage.getByPlaceholder("Search monsters…").fill(monsterName);
  const add = dmPage.getByRole("button", { name: "Add", exact: true }).first();
  await expect(add).toBeEnabled({ timeout: 20_000 });
  await add.click();
  await expect(dmPage.getByText("1 joined")).toBeVisible();

  await dmPage.getByPlaceholder("Search monsters…").fill("Goblin Warrior");
  await expect(dmPage.getByRole("button", { name: "Add", exact: true }).first()).toBeEnabled({
    timeout: 20_000,
  });
  await dmPage.getByTitle("One more").first().click(); // ×2 → a mob
  await dmPage.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(dmPage.getByText("3 joined")).toBeVisible();

  // The difficulty meter counts the party and weighs the fight.
  const meter = dmPage.getByRole("group", { name: "Encounter difficulty" });
  await expect(meter).toBeVisible();
  await expect(meter.getByRole("button", { name: new RegExp(`^${heroName}`) })).toBeVisible();
  await expect(meter.getByText(/XP in the fight/)).toBeVisible();
  console.log("OBSERVED difficulty meter: " + (await meter.innerText()).replace(/\n/g, " | "));
  await dmPage.screenshot({ path: "exp-shots/encounters/04-builder-stocked.png", fullPage: true });

  // --- trigger -------------------------------------------------------------
  await timed(timings, "trigger the fight", async () => {
    await dmPage.getByRole("button", { name: /Trigger/ }).click();
    await expect(dmPage.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });
  });

  // "Your party joins once you trigger the fight" — but nothing joins by
  // itself: the DM switches the add-bar to Party and summons them. (The first
  // select on the page is the filing bar's place picker, so find the one that
  // actually offers Party.)
  await dmPage.locator('select:has(option[value="pc"])').selectOption("pc");
  await timed(timings, "summon party", async () => {
    await dmPage.getByRole("button", { name: "Summon party" }).click();
    await expect(dmPage.getByText(heroName).first()).toBeVisible();
  });

  // --- initiative ----------------------------------------------------------
  const encList = (await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/encounters`)
  ).json()) as Array<{ id: string; name: string }>;
  const encId = encList.find((e) => e.name === "The Mill Ambush")!.id;

  await timed(timings, "roll all initiative", async () => {
    await dmPage.getByRole("button", { name: /Roll all initiative/ }).click();
    await expect(dmPage.getByTitle("Type an initiative").first()).not.toHaveValue("", {
      timeout: 15_000,
    });
  });

  const detail = (await (await dmPage.request.get(`/api/encounters/${encId}`)).json()) as {
    combatants: Array<{
      name: string;
      kind: string;
      initiative: number | null;
      hpCurrent: number;
      hpMax: number;
      ac: number;
      groupId: string | null;
    }>;
  };
  for (const c of detail.combatants) {
    expect(c.initiative, `${c.name} rolled`).not.toBeNull();
  }
  // Order: highest first, mob members side by side — the payload order IS the
  // displayed order, so a broken sort breaks the table in front of everyone.
  const inits = detail.combatants.map((c) => c.initiative!) as number[];
  for (let i = 1; i < inits.length; i++) {
    expect(inits[i], `initiative order non-increasing at row ${i}`).toBeLessThanOrEqual(
      inits[i - 1],
    );
  }
  // And the custom horror was seated at ITS numbers, not zeros.
  const horror = detail.combatants.find((c) => c.name === monsterName)!;
  expect(horror.ac, "custom monster AC reaches the tracker").toBe(17);
  expect(horror.hpMax, "custom monster HP reaches the tracker").toBe(45);
  await dmPage.screenshot({ path: "exp-shots/encounters/05-tracker-rolled.png", fullPage: true });

  // --- HP edits stick ------------------------------------------------------
  const mrow = rowOf(dmPage, monsterName);
  await timed(timings, "damage 7 (type + click)", async () => {
    await mrow.getByTitle("Amount to damage or heal").fill("7");
    await mrow.getByTitle("Damage", { exact: true }).click();
    await expect(mrow.getByText("38/45")).toBeVisible();
  });
  await mrow.getByTitle("Amount to damage or heal").fill("3");
  await mrow.getByTitle("Heal", { exact: true }).click();
  await expect(mrow.getByText("41/45")).toBeVisible();

  // --- conditions apply, and clear -----------------------------------------
  const hrow = rowOf(dmPage, heroName);
  await hrow.getByTitle("Conditions").click();
  const panel = hrow.locator("div.absolute");
  await panel.getByRole("button", { name: "Poisoned", exact: true }).click();
  await panel.getByRole("button", { name: "Restrained", exact: true }).click();
  await dmPage.mouse.click(2, 2); // the click-catcher closes the panel
  await expect(hrow.getByText("Poisoned").first()).toBeVisible();
  await expect(hrow.getByText("Restrained").first()).toBeVisible();
  await dmPage.screenshot({ path: "exp-shots/encounters/06-conditions.png", fullPage: true });

  let after = (await (await dmPage.request.get(`/api/encounters/${encId}`)).json()) as {
    combatants: Array<{ name: string; conditions: string[] }>;
  };
  expect(after.combatants.find((c) => c.name === heroName)!.conditions.sort()).toEqual(
    ["Poisoned", "Restrained"],
  );

  // Clearing one leaves the other.
  await hrow.getByTitle("Conditions").click();
  await hrow.locator("div.absolute").getByRole("button", { name: "Restrained", exact: true }).click();
  await dmPage.mouse.click(2, 2);
  await expect(hrow.getByText("Restrained")).toHaveCount(0);
  after = (await (await dmPage.request.get(`/api/encounters/${encId}`)).json()) as typeof after;
  expect(after.combatants.find((c) => c.name === heroName)!.conditions).toEqual(["Poisoned"]);

  // --- the player's window, before any reveal ------------------------------
  await timed(timings, "player tracker load", async () => {
    await plPage.goto(`/questboard/campaigns/${campaign.id}/encounters`);
    await expect(plPage.getByText(heroName).first()).toBeVisible({ timeout: 20_000 });
  });
  await expect(plPage.getByText("you", { exact: true })).toBeVisible();
  await expect(plPage.getByText("Poisoned").first()).toBeVisible();
  // Monsters joined hidden; none of them may exist for the player yet.
  await expect(plPage.getByText(monsterName)).toHaveCount(0);
  await expect(plPage.getByText(/Goblin Warrior/)).toHaveCount(0);
  await plPage.screenshot({ path: "exp-shots/encounters/07-player-before-reveal.png", fullPage: true });

  const playerView = async () => {
    const res = await plPage.request.get(`/api/campaigns/${campaign.id}/encounters/active`);
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()) as {
      combatants: Array<Record<string, unknown> & { name: string; kind: string }>;
    };
  };
  let seen = await playerView();
  expect(seen.combatants.length, "only the hero is visible before any reveal").toBe(1);
  expect(seen.combatants[0].kind).toBe("pc");
  expect(JSON.stringify(seen)).not.toContain(monsterName);
  expect(JSON.stringify(seen)).not.toContain("Goblin");

  // The DM's library and detail doors are closed to players.
  const listRes = await plPage.request.get(`/api/campaigns/${campaign.id}/encounters`);
  expect(listRes.status(), "the prepared-fights library is DM-only").toBe(403);
  const detRes = await plPage.request.get(`/api/encounters/${encId}`);
  expect(detRes.status(), "the DM detail endpoint refuses players").not.toBe(200);
  const denRes = (await (await plPage.request.get("/api/rules/monster")).json()) as unknown[];
  expect(denRes.length, "the Den answers a player with an empty menagerie").toBe(0);

  // --- reveal the horror, then the mob -------------------------------------
  await mrow.getByTitle("Hidden from players — click to reveal", { exact: true }).click();
  await expect(mrow.getByText("· shown")).toBeVisible();
  await expect
    .poll(async () => (await playerView()).combatants.length, { timeout: 10_000 })
    .toBe(2);
  seen = await playerView();
  const foe = seen.combatants.find((c) => c.kind === "monster")!;
  console.log("OBSERVED revealed monster shows to players as: " + JSON.stringify(foe.name));
  console.log("OBSERVED monster row fields for player: " + JSON.stringify(foe));
  // The Den name is the DM's; the player-facing name is the reveal label.
  expect(foe.name, "the Den name itself is not leaked").not.toBe(monsterName);
  // Numbers belong to nobody but their own PC.
  expect(foe.hpCurrent, "no HP numbers on an enemy").toBeUndefined();
  expect(foe.hpMax).toBeUndefined();
  expect(foe.ac, "no AC on an enemy").toBeUndefined();
  expect(foe.contentId, "no Den content id on an enemy").toBeUndefined();
  expect(foe.hpState).toBe("healthy");

  await dmPage.getByTitle("Hidden from players — click to reveal the group").click();
  await expect
    .poll(async () => (await playerView()).combatants.length, { timeout: 10_000 })
    .toBe(4);

  // --- the live wire: DM damage → player sees the state change -------------
  await mrow.getByTitle("Amount to damage or heal").fill("20");
  const tLive = Date.now();
  await mrow.getByTitle("Damage", { exact: true }).click(); // 21/45 → bloodied
  await expect(plPage.getByText("bloodied").first()).toBeVisible({ timeout: 20_000 });
  const liveMs = Date.now() - tLive;
  timings.push({ action: "DM damage → player sees bloodied (live)", ms: liveMs });
  console.log(`TIMING DM damage → player sees bloodied (live) ${liveMs}ms`);
  await plPage.screenshot({ path: "exp-shots/encounters/08-player-after-reveal.png", fullPage: true });

  // --- one round of turns: entries, not bodies -----------------------------
  // 4 combatants but 3 entries (the mob shares one turn): three presses of
  // Next turn must wrap to Round 2.
  await dmPage.getByRole("button", { name: /Next turn/ }).click();
  await dmPage.getByRole("button", { name: /Next turn/ }).click();
  await timed(timings, "third Next turn (wraps the round)", async () => {
    await dmPage.getByRole("button", { name: /Next turn/ }).click();
    await expect(dmPage.getByText(/Round\s*2/i)).toBeVisible();
  });

  dumpConsole(errors);
  await dmCtx.close();
  await plCtx.close();
});

/* ══════════════ 3. The Bestiary: layered reveals after the fight ═════════ */

test("Bestiary: a sighting identified and unveiled one section at a time — the rest never leaves the server", async ({
  browser,
}) => {
  const timings: Timing[] = [];
  const errors: string[] = [];

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  wireConsole(dmPage, "dm", errors);
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("xqbdm"));
  const campaign = await createCampaign(dmPage.request, unique("Journal Table "));
  const monsterName = unique("Fen Lurker ");
  await scribeMonsterViaAPI(dmPage.request, monsterName);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  wireConsole(plPage, "player", errors);
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("xqbpl"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  // --- the player logs the sighting and pens a note ------------------------
  await timed(timings, "bestiary page load (player)", async () => {
    await plPage.goto(`/questboard/campaigns/${campaign.id}/bestiary`);
    await expect(plPage.getByRole("heading", { name: "The Bestiary" })).toBeVisible();
  });
  await expect(plPage.getByText("The journal is empty", { exact: false })).toBeVisible();

  await plPage.getByRole("button", { name: "Log a sighting" }).click();
  await plPage.getByPlaceholder("The slime in the sewers…").fill("The thing in the reeds");
  await timed(timings, "log a sighting", async () => {
    await plPage.getByRole("button", { name: "Add to journal" }).click();
    await expect(plPage.getByText("The thing in the reeds")).toBeVisible();
  });
  await expect(plPage.getByText("unidentified")).toBeVisible();

  await plPage.getByText("The thing in the reeds").click();
  const plDlg = plPage.getByRole("dialog");
  await expect(plDlg.getByText(/still a mystery/)).toBeVisible();
  await plDlg.getByPlaceholder("Add an observation…").fill("It hissed like wet coals. Hates fire?");
  await plDlg.getByRole("button", { name: "Pen the note" }).click();
  await expect(plDlg.getByText(/It hissed like wet coals/)).toBeVisible();
  await expect(plDlg.getByText("· you")).toBeVisible();
  await plPage.screenshot({ path: "exp-shots/encounters/09-player-sighting.png", fullPage: true });
  await plPage.keyboard.press("Escape");

  // --- the DM identifies it and unveils only the defenses ------------------
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/bestiary`);
  await dmPage.getByText("The thing in the reeds").click();
  const dmDlg = dmPage.getByRole("dialog");
  await expect(dmDlg.getByText(/It hissed like wet coals/)).toBeVisible(); // field notes are shared
  await dmDlg.getByRole("button", { name: "Link a monster" }).click();
  await dmDlg.getByPlaceholder("Search the Den…").fill(monsterName);
  await timed(timings, "identify (link Den monster)", async () => {
    await dmDlg.getByRole("button", { name: new RegExp(monsterName) }).click();
    await expect(dmDlg.getByText(`Identified · ${monsterName}`)).toBeVisible();
  });

  // The DM previews all four sections, each behind a Hidden toggle.
  await expect(dmDlg.getByRole("button", { name: "Hidden" })).toHaveCount(4);
  await expect(dmDlg.getByText("Defenses & Movement")).toBeVisible();
  await expect(dmDlg.getByText(/Mire Camouflage/)).toBeVisible();
  // Unveil the first section (defenses) and nothing else.
  await timed(timings, "reveal one section", async () => {
    await dmDlg.getByTitle("Reveal to players").first().click();
    await expect(dmDlg.getByRole("button", { name: "Revealed" })).toHaveCount(1);
  });
  await dmPage.screenshot({ path: "exp-shots/encounters/10-dm-identified.png", fullPage: true });

  // --- the player's side of the veil ---------------------------------------
  await plPage.goto(`/questboard/campaigns/${campaign.id}/bestiary`);
  await plPage.getByText("The thing in the reeds").click();
  const plDlg2 = plPage.getByRole("dialog");
  await expect(plDlg2.getByText(`Identified · ${monsterName}`)).toBeVisible();
  await expect(plDlg2.getByText("Defenses & Movement")).toBeVisible();
  await expect(plDlg2.getByText(/AC.*17/).first()).toBeVisible();
  // The other three sections are not merely unlabeled — they are absent.
  await expect(plDlg2.getByText("Traits", { exact: true })).toHaveCount(0);
  await expect(plDlg2.getByText("Actions", { exact: true })).toHaveCount(0);
  await expect(plDlg2.getByText(/Mire Camouflage/)).toHaveCount(0);
  await plPage.screenshot({ path: "exp-shots/encounters/11-player-one-section.png", fullPage: true });

  // Payload: the unrevealed sections never crossed the wire.
  const listRes = await plPage.request.get(`/api/campaigns/${campaign.id}/bestiary`);
  expect(listRes.ok(), await listRes.text()).toBeTruthy();
  const raw = await listRes.text();
  const entries = JSON.parse(raw) as Array<{ id: string; record: Record<string, string> }>;
  expect(Object.keys(entries[0].record), "only the unveiled section is in the payload").toEqual(
    ["defenses"],
  );
  expect(raw, "trait text stays behind the screen").not.toContain("Mire Camouflage");
  expect(raw, "action text stays behind the screen").not.toContain("Melee Attack Roll");

  // And the player cannot pull the veil themselves.
  const grab = await plPage.request.patch(
    `/api/campaigns/${campaign.id}/bestiary/${entries[0].id}`,
    { data: { revealed: ["defenses", "traits", "offense", "lore"] } },
  );
  expect(grab.status(), "reveal is a DM power").toBe(403);

  dumpConsole(errors);
  await dmCtx.close();
  await plCtx.close();
});
