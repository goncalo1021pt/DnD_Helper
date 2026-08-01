import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createCampaign, newAccount, quickAddHero, registerViaAPI, unique } from "./helpers";

/*
The DM's combat tool: prepare a fight at home, trigger it at the table, run
initiative.

EncounterPage.tsx is 1,313 lines and grew 70% in a single release — the second
target of #108, and the surface where a regression is most expensive, because
it breaks in front of six people mid-session.
*/

test("prepares an encounter from the Den, triggers it, and runs initiative", async ({
  page,
}) => {
  const account = newAccount("dm");
  await registerViaAPI(page.request, account);
  const { id: campaignId } = await createCampaign(page.request, unique("Ambush Table "));

  await page.goto(`/questboard/campaigns/${campaignId}/encounters`);

  // --- prepare, ahead of the session --------------------------------------
  await page.getByPlaceholder("Prepare a new encounter — name it…").fill("Goblin Ambush");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(page.getByText("Goblin Ambush")).toBeVisible();
  await expect(page.getByText(/INACTIVE/i)).toBeVisible();

  // --- stock it from the Den ----------------------------------------------
  await page.getByPlaceholder("Search monsters…").fill("Goblin Warrior");
  await expect(page.getByText(/1 of 330 creatures|of 330 creatures/i)).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  // --- trigger it at the table --------------------------------------------
  const trigger = page.getByRole("button", { name: /Trigger/ });
  await expect(trigger).toBeEnabled();
  await trigger.click();

  // The fight is running and the tracker is up.
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Goblin Warrior").first()).toBeVisible();
});

/**
 * Stock the fight from the Den. The Den holds 330 creatures and the search has
 * to come back before Add means anything, so wait on the button rather than on
 * a count that the content can change under us.
 */
async function addFromDen(page: Page, monster: string, qty = 1): Promise<void> {
  await page.getByPlaceholder("Search monsters…").fill(monster);
  const add = page.getByRole("button", { name: "Add", exact: true }).first();
  await expect(add).toBeEnabled({ timeout: 20_000 });
  for (let i = 1; i < qty; i++) await page.getByTitle("One more").first().click();
  await add.click();
}

/*
A mob is one turn, not eight.

The subtlest thing in EncounterPage, and the one with the least to show for
itself on screen: monsters added together share an initiative and act as a
single entry, so `toEntries` collapses them into one row and the turn stepper
translates between entries and the stored `turnIndex`. Its own comment says why
— "otherwise a pack of eight skeletons would eat eight presses of Next turn".

Nothing tested it, and it is exactly the kind of index arithmetic that survives
a refactor looking fine and breaks in front of six people mid-session. With a
mob as the only entry, one press must come all the way round to Round 2; were
the members separate entries it would take three.
*/
test("a mob of monsters takes one turn between them", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("mob"));
  const { id: campaignId } = await createCampaign(page.request, unique("Crypt Table "));

  await page.goto(`/questboard/campaigns/${campaignId}/encounters`);
  await page.getByPlaceholder("Prepare a new encounter — name it…").fill("Skeleton Crypt");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

  // Three of the same creature, added in one go — that is what makes a mob.
  await addFromDen(page, "Skeleton", 3);

  await page.getByRole("button", { name: /Trigger/ }).click();
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });

  // One row for the three of them. The two initiative fields differ by title,
  // which is the only thing that tells a group row from a lone combatant.
  await expect(page.getByTitle("Initiative for the whole group")).toHaveCount(1);
  await expect(page.getByTitle("Type an initiative")).toHaveCount(0);

  // And therefore one press of Next turn wraps the round rather than stepping
  // through the skeletons one at a time.
  await page.getByRole("button", { name: /Next turn/ }).click();
  await expect(page.getByText(/Round\s*2/i)).toBeVisible();
});

/*
Damage lands on the combatant, and standing down puts the fight back in its box.

Two paths either side of the seam the split will cut: `CombatantRow`'s HP
arithmetic, and `EncounterRunner`'s choice between the tracker and the builder.
The second is a one-line ternary that decides which half of a 1,313-line file
you are looking at, so it is worth a test that says which.
*/
test("a hero takes damage, and standing down returns the fight to the builder", async ({
  page,
}) => {
  await registerViaAPI(page.request, newAccount("wound"));
  const { id: campaignId } = await createCampaign(page.request, unique("Bruised Table "));

  await page.goto(`/questboard/campaigns/${campaignId}/encounters`);
  await page.getByPlaceholder("Prepare a new encounter — name it…").fill("A Bad Afternoon");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await addFromDen(page, "Goblin Warrior");
  await page.getByRole("button", { name: /Trigger/ }).click();
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });

  // Read the goblin's hit points rather than asserting a number: the stat block
  // belongs to the SRD content, and what is under test is `applyHp`'s
  // arithmetic, which should hold whatever the Den says the creature has.
  const hp = page.getByText(/^\d+\/\d+$/).first();
  const [before, max] = (await hp.innerText()).split("/").map(Number);
  expect(before).toBeGreaterThan(3);

  await page.getByTitle("Amount to damage or heal").first().fill("3");
  // exact: the amount field is titled "Amount to damage or heal", and getByTitle
  // matches substrings case-insensitively — without this it is the input that
  // gets clicked, and the test passes its way to a hero who never got hurt.
  await page.getByTitle("Damage", { exact: true }).first().click();
  await expect(hp).toHaveText(`${before - 3}/${max}`);

  // Standing down releases the party and hands back the builder — the monsters
  // stay prepared, so the fight can be triggered again.
  await page.getByRole("button", { name: "Stand down" }).click();
  await expect(page.getByRole("button", { name: /Trigger/ })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText(/Round\s*\d/i)).toHaveCount(0);
});

/**
 * Forge a hero and put them in a seat. A local copy for now: forgeHero is
 * exported from sheet.spec.ts, and importing it from there would register that
 * file's tests inside this run — #150 moves it to helpers.ts, and all three
 * copies collapse into an import once that lands.
 */
async function seatedHero(
  request: APIRequestContext,
  campaignId: string,
  hero: { name: string; className: string; abilities: Record<string, number>; skills: string[] },
): Promise<string> {
  const byName = async (kind: string, want: string) => {
    const list = (await (await request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    const hit = list.find((e) => e.name === want);
    expect(hit, `${want} should be in the ${kind} library`).toBeTruthy();
    return hit!.id;
  };
  const forged = await request.post("/api/me/characters/forge", {
    data: {
      name: hero.name,
      classId: await byName("class", hero.className),
      speciesId: await byName("species", "Dwarf"),
      backgroundId: await byName("background", "Acolyte"),
      abilities: hero.abilities,
      skills: hero.skills,
    },
  });
  expect(forged.ok(), await forged.text()).toBeTruthy();
  const id = (await forged.json()).id as string;

  const seated = await request.put(`/api/characters/${id}/seat`, { data: { campaignId } });
  expect(seated.ok(), await seated.text()).toBeTruthy();
  return id;
}

/*
The number the DM rolls against (#153).

A hero summoned into a fight used to be seated at `10 + DEX`, because that is
all the server could see: `characters` holds raw scores and an inventory, and
the AC on the sheet was worked out in the browser and never sent anywhere. So a
Barbarian reading 15 was seated at 12 and a Fighter in Chain Mail at 12 instead
of 16 — and it failed toward hits landing that should have missed, which is the
direction nobody at the table can detect.

Asserted as numbers rather than "an AC is shown", for the same reason #132 was:
the wrong AC was always displayed perfectly.

The second half is the one that would rot quietly. Armour class is derived, not
stored, so a hero who straps a shield on mid-fight has to carry the new number
into a tracker that already seated them.
*/
test("a hero is seated at the AC on their sheet, not 10 + DEX", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("acdm"));
  const campaign = await createCampaign(page.request, unique("The Armoury "));

  // DEX 14 (+2), CON 16 (+3). A Barbarian's Unarmored Defense makes that 15,
  // and their starting kit carries no armour. The old snapshot said 12.
  const heroId = await seatedHero(page.request, campaign.id, {
    name: unique("Grash "),
    className: "Barbarian",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });

  const made = await page.request.post(`/api/campaigns/${campaign.id}/encounters`, {
    data: { name: "The Armoury Brawl" },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const encounterId = (await made.json()).id as string;

  const added = await page.request.post(`/api/encounters/${encounterId}/combatants`, {
    data: { kind: "pc", characterId: heroId },
  });
  expect(added.ok(), await added.text()).toBeTruthy();
  const [combatant] = (await added.json()) as Array<{ id: string; ac: number }>;
  expect(combatant.ac, "a Barbarian's Unarmored Defense reaches the tracker").toBe(15);

  // --- and it keeps up when the kit changes mid-fight -----------------------
  const trigger = await page.request.patch(`/api/encounters/${encounterId}`, {
    data: { status: "active" },
  });
  expect(trigger.ok(), await trigger.text()).toBeTruthy();

  const items = (await (await page.request.get("/api/rules/item")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const chain = items.find((i) => i.name === "Chain Mail");
  expect(chain, "Chain Mail should be in the armory").toBeTruthy();
  const packed = await page.request.post(`/api/characters/${heroId}/items`, {
    data: { contentId: chain!.id, name: "Chain Mail", qty: 1 },
  });
  expect(packed.ok(), await packed.text()).toBeTruthy();
  const itemId = (await packed.json()).id as string;

  // Chain Mail is AC 16 flat — heavy armour ignores DEX, and worn armour
  // replaces the unarmoured formula rather than stacking with it.
  const worn = await page.request.patch(`/api/characters/${heroId}/items/${itemId}`, {
    data: { qty: 1, equipped: true, slot: "armor" },
  });
  expect(worn.ok(), await worn.text()).toBeTruthy();

  const detail = (await (await page.request.get(`/api/encounters/${encounterId}`)).json()) as {
    combatants: Array<{ id: string; ac: number }>;
  };
  const seated = detail.combatants.find((c) => c.id === combatant.id);
  expect(seated?.ac, "donning armour mid-fight moves the tracker's number too").toBe(16);

  // And the DM reads it off the tracker, which is where it actually matters.
  await page.goto(`/questboard/campaigns/${campaign.id}/encounters`);
  await expect(page.getByText(/AC 16/).first()).toBeVisible({ timeout: 20_000 });
});

/*
Will this flatten them? (#110)

The DM had no signal about a fight's weight until the table found out. The
assertion is the numbers, not that a meter rendered — "a difficulty is shown"
was true of every wrong answer this could give.

The second half is the part worth having. The same fight gets harder when
someone does not turn up, because the budget is summed per hero rather than
looked up by party size — so dropping one out has to move the band, and here it
does, without a single monster changing.
*/
test("the builder says how heavy a fight is, and who it assumed was coming", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("weigh"));
  const campaign = await createCampaign(page.request, unique("The Scales "));

  // Three level-3 heroes: 3 × 150/225/400 = a budget of 450 / 675 / 1,200.
  for (const name of ["Alda", "Bryn", "Cael"]) {
    await quickAddHero(page.request, campaign.id, name);
  }

  await page.goto(`/questboard/campaigns/${campaign.id}/encounters`);
  await page.getByPlaceholder("Prepare a new encounter — name it…").fill("A Fair Fight");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

  // Scoped: the Den's "CR: low → high" sort sits a few hundred pixels away, and
  // an unscoped "Low" would happily match it and pass on a broken meter.
  const meter = page.getByRole("group", { name: "Encounter difficulty" });
  await expect(meter.getByText(/450 \/ 675 \/ 1,200/)).toBeVisible({ timeout: 20_000 });

  // One Berserker — CR 2, 450 XP — lands exactly on the low budget.
  await addFromDen(page, "Berserker");
  await expect(meter.getByText(/450\s*XP in the fight/)).toBeVisible({ timeout: 20_000 });
  await expect(meter.getByText("Low", { exact: true })).toBeVisible();

  // Bryn cannot make it. Two heroes have a budget of 300 / 450 / 800, so the
  // same berserker is now a moderate fight — nothing about the fight changed.
  await meter.getByRole("button", { name: /^Bryn/ }).click();
  await expect(meter.getByText(/300 \/ 450 \/ 800/)).toBeVisible();
  await expect(meter.getByText("Moderate", { exact: true })).toBeVisible();
  await expect(meter.getByRole("button", { name: /^Bryn/ })).toHaveAttribute("aria-pressed", "false");
});
