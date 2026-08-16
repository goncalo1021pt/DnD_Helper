import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import {
  createCampaign,
  forgeHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  unique,
} from "./helpers";

/*
Exploratory QA: the codex and homebrew packs.

1. A player scribes homebrew, and the only door to proposing it — the seating
   refusal — is walked end to end: player offers, DM admits, player is seated.
2. A DM bans SRD content and we check where the ban actually bites: the forge
   sieve, the forge alert, and (the gap) the long-rest spell swap.
3. Export my homebrew → re-import (upsert) → import a pack that reuses an SRD
   name and read the shadowing warning off the report.
4. The Rulebook's tappable keywords: item properties vs condition names in
   spell prose.
*/

const shot = (n: string) => `exp-shots/codex-homebrew/${n}.png`;

function watch(page: Page, sinkPage: string[], sinkConsole: string[]) {
  page.on("pageerror", (e) => sinkPage.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") sinkConsole.push(m.text());
  });
}

test("homebrew is proposed through the seating refusal and admitted by the DM", async ({
  browser,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  const dm = newAccount("xqcdm");
  const player = newAccount("xqcpl");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watch(dmPage, pageErrors, consoleErrors);
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Codex Table "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watch(plPage, pageErrors, consoleErrors);
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);

  // --- the player scribes an item in My Homebrew (the Archives) -------------
  let t = Date.now();
  await plPage.goto("/questboard/archives");
  await expect(plPage.getByRole("heading", { name: "The Archives" })).toBeVisible();
  console.log("TIMING archives-load " + (Date.now() - t) + "ms");

  const itemName = unique("Wyrmscale Plate ");
  await plPage.getByRole("button", { name: "Items", exact: true }).click();
  await plPage.getByRole("button", { name: /Scribe an? Item/ }).click();
  const form = plPage.getByRole("dialog");
  await form.getByLabel("Name").fill(itemName);
  await form.getByLabel("Item type").selectOption("armor");
  await form.getByLabel("Category").selectOption("Heavy");
  await form.getByLabel("Base AC").fill("17");
  t = Date.now();
  await form.getByRole("button", { name: "Scribe It" }).click();
  await expect(plPage.getByText(itemName).first()).toBeVisible({ timeout: 20_000 });
  console.log("TIMING scribe-item " + (Date.now() - t) + "ms");
  await plPage.screenshot({ path: shot("01-archives-scribed"), fullPage: true });

  // --- the player's codex view: is there any door to offer it? --------------
  t = Date.now();
  await plPage.goto(`/questboard/campaigns/${campaign.id}/codex`);
  await expect(plPage.getByText("The Codex").first()).toBeVisible();
  console.log("TIMING player-codex-load " + (Date.now() - t) + "ms");
  await plPage.getByRole("button", { name: "Items", exact: true }).click();
  await expect(
    plPage.getByText(/None yet — homebrew arrives when a member offers it/),
  ).toBeVisible();
  const proposeButtons = await plPage
    .getByRole("button", { name: /propose|offer|send/i })
    .count();
  console.log(
    `AUDIT player codex propose affordances: ${proposeButtons} (0 = no direct way to offer homebrew)`,
  );
  await plPage.screenshot({ path: shot("02-player-codex-no-door"), fullPage: true });

  // --- hero carrying the homebrew item, summoned at the table ---------------
  const heroName = unique("Provand ");
  const heroId = await forgeHero(plPage.request, {
    name: heroName,
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    skills: ["Perception", "Survival"],
  });
  const items = (await (await plPage.request.get("/api/rules/item")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const mine = items.find((i) => i.name === itemName);
  expect(mine, "the scribed item should be in the armory").toBeTruthy();
  const added = await plPage.request.post(`/api/characters/${heroId}/items`, {
    data: { contentId: mine!.id, qty: 1 },
  });
  expect(added.ok(), await added.text()).toBeTruthy();

  await plPage.goto(`/questboard/campaigns/${campaign.id}/party`);
  await plPage.getByRole("combobox").last().selectOption({ label: heroName });
  t = Date.now();
  await plPage.getByRole("button", { name: "Summon", exact: true }).click();
  await expect(plPage.getByText(/The Codex Objects/i)).toBeVisible({ timeout: 15_000 });
  console.log("TIMING summon-to-conflict-modal " + (Date.now() - t) + "ms");
  await expect(plPage.getByText(itemName).first()).toBeVisible();
  await expect(plPage.getByText("not offered yet")).toBeVisible();
  await plPage.screenshot({ path: shot("03-codex-objects"), fullPage: true });

  // --- send it to the DM ----------------------------------------------------
  t = Date.now();
  await plPage.getByRole("button", { name: "Send to the DM" }).click();
  await expect(plPage.getByText(/Sent — once the DM admits it/)).toBeVisible({
    timeout: 15_000,
  });
  console.log("TIMING propose-send " + (Date.now() - t) + "ms");
  const closeButtons = await plPage.getByRole("button", { name: "Close" }).count();
  console.log(
    `AUDIT after Send, visible "Close" buttons in the modal: ${closeButtons} (0 = only the corner X remains)`,
  );
  await plPage.screenshot({ path: shot("04-sent"), fullPage: true });
  await plPage.getByTitle("Close").click();

  // the player's codex now shows whose move it is
  await plPage.goto(`/questboard/campaigns/${campaign.id}/codex`);
  await plPage.getByRole("button", { name: "Items", exact: true }).click();
  await expect(plPage.getByText("awaiting the DM")).toBeVisible();
  await plPage.screenshot({ path: shot("05-player-waiting"), fullPage: true });

  // --- the DM's side --------------------------------------------------------
  t = Date.now();
  await dmPage.goto(`/questboard/campaigns/${campaign.id}`);
  await expect(dmPage.getByText(/waiting at the door/)).toBeVisible({ timeout: 15_000 });
  console.log("TIMING dm-dashboard-load " + (Date.now() - t) + "ms");
  await dmPage.screenshot({ path: shot("06-dm-dashboard"), fullPage: true });

  await dmPage.goto(`/questboard/campaigns/${campaign.id}/codex`);
  await expect(dmPage.getByText("SRD 5.2 — legal unless banned")).toBeVisible();
  // Default shelf is Classes; the waiting item is invisible here. Is there any
  // hint on this tab that something waits on another shelf?
  const waitingOnClassTab = await dmPage.getByText("Waiting at the door").count();
  console.log(
    `AUDIT DM codex, Classes tab: "Waiting at the door" sections visible: ${waitingOnClassTab} (proposal is an item)`,
  );
  await dmPage.screenshot({ path: shot("07-dm-codex-classes-tab"), fullPage: true });

  await dmPage.getByRole("button", { name: "Items", exact: true }).click();
  await expect(dmPage.getByText("Waiting at the door")).toBeVisible();
  await expect(dmPage.getByText(itemName)).toBeVisible();
  await expect(dmPage.getByText(`offered by ${player.username}`)).toBeVisible();
  await dmPage.screenshot({ path: shot("08-dm-proposal"), fullPage: true });

  t = Date.now();
  await dmPage.getByRole("button", { name: "Admit", exact: true }).click();
  await expect(dmPage.getByText("in the world")).toBeVisible({ timeout: 15_000 });
  console.log("TIMING admit-proposal " + (Date.now() - t) + "ms");
  await expect(dmPage.getByText("Waiting at the door")).toHaveCount(0);
  await dmPage.screenshot({ path: shot("09-admitted"), fullPage: true });

  // --- the player seats the hero for real -----------------------------------
  await plPage.goto(`/questboard/campaigns/${campaign.id}/party`);
  await plPage.getByRole("combobox").last().selectOption({ label: heroName });
  const seated = plPage.waitForResponse(
    (r) => r.url().includes(`/characters/${heroId}/seat`) && r.request().method() === "PUT",
    { timeout: 15_000 },
  );
  t = Date.now();
  await plPage.getByRole("button", { name: "Summon", exact: true }).click();
  const seatRes = await seated;
  console.log("TIMING re-summon-after-admit " + (Date.now() - t) + "ms");
  console.log(`AUDIT re-summon status: ${seatRes.status()}`);
  expect(seatRes.status(), "seat should succeed once the item is admitted").toBe(200);
  await expect(plPage.getByText(heroName).first()).toBeVisible({ timeout: 15_000 });
  await plPage.screenshot({ path: shot("10-seated"), fullPage: true });

  console.log("AUDIT pageErrors: " + JSON.stringify(pageErrors));
  console.log("AUDIT consoleErrors: " + JSON.stringify(consoleErrors));
  expect(pageErrors).toEqual([]);

  await dmCtx.close();
  await plCtx.close();
});

test("a DM ban bites at the forge, but not at the long-rest spell swap", async ({
  browser,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  const dm = newAccount("xqbdm");
  const player = newAccount("xqbpl");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watch(dmPage, pageErrors, consoleErrors);
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Ban Hammer "));

  // --- the DM bans Fighter through the Codex UI -----------------------------
  let t = Date.now();
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/codex`);
  await expect(dmPage.getByText("SRD 5.2 — legal unless banned")).toBeVisible({
    timeout: 15_000,
  });
  console.log("TIMING dm-codex-load " + (Date.now() - t) + "ms");
  await dmPage.getByPlaceholder("Search this shelf…").fill("Fighter");
  await expect(dmPage.getByText("legal", { exact: true })).toBeVisible();
  t = Date.now();
  await dmPage.getByRole("button", { name: "Ban", exact: true }).click();
  await expect(dmPage.getByText("banned", { exact: true })).toBeVisible({ timeout: 15_000 });
  console.log("TIMING ban-srd-class " + (Date.now() - t) + "ms");
  await expect(dmPage.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await dmPage.screenshot({ path: shot("20-banned-fighter"), fullPage: true });

  // ban an SRD spell too (setup for the swap probe) — API, not the thing under test
  const spells = (await (await dmPage.request.get("/api/rules/spell")).json()) as Array<{
    id: string;
    name: string;
    source: string;
  }>;
  const burningHands = spells.find((s) => s.name === "Burning Hands" && s.source === "srd");
  const magicMissile = spells.find((s) => s.name === "Magic Missile" && s.source === "srd");
  expect(burningHands, "Burning Hands should be SRD").toBeTruthy();
  expect(magicMissile, "Magic Missile should be SRD").toBeTruthy();
  const banned = await dmPage.request.put(
    `/api/campaigns/${campaign.id}/codex/${burningHands!.id}`,
    { data: { status: "banned" } },
  );
  expect(banned.ok(), await banned.text()).toBeTruthy();

  // --- the player meets the ban at the forge --------------------------------
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watch(plPage, pageErrors, consoleErrors);
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);

  t = Date.now();
  await plPage.goto("/questboard/heroes/forge");
  await expect(plPage.getByRole("heading", { name: "The Forge" })).toBeVisible();
  console.log("TIMING forge-load " + (Date.now() - t) + "ms");

  const tableSieve = plPage.getByTitle("Show only what a table's codex admits");
  await tableSieve.selectOption({ label: `Legal at ${campaign.name}` });
  await expect(plPage.getByRole("button", { name: /^Wizard/ })).toBeVisible();
  await expect(plPage.getByRole("button", { name: /^Fighter/ })).toHaveCount(0);
  await plPage.screenshot({ path: shot("21-forge-sieve"), fullPage: true });

  // pick Fighter with the sieve off, then aim the hero at the table: the
  // wizard should say, in words, why the pick is dead there.
  await tableSieve.selectOption("");
  await plPage.getByRole("button", { name: /^Fighter/ }).click();
  await tableSieve.selectOption({ label: `Legal at ${campaign.name}` });
  await expect(plPage.getByText(/banned at that table/)).toBeVisible();
  await plPage.screenshot({ path: shot("22-forge-alert"), fullPage: true });

  // --- the swap probe: a seated Wizard trades INTO the banned spell ---------
  const heroId = await forgeHeroWithSpells(plPage, {
    name: unique("Loophole "),
    spellIds: [magicMissile!.id],
  });
  const seat = await plPage.request.put(`/api/characters/${heroId}/seat`, {
    data: { campaignId: campaign.id },
  });
  expect(seat.ok(), await seat.text()).toBeTruthy();

  const swap = await plPage.request.post(`/api/characters/${heroId}/spells/swap`, {
    data: { swaps: [{ replace: magicMissile!.id, with: burningHands!.id }] },
  });
  const swapBody = await swap.text();
  console.log(`AUDIT swap-in of banned spell: HTTP ${swap.status()} — ${swapBody.slice(0, 200)}`);
  // Strict seating's contract: banned content is refused wherever it is picked.
  expect
    .soft(swap.status(), "swapping IN a codex-banned spell should be refused like any other pick")
    .toBe(400);

  const detail = (await (await plPage.request.get(`/api/characters/${heroId}`)).json()) as {
    spells?: Array<{ name: string }>;
  };
  const names = (detail.spells ?? []).map((s) => s.name);
  console.log(`AUDIT hero spell list after swap attempt: ${JSON.stringify(names)}`);
  expect
    .soft(names, "the banned spell should not be on a seated hero's list")
    .not.toContain("Burning Hands");

  console.log("AUDIT pageErrors: " + JSON.stringify(pageErrors));
  console.log("AUDIT consoleErrors: " + JSON.stringify(consoleErrors));
  expect(pageErrors).toEqual([]);

  await dmCtx.close();
  await plCtx.close();
});

/** Forge a Wizard with chosen level-1 spells (the helpers' forgeHero takes no spells). */
async function forgeHeroWithSpells(
  page: Page,
  hero: { name: string; spellIds: string[] },
): Promise<string> {
  const byName = async (kind: string, want: string) => {
    const list = (await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    const hit = list.find((e) => e.name === want);
    expect(hit, `${want} should be in the ${kind} library`).toBeTruthy();
    return hit!.id;
  };
  const res = await page.request.post("/api/me/characters/forge", {
    data: {
      name: hero.name,
      classId: await byName("class", "Wizard"),
      speciesId: await byName("species", "Dwarf"),
      backgroundId: await byName("background", "Acolyte"),
      abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
      skills: ["Arcana", "History"],
      spells: hero.spellIds,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

test("export, re-import, and the SRD-shadowing warning in the report", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  watch(page, pageErrors, consoleErrors);

  await page.goto("/");
  await registerViaAPI(page.request, newAccount("xqpack"));

  // two homebrew entries to export
  const armorName = unique("Aegis Coat ");
  const gearName = unique("Everburning Lantern ");
  for (const [kind, body] of [
    ["item", { name: armorName, summary: "Test armor", data: { type: "armor", category: "Heavy", ac: 17 } }],
    ["item", { name: gearName, summary: "Test gear", data: { type: "gear", description: "It never goes out." } }],
  ] as const) {
    const res = await page.request.post(`/api/rules/${kind}`, { data: body });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  await page.goto("/questboard/archives");
  await expect(page.getByRole("heading", { name: "The Archives" })).toBeVisible();

  // --- export through the real button ---------------------------------------
  let t = Date.now();
  const downloadWait = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "Export my homebrew" }).click();
  const download = await downloadWait;
  console.log("TIMING export-download " + (Date.now() - t) + "ms");
  expect(download.suggestedFilename()).toBe("questboard-homebrew-pack.json");
  const packPath = await download.path();
  const packRaw = fs.readFileSync(packPath!, "utf-8");
  const pack = JSON.parse(packRaw) as { entries: Array<{ kind: string; name: string }> };
  const exportedNames = pack.entries.map((e) => e.name);
  expect(exportedNames).toContain(armorName);
  expect(exportedNames).toContain(gearName);

  // --- re-import the same file: upsert, no shadow warnings ------------------
  t = Date.now();
  await page.locator('input[type="file"]').setInputFiles({
    name: "questboard-homebrew-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from(packRaw),
  });
  await expect(page.getByText("Pack Unpacked")).toBeVisible({ timeout: 20_000 });
  console.log("TIMING reimport-report " + (Date.now() - t) + "ms");
  await expect(page.getByText(/0 scribed anew · 2 updated/)).toBeVisible();
  await expect(page.getByText(/shadows the SRD entry/)).toHaveCount(0);
  await page.screenshot({ path: shot("30-reimport-report"), fullPage: true });
  await page.getByRole("button", { name: "Done" }).click();

  // --- a pack that reuses an SRD name must warn, not stay silent ------------
  const spells = (await (await page.request.get("/api/rules/spell")).json()) as Array<{
    id: string;
    name: string;
    source: string;
    summary?: string;
    data: Record<string, unknown>;
  }>;
  const srdSpell = spells.find((s) => s.name === "Invisibility" && s.source === "srd")
    ?? spells.find((s) => s.source === "srd");
  expect(srdSpell, "an SRD spell to shadow").toBeTruthy();
  const { book: _b, ...srdData } = srdSpell!.data as { book?: string };
  const shadowPack = JSON.stringify({
    book: "Shadow Test Tome",
    entries: [
      {
        kind: "spell",
        name: srdSpell!.name,
        summary: "A homebrew copy reusing the SRD name.",
        data: srdData,
      },
    ],
  });
  t = Date.now();
  await page.locator('input[type="file"]').setInputFiles({
    name: "Shadow Test Tome.json",
    mimeType: "application/json",
    buffer: Buffer.from(shadowPack),
  });
  await expect(page.getByText("Pack Unpacked")).toBeVisible({ timeout: 20_000 });
  console.log("TIMING shadow-import-report " + (Date.now() - t) + "ms");
  await expect(page.getByText(/1 scribed anew/)).toBeVisible();
  await expect(page.getByText(/shadows the SRD entry of the same name/)).toBeVisible();
  await page.screenshot({ path: shot("31-shadow-warning"), fullPage: true });
  await page.getByRole("button", { name: "Done" }).click();

  // both now sit on the shelf — the warning promised as much
  await page.getByRole("button", { name: "Spells", exact: true }).click();
  await page.getByPlaceholder(/Search spells/).fill(srdSpell!.name);
  await expect(page.getByText(srdSpell!.name).first()).toBeVisible();
  const copies = await page
    .getByRole("button", { name: new RegExp(`^${srdSpell!.name}`) })
    .count();
  console.log(`AUDIT shelf copies of "${srdSpell!.name}" after shadow import: ${copies}`);
  expect(copies).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: shot("32-shadow-shelf"), fullPage: true });

  // --- a broken file is refused in words ------------------------------------
  await page.locator('input[type="file"]').setInputFiles({
    name: "not-a-pack.json",
    mimeType: "application/json",
    buffer: Buffer.from("this is not json {"),
  });
  await expect(page.getByText("That file is not valid JSON.")).toBeVisible();

  console.log("AUDIT pageErrors: " + JSON.stringify(pageErrors));
  console.log("AUDIT consoleErrors: " + JSON.stringify(consoleErrors));
  expect(pageErrors).toEqual([]);
});

test("rulebook keywords: item properties are tappable, condition names in spell prose", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  watch(page, pageErrors, consoleErrors);

  await page.goto("/");
  await registerViaAPI(page.request, newAccount("xqrule"));

  // --- an item card: the property keyword opens the rule --------------------
  let t = Date.now();
  await page.goto("/questboard/archives");
  await expect(page.getByRole("heading", { name: "The Archives" })).toBeVisible();
  console.log("TIMING archives-load-2 " + (Date.now() - t) + "ms");
  await page.getByRole("button", { name: "Items", exact: true }).click();
  await page.getByPlaceholder(/Search items/).fill("Longsword");
  await page.getByRole("button", { name: /^Longsword/ }).first().click();
  const itemCard = page.getByRole("dialog");
  await expect(itemCard.getByRole("button", { name: "Rule: Versatile" })).toBeVisible();
  await itemCard.getByRole("button", { name: "Rule: Versatile" }).click();
  const rule = page.getByRole("dialog").last();
  await expect(rule.getByText("Weapon property")).toBeVisible();
  await page.screenshot({ path: shot("41-item-props-linked"), fullPage: true });
  // close both stacked modals
  await page.keyboard.press("Escape");
  await page.getByTitle("Close").last().click();
  await page.getByTitle("Close").last().click();

  // --- a spell's prose: does "Paralyzed" in Hold Person open the rule? ------
  await page.getByRole("button", { name: "Spells", exact: true }).click();
  await page.getByPlaceholder(/Search spells/).fill("Hold Person");
  await page.getByRole("button", { name: /^Hold Person/ }).first().click();
  const spellCard = page.getByRole("dialog");
  await expect(spellCard.getByText(/Paralyzed/).first()).toBeVisible();
  const ruleButtons = await spellCard.getByRole("button", { name: /^Rule: / }).count();
  console.log(
    `AUDIT "Rule:" affordances inside the Hold Person card: ${ruleButtons} (its text names the Paralyzed condition)`,
  );
  await page.screenshot({ path: shot("40-spell-prose"), fullPage: true });
  expect
    .soft(
      ruleButtons,
      "a condition named in spell text should be tappable like a weapon property is",
    )
    .toBeGreaterThan(0);

  console.log("AUDIT pageErrors: " + JSON.stringify(pageErrors));
  console.log("AUDIT consoleErrors: " + JSON.stringify(consoleErrors));
  expect(pageErrors).toEqual([]);
});
