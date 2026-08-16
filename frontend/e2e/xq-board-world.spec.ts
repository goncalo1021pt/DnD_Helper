import { test, expect, type Page } from "@playwright/test";
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
  settled,
  unique,
} from "./helpers";

/*
Exploratory QA: the board and the world.

DM charts a nested place tree through the World page UI, veils and reveals
(party-wide and hero-by-hero), hangs quests on places. Player side: the board
must show only revealed notices and the gazetteer only revealed places — with
leak probes (raw API payloads, URL guessing, claiming a hidden quest by id).
Plus: reparent a subtree via the pencil, and delete a veiled place that has
children and notices to see where the veil lands.
*/

const SHOT = "exp-shots/board-world";

function watchConsole(page: Page, tag: string): string[] {
  const errs: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errs.push(msg.text());
      console.log(`CONSOLE-ERR [${tag}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    errs.push(String(err));
    console.log(`PAGE-ERR [${tag}] ${err}`);
  });
  return errs;
}

async function timed(label: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  await fn();
  console.log(`TIMING ${label} ${Date.now() - t0}ms`);
}

/* The party-wide eye toggle of a place row: the button just before its pencil. */
function eyeOf(page: Page, name: string) {
  return page
    .getByRole("button", { name: `Edit ${name}` })
    .locator("xpath=preceding-sibling::button[1]");
}

/* The trash of a place row: the button just after its pencil. */
function trashOf(page: Page, name: string) {
  return page
    .getByRole("button", { name: `Edit ${name}` })
    .locator("xpath=following-sibling::button[1]");
}

test("the cartographer charts a nested world; the player's board and gazetteer hold only the lit half", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watchConsole(dmPage, "dm");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmworld"));
  const campaign = await createCampaign(dmPage.request, unique("The Lit Half "));

  // --- chart realm > region > city (+ one secret) through the UI -----------
  await timed("world-page-load-dm", async () => {
    await dmPage.goto(`/questboard/campaigns/${campaign.id}/world`);
    await expect(dmPage.getByRole("heading", { name: "The World" })).toBeVisible();
  });

  const chart = async (name: string, parentLabel?: string) => {
    await dmPage.getByPlaceholder("e.g. Lisboa").fill(name);
    // .field-label uppercases via CSS, so a case-sensitive exact match sees
    // "INSIDE" — match case-insensitively.
    if (parentLabel) {
      await dmPage.getByLabel("Inside").first().selectOption({ label: parentLabel });
    } else {
      await dmPage
        .getByLabel("Inside")
        .first()
        .selectOption({ label: "— nowhere, a realm of its own —" });
    }
    await timed(`chart-place-${name}`, async () => {
      await dmPage.getByRole("button", { name: "Chart it" }).click();
      await expect(dmPage.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
    });
  };

  await chart("Realm of Vys");
  await chart("Mistmarch", "Realm of Vys");
  await chart("Cinderfall", "— Mistmarch");
  await chart("The Sunken Crypt", "— Mistmarch");

  // Everything starts veiled; reveal all but the crypt, party-wide.
  for (const name of ["Realm of Vys", "Mistmarch", "Cinderfall"]) {
    const eye = eyeOf(dmPage, name);
    await expect(eye).toHaveAttribute("aria-pressed", "false");
    await eye.click();
    await expect(eye).toHaveAttribute("aria-pressed", "true");
  }
  await expect(eyeOf(dmPage, "The Sunken Crypt")).toHaveAttribute("aria-pressed", "false");
  await dmPage.screenshot({ path: `${SHOT}/01-dm-cartographer-table.png`, fullPage: true });

  // --- hang notices through the DM's quill ---------------------------------
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/board`);
  const post = async (
    title: string,
    whereLabel: string | null,
    draft = false,
  ) => {
    await dmPage.getByRole("button", { name: "Post a Quest" }).click();
    const quill = dmPage.getByRole("dialog");
    await quill.getByPlaceholder("e.g. Rats in the Cellar").fill(title);
    if (whereLabel) {
      // Scoped to the dialog: the board's filter row also says "Where", and
      // .field-label uppercases via CSS so exact matching would see "WHERE".
      await quill.getByLabel("Where").selectOption({ label: whereLabel });
    }
    if (draft) {
      await dmPage.getByRole("button", { name: "The party can see this" }).click();
      await expect(
        dmPage.getByRole("button", { name: "Drafted — hidden from the party" }),
      ).toBeVisible();
    }
    await timed(`post-quest-${title}`, async () => {
      await dmPage.getByRole("button", { name: "Nail it to the board" }).click();
      await expect(dmPage.locator("article").filter({ hasText: title })).toBeVisible();
    });
  };

  await post("Rats in the Granary", "— — Cinderfall");
  await post("The Crypt Stirs", "— — The Sunken Crypt");
  await post("Whispers of the Wyrm", null, true);

  // The DM is told which notices are being held back, and why.
  await expect(
    dmPage.locator("article").filter({ hasText: "The Crypt Stirs" }).getByText("Dark by place"),
  ).toBeVisible();
  await expect(
    dmPage.locator("article").filter({ hasText: "Whispers of the Wyrm" }).getByText("Draft"),
  ).toBeVisible();
  await dmPage.screenshot({ path: `${SHOT}/02-dm-board-veil-chips.png`, fullPage: true });

  // Grab the hidden ids for the player-side probes.
  const dmLocs = (await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/locations`)
  ).json()) as Array<{ id: string; name: string }>;
  const cryptId = dmLocs.find((l) => l.name === "The Sunken Crypt")!.id;
  const dmQuests = (await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/quests`)
  ).json()) as Array<{ id: string; title: string }>;
  const cryptQuestId = dmQuests.find((q) => q.title === "The Crypt Stirs")!.id;

  // --- the player walks in --------------------------------------------------
  const player = newAccount("plworld");
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watchConsole(plPage, "player");
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);

  await timed("board-load-player", async () => {
    await plPage.goto(`/questboard/campaigns/${campaign.id}/board`);
    await expect(plPage.getByText("Rats in the Granary")).toBeVisible();
  });
  await expect(plPage.getByText("The Crypt Stirs")).toBeHidden();
  await expect(plPage.getByText("Whispers of the Wyrm")).toBeHidden();

  // The place filter chips must not name the crypt.
  await expect(plPage.getByRole("button", { name: "Cinderfall" })).toBeVisible();
  await expect(plPage.getByRole("button", { name: "Sunken Crypt" })).toHaveCount(0);
  await plPage.screenshot({ path: `${SHOT}/03-player-board.png`, fullPage: true });

  // Raw payload probes: neither hidden titles nor DM-only veil state may ship.
  const questsRaw = await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/quests`)
  ).text();
  expect(questsRaw).not.toContain("Crypt");
  expect(questsRaw).not.toContain("Wyrm");
  expect(questsRaw).not.toContain("visibleToParty");
  expect(questsRaw).not.toContain("hiddenByLocation");
  const locsRaw = await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/locations`)
  ).text();
  expect(locsRaw).not.toContain("Sunken");
  expect(locsRaw).not.toContain("visibleToParty");

  // URL guessing with the hidden place id gets an empty corner, not a leak.
  await plPage.goto(`/questboard/campaigns/${campaign.id}/board?place=${cryptId}`);
  await expect(plPage.getByText("Nothing posted here")).toBeVisible();
  expect(await plPage.content()).not.toContain("Sunken");
  await plPage.screenshot({ path: `${SHOT}/04-player-url-guess.png`, fullPage: true });

  // Claiming a hidden notice by guessed id is refused as if it did not exist.
  const stolen = await plPage.request.post(`/api/quests/${cryptQuestId}/claim`);
  expect(stolen.status(), await stolen.text()).toBe(404);

  // The gazetteer holds three lit places and no cartography tools.
  await timed("world-page-load-player", async () => {
    await plPage.goto(`/questboard/campaigns/${campaign.id}/world`);
    await expect(plPage.getByText("Cinderfall")).toBeVisible();
  });
  await expect(plPage.getByText("Realm of Vys")).toBeVisible();
  await expect(plPage.getByText("Mistmarch")).toBeVisible();
  await expect(plPage.getByText("The Sunken Crypt")).toBeHidden();
  await expect(plPage.getByPlaceholder("e.g. Lisboa")).toBeHidden();
  await plPage.screenshot({ path: `${SHOT}/05-player-gazetteer.png`, fullPage: true });

  // --- claim through the UI; the DM reviews and awards ----------------------
  await plPage.goto(`/questboard/campaigns/${campaign.id}/board`);
  await timed("claim-notice", async () => {
    await plPage.getByRole("button", { name: "Claim Notice" }).click();
    await expect(plPage.getByText("Claimed by")).toBeVisible();
  });
  await expect(plPage.getByText(player.username)).toBeVisible();
  await expect(plPage.getByRole("button", { name: "Release" })).toBeVisible();

  await dmPage.goto(`/questboard/campaigns/${campaign.id}/board`);
  const ratsCard = dmPage.locator("article").filter({ hasText: "Rats in the Granary" });
  await expect(ratsCard.getByText("Claimed by")).toBeVisible();
  await expect(ratsCard.getByText(player.username)).toBeVisible();

  // Review: flag it active, then award by amending the notice to completed.
  await ratsCard.getByRole("button", { name: "Change status" }).click();
  await expect(ratsCard.getByText("Claimed", { exact: true })).toBeVisible();
  await ratsCard.getByRole("button", { name: "Edit", exact: true }).click();
  await dmPage.getByRole("dialog").getByLabel("Status").selectOption("completed");
  await dmPage.getByRole("button", { name: "Save the notice" }).click();
  await expect(ratsCard.getByText("Completed")).toBeVisible();
  await dmPage.screenshot({ path: `${SHOT}/06-dm-board-awarded.png`, fullPage: true });

  // The player sees the award land.
  await plPage.reload();
  await expect(
    plPage.locator("article").filter({ hasText: "Rats in the Granary" }).getByText("Completed"),
  ).toBeVisible();
  await plPage.screenshot({ path: `${SHOT}/07-player-board-completed.png`, fullPage: true });

  await dmCtx.close();
  await plCtx.close();
});

test("a place revealed to one hero alone reaches that player and no other", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watchConsole(dmPage, "dm2");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmhero"));
  const campaign = await createCampaign(dmPage.request, unique("The Singled Out "));

  const stair = await createLocation(dmPage.request, campaign.id, "The Smugglers' Stair");
  await postQuest(dmPage.request, campaign.id, "A quiet job on the stair", stair);

  // Two players, each with a seated hero.
  const heroFor = async (page: Page, account: ReturnType<typeof newAccount>, heroName: string) => {
    await page.goto("/");
    await registerViaAPI(page.request, account);
    await joinCampaign(page.request, campaign.inviteCode);
    const id = await forgeHero(page.request, {
      name: heroName,
      className: "Fighter",
      speciesName: "Dwarf",
      backgroundName: "Acolyte",
      abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      skills: ["Perception", "Survival"],
    });
    await seatHero(page.request, id, campaign.id);
  };

  const aCtx = await browser.newContext();
  const aPage = await aCtx.newPage();
  watchConsole(aPage, "playerA");
  await heroFor(aPage, newAccount("plaveline"), "Aveline");

  const bCtx = await browser.newContext();
  const bPage = await bCtx.newPage();
  watchConsole(bPage, "playerB");
  await heroFor(bPage, newAccount("plborin"), "Borin");

  // The DM singles out Aveline through the pencil's veil panel.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/world`);
  await dmPage.getByRole("button", { name: "Edit The Smugglers' Stair" }).click();
  const avelineRow = dmPage
    .locator("div")
    .filter({ has: dmPage.getByText("Aveline", { exact: true }) })
    .last();
  await avelineRow.getByRole("button", { name: "Show", exact: true }).click();
  await settled(dmPage);
  await expect(dmPage.getByText("1 hero singled out")).toBeVisible();
  await dmPage.screenshot({ path: `${SHOT}/08-dm-hero-by-hero-veil.png`, fullPage: true });

  // Aveline's player sees the stair and the notice hanging in it.
  await aPage.goto(`/questboard/campaigns/${campaign.id}/world`);
  await expect(aPage.getByText("The Smugglers' Stair")).toBeVisible();
  await aPage.goto(`/questboard/campaigns/${campaign.id}/board`);
  await expect(aPage.getByText("A quiet job on the stair")).toBeVisible();
  await aPage.screenshot({ path: `${SHOT}/09-playerA-sees-stair.png`, fullPage: true });

  // Borin's player still has a blank map and an empty board.
  await bPage.goto(`/questboard/campaigns/${campaign.id}/world`);
  await expect(bPage.getByText("The map is still blank")).toBeVisible();
  const bLocs = await (
    await bPage.request.get(`/api/campaigns/${campaign.id}/locations`)
  ).text();
  expect(bLocs).not.toContain("Smugglers");
  const bQuests = await (
    await bPage.request.get(`/api/campaigns/${campaign.id}/quests`)
  ).text();
  expect(bQuests).not.toContain("quiet job");
  await bPage.screenshot({ path: `${SHOT}/10-playerB-blank-map.png`, fullPage: true });

  await dmCtx.close();
  await aCtx.close();
  await bCtx.close();
});

test("reparenting a region through the pencil moves its whole subtree", async ({ page }) => {
  watchConsole(page, "reparent");
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmmove"));
  const campaign = await createCampaign(page.request, unique("The Moved March "));

  const auren = await createLocation(page.request, campaign.id, "Kingdom of Auren");
  const nix = await createLocation(page.request, campaign.id, "Empire of Nix");
  const gloom = await createLocation(page.request, campaign.id, "Gloomhollow", auren);
  const docks = await createLocation(page.request, campaign.id, "Gloom Docks", gloom);
  await postQuest(page.request, campaign.id, "Fog over the docks", docks);

  await page.goto(`/questboard/campaigns/${campaign.id}/world`);
  await page.getByRole("button", { name: "Edit Gloomhollow" }).click();
  await page.getByLabel("Move inside").selectOption(nix);
  await timed("reparent-save", async () => {
    await page.getByRole("button", { name: "Save the chart" }).click();
    await settled(page);
  });

  // The server's answer: the region and everything inside it now hang off Nix.
  const after = (await (
    await page.request.get(`/api/campaigns/${campaign.id}/locations`)
  ).json()) as Array<{ id: string; name: string; parentId?: string; depth: number }>;
  const byName = Object.fromEntries(after.map((l) => [l.name, l]));
  expect(byName["Gloomhollow"].parentId).toBe(nix);
  expect(byName["Gloomhollow"].depth).toBe(1);
  expect(byName["Gloom Docks"].parentId).toBe(gloom);
  expect(byName["Gloom Docks"].depth).toBe(2);
  expect(after.map((l) => l.name)).toEqual([
    "Empire of Nix",
    "Gloomhollow",
    "Gloom Docks",
    "Kingdom of Auren",
  ]);

  // And the ladder redraws in that order.
  const drawn = await page.locator("span.font-heading.truncate").allTextContents();
  expect(drawn.map((t) => t.trim())).toEqual([
    "Empire of Nix",
    "Gloomhollow",
    "Gloom Docks",
    "Kingdom of Auren",
  ]);
  await page.screenshot({ path: `${SHOT}/11-dm-reparented-subtree.png`, fullPage: true });
});

test("deleting a veiled place unpins its notices — probing where the veil lands", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  watchConsole(dmPage, "dmdelete");
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmerase"));
  const campaign = await createCampaign(dmPage.request, unique("The Erased Reach "));

  // A veiled realm with a nested vault; a party-visible notice hangs in the
  // vault, dark only because of the veil above it.
  const reach = await createLocation(dmPage.request, campaign.id, "The Silent Reach");
  const vault = await createLocation(dmPage.request, campaign.id, "Whispering Vault", reach);
  await postQuest(dmPage.request, campaign.id, "Steal the Whisper-Pearl", vault);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  watchConsole(plPage, "plerase");
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plerase"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  // Before: the player knows nothing of any of it.
  const before = await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/quests`)
  ).text();
  expect(before).not.toContain("Whisper");

  // The DM erases the whole veiled realm from the cartographer's table.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/world`);
  dmPage.once("dialog", (d) => {
    console.log(`CONFIRM-TEXT ${d.message()}`);
    d.accept();
  });
  await timed("delete-veiled-realm", async () => {
    await trashOf(dmPage, "The Silent Reach").click();
    await expect(dmPage.getByRole("button", { name: "Edit The Silent Reach" })).toBeHidden();
  });
  // The nested vault went with it.
  await expect(dmPage.getByRole("button", { name: "Edit Whispering Vault" })).toBeHidden();
  await dmPage.screenshot({ path: `${SHOT}/12-dm-after-delete.png`, fullPage: true });

  // The DM's board keeps the notice, unpinned, stamped with where it hung.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/board`);
  const card = dmPage.locator("article").filter({ hasText: "Steal the Whisper-Pearl" });
  await expect(card).toBeVisible();
  await dmPage.screenshot({ path: `${SHOT}/13-dm-board-after-delete.png`, fullPage: true });

  // THE PROBE: the notice was dark solely because of the place's veil. With the
  // place erased, does it surface to the party — carrying the secret name?
  const afterRaw = await (
    await plPage.request.get(`/api/campaigns/${campaign.id}/quests`)
  ).text();
  console.log(`VEIL-PROBE player quests after delete: ${afterRaw}`);
  await plPage.goto(`/questboard/campaigns/${campaign.id}/board`);
  await settled(plPage);
  await plPage.screenshot({ path: `${SHOT}/14-player-board-after-delete.png`, fullPage: true });

  const leaked = afterRaw.includes("Whisper");
  console.log(`VEIL-PROBE leaked=${leaked}`);
  expect(
    leaked,
    "a notice hidden only by its place's veil surfaced to the party when the place was deleted — bearing the veiled place's name",
  ).toBe(false);

  await dmCtx.close();
  await plCtx.close();
});

test("a player cannot work the cartographer's tools by API — nor lift a veil on themselves", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmpriv"));
  const campaign = await createCampaign(dmPage.request, unique("The Locked Chest "));
  const hidden = await createLocation(dmPage.request, campaign.id, "The Hidden Grotto");
  const lit = await createLocation(dmPage.request, campaign.id, "Lantern Row");
  await revealLocation(dmPage.request, lit);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plpriv"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  const r = plPage.request;
  const attempts: Array<[string, () => Promise<{ status(): number; text(): Promise<string> }>]> = [
    ["reveal the hidden place to the party", () =>
      r.put(`/api/locations/${hidden}/visibility`, { data: { scope: "party", visible: true } })],
    ["reveal the LIT place's veil state (probe on a known id)", () =>
      r.put(`/api/locations/${lit}/visibility`, { data: { scope: "party", visible: false } })],
    ["rename a known place", () =>
      r.patch(`/api/locations/${lit}`, { data: { name: "Stolen Row", description: "" } })],
    ["reparent a known place", () =>
      r.put(`/api/locations/${lit}/parent`, { data: { parentId: null } })],
    ["erase a known place", () => r.delete(`/api/locations/${lit}`)],
    ["chart a place of their own", () =>
      r.post(`/api/campaigns/${campaign.id}/locations`, { data: { name: "Player Fort" } })],
    ["nail up a notice of their own", () =>
      r.post(`/api/campaigns/${campaign.id}/quests`, { data: { title: "Free gold" } })],
  ];
  for (const [what, call] of attempts) {
    const res = await call();
    const status = res.status();
    console.log(`PRIV-PROBE ${what}: ${status}`);
    expect([401, 403, 404], `a player must be refused when trying to ${what} (got ${status})`)
      .toContain(status);
  }

  // And the hidden place stayed hidden after all that rattling.
  const locs = await (await r.get(`/api/campaigns/${campaign.id}/locations`)).text();
  expect(locs).not.toContain("Grotto");
  expect(locs).toContain("Lantern Row");

  await dmCtx.close();
  await plCtx.close();
});
