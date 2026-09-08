import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
A spell named in a stat block opens its entry (#285), the way a condition
already does. Three spellings are in the wild — the 2024 books italicise a
name, the 2014 books list them lowercase after "Cantrips (at will):", and a
scanned book lists them plain — and a bare word in prose must never link, or
"resistance" would light up in every second sentence. All of it is driven
here through the shared renderer, in the Den and inside the tracker's peek.
*/

const HEDGE_WIZARD = {
  size: "Medium",
  type: "Humanoid",
  alignment: "Neutral",
  ac: 12,
  hp: 22,
  speed: "30 ft.",
  cr: "1",
  crValue: 1,
  abilities: { str: 9, dex: 14, con: 11, int: 17, wis: 12, cha: 11 },
  description: [
    "**Spellcasting.** The wizard is a 3rd-level spellcaster. It has resistance to cold damage.",
    "Cantrips (at will): fire bolt, light",
    "1/day each: fly (self only), invisibility",
    "**Bonus Actions**",
    "**Misty Step (1/Day).** The wizard casts _Misty Step_.",
  ].join("\n\n"),
};

async function homebrewMonster(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post("/api/rules/monster", {
    data: { name, summary: "A hedge wizard, written the 2014 way.", data: HEDGE_WIZARD },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

async function denEntry(request: APIRequestContext, name: string): Promise<string> {
  const list = (await (await request.get("/api/rules/monster")).json()) as Array<{ id: string; name: string }>;
  const m = list.find((x) => x.name === name);
  expect(m, `${name} should be in the Den`).toBeTruthy();
  return m!.id;
}

/** The reader is the topmost dialog; the Den's own reading dialog may sit under it. */
function reader(page: Page) {
  return page.getByRole("dialog").last();
}

test("a spell named in a stat block opens its entry — listed, italic, and never from bare prose", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("spell"));
  const campaign = await createCampaign(page.request, unique("Spell Table "));
  const wizardName = unique("Hedge Wizard ");
  await homebrewMonster(page.request, wizardName);

  await page.goto(`/questboard/campaigns/${campaign.id}/den`);
  await page.getByPlaceholder("Search by name or type…").fill(wizardName);
  await page.getByRole("button", { name: new RegExp(`^${wizardName}`) }).click();
  const reading = page.getByRole("dialog").first();
  await expect(reading.getByText(wizardName).first()).toBeVisible();

  // --- a 2014-style lowercase list links each name it knows ----------------
  await reading.getByRole("button", { name: "Spell: Fire Bolt" }).click();
  await expect(reader(page)).toContainText("Fire Bolt");
  await expect(reader(page)).toContainText("mote of fire");
  await reader(page).getByTitle("Close").click();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  // The note after a name stays prose, and so does a bare word — Resistance
  // is a cantrip, and "resistance to cold damage" is not a cast.
  await expect(reading.getByRole("button", { name: /self only/ })).toHaveCount(0);
  await expect(reading.getByRole("button", { name: "Spell: Resistance" })).toHaveCount(0);
  await expect(reading.getByRole("button", { name: "Spell: Fly" })).toBeVisible();

  // --- a 2024-style italic name links wherever it stands -------------------
  await reading.getByRole("button", { name: "Spell: Misty Step" }).click();
  await expect(reader(page)).toContainText("Misty Step");
  await reader(page).getByTitle("Close").click();

  // --- and the SRD's own mage, straight from the book ----------------------
  await reading.getByTitle("Close").click();
  await page.getByPlaceholder("Search by name or type…").fill("Mage");
  await page.getByRole("button", { name: /^Mage\b/ }).first().click();
  await page.getByRole("dialog").first().getByRole("button", { name: "Spell: Fireball" }).click();
  await expect(reader(page)).toContainText("fiery explosion");
});

/*
The reader outlives the card it was opened from. A term inside a hover card
used to own its own dialog, which was torn down with the card the moment the
pointer moved — which is the moment the dialog opens. That predates spells
(a condition did the same) and #284 made it easy to reach.
*/
test("a spell or condition pressed inside the tracker's peek stays open after the card goes", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("peekspell"));
  const campaign = await createCampaign(page.request, unique("Peek Spell "));
  const wizardName = unique("Hedge Wizard ");
  const wizard = await homebrewMonster(page.request, wizardName);
  const wolf = await denEntry(page.request, "Wolf");

  const made = await page.request.post(`/api/campaigns/${campaign.id}/encounters`, { data: { name: "The Reading" } });
  expect(made.ok(), await made.text()).toBeTruthy();
  const encounterId = (await made.json()).id as string;
  for (const contentId of [wizard, wolf]) {
    const added = await page.request.post(`/api/encounters/${encounterId}/combatants`, {
      data: { kind: "monster", contentId, hidden: true },
    });
    expect(added.ok(), await added.text()).toBeTruthy();
  }
  const trigger = await page.request.patch(`/api/encounters/${encounterId}`, { data: { status: "active" } });
  expect(trigger.ok(), await trigger.text()).toBeTruthy();

  await page.goto(`/questboard/campaigns/${campaign.id}/encounters`);
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });

  // A spell, from inside the card.
  await page.getByRole("button", { name: new RegExp(`^${wizardName}`) }).hover();
  const card = page.getByRole("tooltip");
  await card.getByRole("button", { name: "Spell: Fire Bolt" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("mote of fire");
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByTitle("Close").click();
  await expect(dialog).toBeHidden();

  // A condition, the same way — the Rulebook moved onto the same reader.
  await page.getByRole("button", { name: /^Wolf( 1)?$/ }).hover();
  await card.getByRole("button", { name: "Rule: Prone" }).click();
  await expect(dialog).toContainText("Prone");
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();
  await expect(dialog).toBeVisible();
});
