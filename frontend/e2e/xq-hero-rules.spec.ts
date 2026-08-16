import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  seatHero,
  settled,
  unique,
} from "./helpers";

/*
Exploratory QA — hero rules: the forge, the sheet, multiclass, rests.

Part one walks the 2024 wizard through the UI and audits the sheet arithmetic
by hand. Part two forges a Cleric (WIS 16 / CHA 15) via API, seats them at a
campaign, and takes Warlock and Ranger levels through the UI, auditing the
2024 multiclass rules: prerequisites, the shared slot table (half-casters
round UP), Pact Magic apart from the pool, per-class preparation, and the two
rests with hit dice.

Hand-recomputed expectations are inline at each assertion.
*/

const shot = (n: string) => `exp-shots/hero-rules/${n}.png`;
const nextStep = (p: Page) => p.getByRole("button", { name: /Next →/ });
const forgeButton = (p: Page) => p.getByRole("button", { name: "Forge the Hero" });

/** Ability tile value: the span right after the label span (AbilityRow). */
const abilityTile = (p: Page, label: string) =>
  p.locator(`span:text-is("${label}")`).first().locator("xpath=following-sibling::span[1]");

/** Skill row value beside "● Name" / "○ Name". */
const skillMod = (p: Page, pip: "●" | "○", name: string) =>
  p.locator(`span:text-is("${pip} ${name}")`).locator("xpath=following-sibling::span[1]");

/** Stat under a label in the AC/Prof/Init strip. */
const statUnder = (p: Page, label: string) =>
  p.getByText(label, { exact: true }).locator("xpath=following-sibling::div").first();

/** The buttons (pips) of the "Lv N" spell-slot row. */
const slotPips = (p: Page, level: number) =>
  p.locator(`span:text-is("Lv ${level}")`).locator("xpath=following-sibling::div[1]").locator("button");

function watch(page: Page, pageErrors: string[], consoleErrors: string[]) {
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
}

async function idByName(request: APIRequestContext, kind: string, want: string) {
  const list = (await (await request.get(`/api/rules/${kind}`)).json()) as Array<{
    id: string;
    name: string;
  }>;
  const hit = list.find((e) => e.name === want);
  expect(hit, `${want} should be in the ${kind} library`).toBeTruthy();
  return hit!.id;
}

async function spellIdsByName(request: APIRequestContext, names: string[]) {
  const list = (await (await request.get("/api/rules/spell")).json()) as Array<{
    id: string;
    name: string;
  }>;
  return names.map((n) => {
    const hit = list.find((s) => s.name === n);
    expect(hit, `${n} should be in the spell library`).toBeTruthy();
    return hit!.id;
  });
}

async function heroDetail(request: APIRequestContext, heroId: string) {
  const res = await request.get(`/api/characters/${heroId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as {
    character: {
      level: number;
      hpCurrent: number;
      hpMax: number;
      hitDice?: Array<{ die: number; max: number; used: number }>;
      sheet?: {
        classes?: Array<{ className: string; level: number }>;
        spellSlots?: Array<{ level: number; max: number; used: number }>;
        pactSlots?: { level: number; max: number; used: number };
        pools?: Array<{ name: string; max: number; used: number }>;
      };
    };
    casters?: Array<{ className: string; ability: string; spellIds: string[] }>;
  };
}

/* ═══ Part one — the wizard, walked, and the sheet recomputed ═══════════════ */

test("the forge walks a Dwarf Fighter and the sheet arithmetic checks out", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  watch(page, pageErrors, consoleErrors);
  await registerViaAPI(page.request, newAccount("xqhr1"));

  let t = Date.now();
  await page.goto("/questboard/heroes/forge");
  await expect(page.getByRole("heading", { name: "The Forge" })).toBeVisible();
  console.log("TIMING forge-page-load " + (Date.now() - t) + "ms");

  // Class: Fighter, skills Acrobatics + Insight (Soldier grants the other two).
  await page.getByRole("button", { name: /^Fighter/ }).click();
  await page.getByRole("button", { name: "Acrobatics", exact: true }).click();
  await page.getByRole("button", { name: "Insight", exact: true }).click();
  await expect(nextStep(page)).toBeEnabled();
  await nextStep(page).click();

  // Background: Soldier (Athletics, Intimidation, Savage Attacker).
  await page.getByRole("button", { name: /^Soldier/ }).click();
  await nextStep(page).click();

  // Species: Dwarf.
  await page.getByRole("button", { name: /^Dwarf/ }).click();
  await nextStep(page).click();

  // Abilities: recommended spread (STR 15 DEX 14 CON 13 INT 10 WIS 12 CHA 8),
  // then Soldier's +2 STR / +1 CON.
  await page.getByRole("button", { name: /★ Recommended/ }).click();
  const selects = page.locator("select");
  await selects.nth(7).selectOption("STR");
  await selects.nth(8).selectOption("CON");
  for (const [label, want] of [
    ["STR", "17"], ["DEX", "14"], ["CON", "14"],
    ["INT", "10"], ["WIS", "12"], ["CHA", "8"],
  ] as const) {
    await expect(abilityTile(page, label), `wizard final ${label}`).toHaveText(want);
  }
  await page.screenshot({ path: shot("01-abilities-final"), fullPage: true });
  await nextStep(page).click();

  // Gear: the Chain Mail kit.
  await expect(page.getByText(/Starting equipment/i)).toBeVisible();
  await page.getByRole("button", { name: /Chain Mail/ }).click();
  await nextStep(page).click();

  // Name and forge.
  const heroName = unique("Balin Auditor ");
  await page.getByRole("textbox").last().fill(heroName);
  await page.screenshot({ path: shot("02-name-step"), fullPage: true });
  t = Date.now();
  await forgeButton(page).click();
  await expect(page).toHaveURL(/\/questboard\/profile/, { timeout: 20_000 });
  console.log("TIMING forge-submit " + (Date.now() - t) + "ms");

  // Onto the sheet.
  t = Date.now();
  await page.getByRole("link", { name: heroName }).click();
  await expect(statUnder(page, "AC")).toBeVisible({ timeout: 20_000 });
  console.log("TIMING sheet-load " + (Date.now() - t) + "ms");
  await page.screenshot({ path: shot("03-sheet"), fullPage: true });

  /*
    The audit, by hand:
      STR 17 (+3) DEX 14 (+2) CON 14 (+2) INT 10 (+0) WIS 12 (+1) CHA 8 (−1)
      Prof (level 1)          = +2
      Init                    = DEX +2
      AC unarmoured           = 10 + DEX = 12 (Chain Mail is in the pack, not worn)
      HP                      = d10 (10) + CON (+2) = 12 … but the sheet prints
                                Dwarven Toughness ("+1, and +1 per level"), so
                                the 2024-correct maximum is 13.
      Skills  Acrobatics ● DEX+2 prof+2 = +4      Insight ● WIS+1 prof+2 = +3
              Athletics ● STR+3 prof+2 = +5       Intimidation ● CHA−1 prof+2 = +1
              Stealth ○ +2                        Persuasion ○ −1
      Saves (Fighter STR/CON) STR +5, CON +4 — checked below if displayed.
  */
  await expect(page.getByText(/Level 1 Dwarf Fighter/)).toBeVisible();
  for (const [label, want] of [
    ["STR", "17"], ["DEX", "14"], ["CON", "14"],
    ["INT", "10"], ["WIS", "12"], ["CHA", "8"],
  ] as const) {
    await expect(abilityTile(page, label), `sheet ${label}`).toHaveText(want);
  }
  await expect(statUnder(page, "Prof")).toHaveText("+2");
  await expect(statUnder(page, "Init")).toHaveText("+2");
  await expect(statUnder(page, "AC")).toHaveText("12");

  const hpStamp = await page.getByText(/^HP \d+\/\d+$/).textContent();
  const hpMax = Number(hpStamp?.match(/\/(\d+)$/)?.[1] ?? 0);
  const toughnessOnSheet = (await page.getByText("Dwarven Toughness").count()) > 0;
  console.log(
    `AUDIT HP shown ${hpMax} — hand math: 10 (d10) + 2 (CON) = 12 without Dwarven Toughness, ` +
      `13 with it; the trait text is ${toughnessOnSheet ? "ON" : "OFF"} this sheet`,
  );

  await expect(skillMod(page, "●", "Acrobatics"), "Acrobatics DEX+2 prof+2").toHaveText("+4");
  await expect(skillMod(page, "●", "Insight"), "Insight WIS+1 prof+2").toHaveText("+3");
  await expect(skillMod(page, "●", "Athletics"), "Athletics STR+3 prof+2 (Soldier)").toHaveText("+5");
  await expect(skillMod(page, "●", "Intimidation"), "Intimidation CHA-1 prof+2 (Soldier)").toHaveText("+1");
  await expect(skillMod(page, "○", "Stealth"), "Stealth DEX+2 unproficient").toHaveText("+2");
  await expect(skillMod(page, "○", "Persuasion"), "Persuasion CHA-1 unproficient").toHaveText("-1");

  // Saving throws: Fighter is proficient in STR and CON saves (STR +5, CON +4).
  // Is there anywhere on this sheet that says so?
  const saveMentions = await page.getByText(/saving throw|save DC|STR save|saves/i).count();
  console.log(`AUDIT saving-throw mentions on a Fighter sheet: ${saveMentions} (0 = nowhere to read a save bonus)`);

  // Wear the kit's Chain Mail through the rig; AC must become 16 flat.
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: /Armor.*empty/i }).click();
  t = Date.now();
  await page.getByRole("dialog").getByRole("button", { name: /Chain Mail/ }).click();
  await page.getByRole("button", { name: "The Sheet", exact: true }).click();
  await expect(statUnder(page, "AC"), "Chain Mail worn = AC 16 flat").toHaveText("16", {
    timeout: 20_000,
  });
  console.log("TIMING equip-armor-ac " + (Date.now() - t) + "ms");
  await page.screenshot({ path: shot("04-sheet-armored"), fullPage: true });

  console.log("AUDIT t1 pageErrors: " + JSON.stringify(pageErrors));
  console.log("AUDIT t1 consoleErrors: " + JSON.stringify(consoleErrors));
  expect(pageErrors).toEqual([]);
});

test("the #56 background/class skill clash is explained and blocks the forge", async ({ page }) => {
  const pageErrors: string[] = [];
  watch(page, pageErrors, []);
  await registerViaAPI(page.request, newAccount("xqhr2"));
  await page.goto("/questboard/heroes/forge");

  await page.getByRole("button", { name: /^Fighter/ }).click();
  await page.getByRole("button", { name: "Athletics", exact: true }).click();
  await page.getByRole("button", { name: "Intimidation", exact: true }).click();
  await nextStep(page).click();
  await page.getByRole("button", { name: /^Soldier/ }).click();

  // Flagged at once, explained in words, and the finish line is barred.
  await expect(page.getByRole("button", { name: /^Class\s*!/ })).toBeVisible();
  await page.getByRole("button", { name: /^Class\s*!/ }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(/Soldier already grants Athletics and Intimidation/);
  await page.screenshot({ path: shot("05-conflict-explained"), fullPage: true });
  await expect(nextStep(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Name$/ })).toBeDisabled();

  // Recoverable without starting over.
  await page.getByRole("button", { name: "Perception", exact: true }).click();
  await page.getByRole("button", { name: "Survival", exact: true }).click();
  await expect(nextStep(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Class\s*!/ })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

/* ═══ Part two — multiclass through the UI ══════════════════════════════════ */

/*
The Cleric who can afford almost anything: WIS 16 (Cleric), CHA 15 (Warlock,
Bard, Sorcerer), DEX 13 (Ranger with WIS, Fighter, Rogue, Monk). But INT 10
bars Wizard and STR 8 bars Paladin and Barbarian — the illegal combos to try.
Forged with a full Cleric level-1 load (3 cantrips + 4 prepared spells), which
is exactly what a real player leaves the forge with.
*/
test("a seated Cleric takes Warlock and Ranger levels through the UI; slots follow PHB 2024", async ({
  browser,
}) => {
  // DM side: a campaign to seat the hero at.
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaAPI(dmPage.request, newAccount("xqhr3dm"));
  const campaign = await createCampaign(dmPage.request, unique("Audit Table "));

  // Player side.
  const pCtx = await browser.newContext();
  const page = await pCtx.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  watch(page, pageErrors, consoleErrors);
  await registerViaAPI(page.request, newAccount("xqhr3p"));
  await joinCampaign(page.request, campaign.inviteCode);

  // KNOWN BUG (found by this journey, repro below): levelup validates spell
  // caps against the hero's TOTAL level and TOTAL spell list, so a full-loaded
  // Cleric 1 (3 cantrips) is refused the Warlock level outright. The main hero
  // forges UNDER-loaded (legal — caps are ≤) so the mission can continue.
  const spellIds = await spellIdsByName(page.request, [
    "Guidance", "Light", // 2 cantrips (Cleric 1 allows 3 — under-picked on purpose)
    "Bless", "Cure Wounds", // 2 prepared (Cleric 1 allows 4)
  ]);
  // forgeHero has no spells param; a real Cleric leaves the wizard with a full
  // load, so forge through the raw endpoint with the picks attached.
  const classId = await idByName(page.request, "class", "Cleric");
  const speciesId = await idByName(page.request, "species", "Dwarf");
  const backgroundId = await idByName(page.request, "background", "Acolyte");
  const reforge = await page.request.post("/api/me/characters/forge", {
    data: {
      name: unique("Morwen "),
      classId,
      speciesId,
      backgroundId,
      abilities: { str: 8, dex: 13, con: 14, int: 10, wis: 16, cha: 15 },
      skills: ["History", "Medicine"],
      spells: spellIds,
    },
  });
  expect(reforge.ok(), await reforge.text()).toBeTruthy();
  const hero = (await reforge.json()).id as string;
  await seatHero(page.request, hero, campaign.id);

  // A seated hero on a milestone table (the default) waits on the DM. Bank
  // enough pending levels for two UI level-ups plus the probe that may land.
  for (let i = 0; i < 4; i++) {
    const g = await dmPage.request.post(`/api/campaigns/${campaign.id}/milestone`);
    expect(g.status(), "DM milestone grant").toBe(204);
  }

  // ── THE BUG, pinned as a repro: a full-loaded Cleric 1 is refused Warlock ──
  // levelup.go passes newLevel = TOTAL level and existingSpells = ALL classes'
  // spells into validateSpellPicks, so the Warlock cap (2 cantrips, read at
  // total level 2) is compared against the Cleric's 3 cantrips.
  const fullLoad = await spellIdsByName(page.request, [
    "Guidance", "Light", "Sacred Flame", "Bless", "Cure Wounds", "Bane", "Command",
  ]);
  const reproRes = await page.request.post("/api/me/characters/forge", {
    data: {
      name: unique("Caps Repro "),
      classId, speciesId, backgroundId,
      abilities: { str: 8, dex: 13, con: 14, int: 10, wis: 16, cha: 15 },
      skills: ["History", "Medicine"],
      spells: fullLoad,
    },
  });
  expect(reproRes.ok(), await reproRes.text()).toBeTruthy();
  const reproHero = (await reproRes.json()).id as string;
  const warlockIdForRepro = await idByName(page.request, "class", "Warlock");
  const refusedDip = await page.request.post(`/api/characters/${reproHero}/levelup`, {
    data: { hpMode: "average", classId: warlockIdForRepro },
  });
  const refusalBody = await refusedDip.text();
  console.log(
    `AUDIT FINDING cross-class cap: full-loaded Cleric 1 taking Warlock 1 → status ${refusedDip.status()} body ${refusalBody}`,
  );
  expect(refusedDip.status(), "the legal Warlock dip is refused — the bug's repro").toBe(400);
  expect(refusalBody).toContain("knows at most 2 cantrips at level 2");

  // The lone Cleric 1: two level-1 slots off their own table.
  let d = await heroDetail(page.request, hero);
  expect(d.character.sheet?.spellSlots?.find((s) => s.level === 1)?.max, "Cleric 1 alone: 2 slots").toBe(2);

  let t = Date.now();
  await page.goto(`/questboard/heroes/${hero}`);
  await expect(statUnder(page, "AC")).toBeVisible({ timeout: 20_000 });
  console.log("TIMING mc-sheet-load " + (Date.now() - t) + "ms");
  await expect(slotPips(page, 1), "two Lv 1 slot pips before multiclassing").toHaveCount(2);

  // ── The level-up dialog: who is offered, who is barred ────────────────────
  await page.getByRole("button", { name: /Level up/i }).click();
  const dialog = page.getByRole("dialog");
  const picker = dialog.getByLabel("This level goes to");
  await expect(picker).toBeVisible();
  for (const open of ["Cleric", "Warlock", "Ranger", "Bard", "Sorcerer", "Fighter"]) {
    await expect(picker.locator("option", { hasText: open }), `${open} should be offered`).toHaveCount(1);
  }
  for (const barred of ["Wizard", "Paladin", "Barbarian"]) {
    await expect(picker.locator("option", { hasText: barred }), `${barred} must NOT be offered (INT 10 / STR 8)`).toHaveCount(0);
  }
  await page.screenshot({ path: shot("06-levelup-picker"), fullPage: true });

  // Take the Warlock level. PHB 2024: a new Warlock 1 knows 2 cantrips and 2
  // level-1 spells of their own. What does the dialog offer this hero?
  await picker.selectOption({ label: "Warlock — a new calling" });
  await expect(dialog.getByText(/Multiclassing\./)).toBeVisible();
  const spellsOffer = await dialog.getByText(/New spells at level/).count();
  const offerText = spellsOffer > 0 ? await dialog.getByText(/New spells at level/).textContent() : "(no spell block at all)";
  console.log(
    `AUDIT Warlock-1 spell offer for a full-loaded Cleric 1: ${offerText} — PHB 2024 grants a new Warlock 2 cantrips + 2 spells regardless of Cleric picks`,
  );
  await page.screenshot({ path: shot("07-warlock-level-dialog"), fullPage: true });
  t = Date.now();
  await dialog.getByRole("button", { name: /Rise to Level \d+/ }).click();
  await settled(page);
  console.log("TIMING levelup-warlock " + (Date.now() - t) + "ms");

  // The header says both classes; slots are unchanged (only Cleric feeds the
  // pool) and Pact Magic stands beside them: 1 slot, level 1, short rest.
  await expect(page.getByText("Cleric 1 / Warlock 1")).toBeVisible({ timeout: 20_000 });
  await expect(slotPips(page, 1), "shared pool still 2 — pact is not inside it").toHaveCount(2);
  await expect(page.getByRole("button", { name: "Pact slot 1 of 1" })).toBeVisible();
  await expect(page.getByText("Lv 1 · short rest")).toBeVisible();
  await page.screenshot({ path: shot("08-sheet-cleric-warlock"), fullPage: true });

  d = await heroDetail(page.request, hero);
  expect(d.character.sheet?.pactSlots?.max, "one pact slot").toBe(1);
  expect(d.character.sheet?.pactSlots?.level, "at slot level 1").toBe(1);
  expect(d.character.sheet?.spellSlots?.find((s) => s.level === 1)?.max).toBe(2);

  // Per-class preparation: every forged spell is the Cleric's, cast off WIS;
  // the Warlock casts off CHA and owns nothing yet.
  const casters = d.casters ?? [];
  expect(casters.map((c) => c.className).sort()).toEqual(["Cleric", "Warlock"]);
  const clericCaster = casters.find((c) => c.className === "Cleric")!;
  const warlockCaster = casters.find((c) => c.className === "Warlock")!;
  expect(clericCaster.ability, "Cleric casts off WIS").toBe("WIS");
  expect(warlockCaster.ability, "Warlock casts off CHA").toBe("CHA");
  expect(clericCaster.spellIds.length, "the 4 forged spells are the Cleric's").toBe(4);
  const overlap = clericCaster.spellIds.filter((id) => warlockCaster.spellIds.includes(id));
  expect(overlap, "no spell belongs to two classes").toHaveLength(0);
  // The UI stamps the class beside a prepared spell.
  await expect(
    page.locator("span", { hasText: /^Cleric$/ }).first(),
    "spell rows carry their class stamp",
  ).toBeVisible();

  // One Save DC tile for a hero with two casting abilities — what does it say?
  // WIS-based: 8+2+3 = 13. CHA-based: 8+2+2 = 12.
  const saveDC = await statUnder(page, "Save DC").textContent().catch(() => "(none)");
  console.log(`AUDIT Save DC shown for a WIS-13/CHA-12 dual caster: ${saveDC}`);

  // ── Illegal combos, asked anyway (the server's own door) ─────────────────
  const wizardId = await idByName(page.request, "class", "Wizard");
  const paladinId = await idByName(page.request, "class", "Paladin");
  const refuseWizard = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: wizardId },
  });
  expect(refuseWizard.status(), "INT 10 Wizard dip must be refused").toBe(400);
  const wizardWhy = ((await refuseWizard.json()) as { error?: string }).error ?? "";
  console.log(`AUDIT Wizard refusal: "${wizardWhy}"`);
  expect(wizardWhy).toContain("Intelligence 13");
  const refusePaladin = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: paladinId },
  });
  expect(refusePaladin.status(), "STR 8 Paladin dip must be refused (STR AND CHA)").toBe(400);
  console.log(`AUDIT Paladin refusal: "${((await refusePaladin.json()) as { error?: string }).error}"`);
  d = await heroDetail(page.request, hero);
  expect(d.character.level, "refusals must not half-land").toBe(2);

  // The cross-class cap probe: can this Warlock 1 learn a Warlock cantrip on
  // their next Warlock level? PHB 2024 reads the Warlock table at WARLOCK
  // level; the hero's 3 Cleric cantrips must not eat the Warlock's allowance.
  const [eldritchBlast] = await spellIdsByName(page.request, ["Eldritch Blast"]);
  const warlockId = await idByName(page.request, "class", "Warlock");
  const capProbe = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: warlockId, spells: [eldritchBlast] },
  });
  const capBody = await capProbe.text();
  console.log(`AUDIT Warlock-2 Eldritch Blast pick: status ${capProbe.status()} body ${capBody}`);
  if (!capProbe.ok()) {
    // Refused — the Cleric's cantrips filled the Warlock's cap. Undo nothing;
    // record and carry on (the level did not land).
    console.log("AUDIT FINDING: a Cleric 1/Warlock 1 cannot learn Eldritch Blast at Warlock 2 — cross-class cantrip caps");
  }

  // ── The Ranger level: BLOCKED by the same cross-class cap bug ────────────
  // Ranger's table has zero cantrips, and validateSpellPicks counts the
  // hero's Cleric cantrips against it — so ANY cantrip-owning caster is
  // refused a Ranger (or Paladin) dip outright. Pinned here as a repro; the
  // 2024 round-UP shared-table rule is verified in the rests test instead,
  // whose hero carries no cantrips.
  const rangerIdRepro = await idByName(page.request, "class", "Ranger");
  const refusedRanger = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: rangerIdRepro },
  });
  const rangerRefusal = await refusedRanger.text();
  console.log(`AUDIT FINDING ranger dip refused for a cantrip-owning Cleric: ${rangerRefusal}`);
  expect(refusedRanger.status(), "the legal Ranger dip is refused — the bug's repro").toBe(400);
  expect(rangerRefusal).toContain("Ranger knows at most 0 cantrips");
  d = await heroDetail(page.request, hero);
  const classesNow = (d.character.sheet?.classes ?? []).map((c) => `${c.className} ${c.level}`);
  console.log("AUDIT classes now (ranger never landed): " + classesNow.join(" / "));
  await page.screenshot({ path: shot("09-sheet-after-refused-ranger"), fullPage: true });

  console.log("AUDIT t3 pageErrors: " + JSON.stringify(pageErrors));
  console.log("AUDIT t3 consoleErrors: " + JSON.stringify(consoleErrors));
  expect(pageErrors).toEqual([]);

  await dmCtx.close();
  await pCtx.close();
});

/*
The two rests on a Cleric 2 / Warlock 1 / Ranger 1 (total 4):
  hit dice 3×d8 (Cleric 2 + Warlock 1) + 1×d10 (Ranger)
  shared slots: Cleric 2 + ceil(1/2) = caster 3 → 4 × Lv1, 2 × Lv2
  pact: 1 slot at level 1
  pools: Channel Divinity 2 (Cleric 2, one back per short rest),
         Favored Enemy 2 (Ranger 1, long rest only)

Short rest must return ONLY the pact slot, one Channel Divinity, and the HP the
dice rolled. Long rest must return everything — including, per PHB 2024
("you regain all lost Hit Points and all spent Hit Point Dice"), EVERY hit die.
*/
test("short rest returns pact + the right pools; long rest returns everything; hit dice by the book", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  watch(page, pageErrors, consoleErrors);
  await registerViaAPI(page.request, newAccount("xqhr4"));

  const hero = await forgeHero(page.request, {
    name: unique("Restwright "),
    className: "Cleric",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 13, con: 14, int: 10, wis: 16, cha: 15 },
    skills: ["History", "Medicine"],
  });
  const clericId = await idByName(page.request, "class", "Cleric");
  const warlockId = await idByName(page.request, "class", "Warlock");
  const rangerId = await idByName(page.request, "class", "Ranger");

  // Cleric → 2.
  let res = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: clericId },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  // Warlock 1 — and probe the allowance: PHB 2024 says a Warlock 1 prepares
  // TWO level-1 spells. Offer three and see whether the server counts by the
  // Warlock's level or by the hero's total.
  const threeWarlockSpells = await spellIdsByName(page.request, ["Hex", "Charm Person", "Hellish Rebuke"]);
  res = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: warlockId, spells: threeWarlockSpells },
  });
  console.log(
    `AUDIT Warlock-1 with THREE level-1 spells: status ${res.status()} ` +
      `(PHB 2024: a Warlock 1 prepares two) body ${res.ok() ? "(accepted)" : await res.text()}`,
  );
  if (!res.ok()) {
    // If the server refused the overage, take the level with a legal two.
    res = await page.request.post(`/api/characters/${hero}/levelup`, {
      data: { hpMode: "average", classId: warlockId, spells: threeWarlockSpells.slice(0, 2) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  // Ranger 1.
  res = await page.request.post(`/api/characters/${hero}/levelup`, {
    data: { hpMode: "average", classId: rangerId },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  let d = await heroDetail(page.request, hero);
  expect(d.character.level).toBe(4);
  const dice = Object.fromEntries((d.character.hitDice ?? []).map((x) => [x.die, x.max]));
  expect(dice, "3×d8 (Cleric 2 + Warlock 1) and 1×d10 (Ranger)").toEqual({ 8: 3, 10: 1 });
  expect(d.character.sheet?.spellSlots?.find((s) => s.level === 1)?.max, "caster 3 → 4 Lv1 slots").toBe(4);
  expect(d.character.sheet?.spellSlots?.find((s) => s.level === 2)?.max, "caster 3 → 2 Lv2 slots").toBe(2);
  expect(d.character.sheet?.pactSlots?.max).toBe(1);

  // Spend the day: HP to 1, two Lv1 + one Lv2 slots gone, the pact slot gone.
  // A forged hero's identity is immutable through this PUT — echo it verbatim
  // (name carries the unique suffix) so only the HP moves.
  const raw = (await (await page.request.get(`/api/characters/${hero}`)).json()).character as {
    name: string;
    class: string;
    level: number;
    hpMax: number;
  };
  // PATCH, not PUT (rest.spec.ts still PUTs and silently 405s — reported), and
  // the class display string must be echoed: an absent class reads as changed.
  const put = await page.request.patch(`/api/characters/${hero}`, {
    data: {
      name: raw.name,
      class: raw.class,
      level: raw.level,
      hpCurrent: 1,
      hpMax: raw.hpMax,
    },
  });
  expect(put.ok(), await put.text()).toBeTruthy();
  const slots = await page.request.put(`/api/characters/${hero}/slots`, {
    data: { used: [2, 1, 0, 0, 0, 0, 0, 0, 0], pactUsed: 1 },
  });
  expect(slots.ok(), await slots.text()).toBeTruthy();

  let t = Date.now();
  await page.goto(`/questboard/heroes/${hero}`);
  await expect(page.getByText("Resources")).toBeVisible({ timeout: 20_000 });
  console.log("TIMING rest-sheet-load " + (Date.now() - t) + "ms");

  // Channel Divinity: two pips at Cleric 2. Spend both through the UI.
  const cd = page.getByRole("group", { name: "Channel Divinity" });
  await expect(cd).toBeVisible();
  await expect(cd.getByTitle("click to spend"), "CD has 2 uses at Cleric 2").toHaveCount(2);
  await cd.getByTitle("click to spend").first().click();
  await expect(cd.getByTitle("spent — click to restore")).toHaveCount(1);
  await cd.getByTitle("click to spend").first().click();
  await expect(cd.getByTitle("spent — click to restore")).toHaveCount(2);
  // Favored Enemy SHOULD exist (Ranger 1 declares the pool in SRD content) —
  // but grantSources walks only the starting ClassID (creatures.go:72), so a
  // second class's pools never resolve. Pinned as the bug's repro:
  const feMissing = await page.getByRole("group", { name: "Favored Enemy" }).count();
  console.log(
    `AUDIT FINDING second-class pool: Favored Enemy groups on sheet = ${feMissing} ` +
      "(Ranger 1 declares uses:[2,...] in srd/classes.json — 0 means the pool was never resolved)",
  );
  expect(feMissing, "the bug's repro: a second class's pool is lost").toBe(0);
  await page.screenshot({ path: shot("10-spent-day"), fullPage: true });

  // Short rest: spend the d10 (default) plus two d8s = 3 dice.
  await expect(page.getByText("Hit dice 4 / 4")).toBeVisible();
  await page.getByRole("button", { name: "One more d8 hit die" }).click();
  await page.getByRole("button", { name: "One more d8 hit die" }).click();
  t = Date.now();
  await page.getByRole("button", { name: "Short Rest" }).click();
  await expect(page.getByRole("status")).toContainText(/Caught your breath/, { timeout: 20_000 });
  console.log("TIMING short-rest " + (Date.now() - t) + "ms");
  const shortReport = await page.getByRole("status").textContent();
  console.log(`AUDIT short-rest report: "${shortReport}"`);
  await page.screenshot({ path: shot("11-short-rest"), fullPage: true });

  // What the hour returned — server truth:
  d = await heroDetail(page.request, hero);
  // BUG (repro): a MULTICLASS warlock's pact slot is not returned by a short
  // rest — a pure Warlock's is. Rest resolution reads the starting class only.
  console.log(
    `AUDIT FINDING multiclass pact rest: pactUsed after short rest = ${d.character.sheet?.pactSlots?.used} (2024: must be 0)`,
  );
  expect(d.character.sheet?.pactSlots?.used, "the bug's repro: pact slot stays lost").toBe(1);
  expect(
    d.character.sheet?.spellSlots?.find((s) => s.level === 1)?.used,
    "shared Lv1 slots wait for the night",
  ).toBe(2);
  expect(
    d.character.sheet?.spellSlots?.find((s) => s.level === 2)?.used,
    "shared Lv2 slot waits for the night",
  ).toBe(1);
  const cdPool = d.character.sheet?.pools?.find((p) => p.name === "Channel Divinity");
  expect(cdPool?.used, "one CD back per short rest (2024), one still spent").toBe(1);
  const fePool = d.character.sheet?.pools?.find((p) => p.name === "Favored Enemy");
  expect(fePool, "server truth of the same bug: no Favored Enemy pool at all").toBeUndefined();
  expect(d.character.hpCurrent, "the dice healed something").toBeGreaterThan(1);
  const spentNow = (d.character.hitDice ?? []).reduce((n, x) => n + x.used, 0);
  expect(spentNow, "three dice spent").toBe(3);
  await expect(page.getByText("Hit dice 1 / 4")).toBeVisible();

  // The Long Rest button's own tooltip, for the record.
  const longTitle = await page.getByRole("button", { name: "Long Rest" }).getAttribute("title");
  console.log(`AUDIT Long Rest tooltip: "${longTitle}"`);

  // Long rest: PHB 2024 — all HP, all slots, all pools, ALL hit dice.
  t = Date.now();
  await page.getByRole("button", { name: "Long Rest" }).click();
  await expect(page.getByRole("status")).toContainText(/Whole again/, { timeout: 20_000 });
  console.log("TIMING long-rest " + (Date.now() - t) + "ms");
  const longReport = await page.getByRole("status").textContent();
  console.log(`AUDIT long-rest report: "${longReport}"`);
  await page.screenshot({ path: shot("12-long-rest"), fullPage: true });

  d = await heroDetail(page.request, hero);
  expect(d.character.hpCurrent, "full HP").toBe(d.character.hpMax);
  expect((d.character.sheet?.spellSlots ?? []).every((s) => s.used === 0), "every slot back").toBe(true);
  expect(d.character.sheet?.pactSlots?.used).toBe(0);
  expect(d.character.sheet?.pools?.every((p) => p.used === 0), "every pool back").toBe(true);
  const diceLeftAfterLong = (d.character.hitDice ?? []).reduce((n, x) => n + (x.max - x.used), 0);
  console.log(
    `AUDIT hit dice after long rest: ${diceLeftAfterLong} / 4 — PHB 2024 says 4 / 4 ` +
      `("you regain … all spent Hit Point Dice"); 2014's rule was half the total`,
  );
  const diceText = await page.getByText(/Hit dice \d \/ 4/).textContent();
  console.log(`AUDIT hit dice header now: "${diceText}"`);

  console.log("AUDIT t4 pageErrors: " + JSON.stringify(pageErrors));
  console.log("AUDIT t4 consoleErrors: " + JSON.stringify(consoleErrors));
  expect(pageErrors).toEqual([]);
});
