import { test, expect, type APIRequestContext } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Reading a monster mid-fight (#284).

The DM ran every fight with the Den open in a second tab, because the tracker
named a goblin and said nothing else about it. The name is the door now: rest
the pointer on it for the stat card, press it for the dialog. Both are driven
here in a real browser, which is the lesson #277 taught — a hover wired into a
component and never hovered by a test shipped untouchable.
*/

/** A Den entry's id by name, read as a DM. */
async function denEntry(request: APIRequestContext, name: string): Promise<string> {
  const list = (await (await request.get("/api/rules/monster")).json()) as Array<{ id: string; name: string }>;
  const m = list.find((x) => x.name === name);
  expect(m, `${name} should be in the Den`).toBeTruthy();
  return m!.id;
}

/** Prepare a fight from the given combatants, then trigger it. */
async function runningFight(
  request: APIRequestContext,
  campaignId: string,
  stock: Array<Record<string, unknown>>,
): Promise<string> {
  const made = await request.post(`/api/campaigns/${campaignId}/encounters`, { data: { name: "The Peek" } });
  expect(made.ok(), await made.text()).toBeTruthy();
  const encounterId = (await made.json()).id as string;
  for (const body of stock) {
    const added = await request.post(`/api/encounters/${encounterId}/combatants`, { data: body });
    expect(added.ok(), await added.text()).toBeTruthy();
  }
  const trigger = await request.patch(`/api/encounters/${encounterId}`, { data: { status: "active" } });
  expect(trigger.ok(), await trigger.text()).toBeTruthy();
  return encounterId;
}

test("the DM reads a stat block off the tracker: hover for the card, press for the dialog", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("peek"));
  const campaign = await createCampaign(page.request, unique("Peek Table "));
  const goblin = await denEntry(page.request, "Goblin Warrior");
  const skeleton = await denEntry(page.request, "Skeleton");
  await runningFight(page.request, campaign.id, [
    { kind: "monster", contentId: goblin, count: 3, hidden: true },
    { kind: "monster", contentId: skeleton, hidden: true },
    { kind: "custom", label: "The Looming Shape", hpMax: 30, ac: 12 },
  ]);

  await page.goto(`/questboard/campaigns/${campaign.id}/encounters`);
  await expect(page.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });

  // --- a lone monster: its name is a button ---------------------------------
  const skeletonName = page.getByRole("button", { name: /^Skeleton( 1)?$/ });
  await expect(skeletonName).toBeVisible();
  await skeletonName.hover();
  const card = page.getByRole("tooltip");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Medium Undead");
  // Its vulnerability sits in the entry text — the block is read whole, not a
  // summary of it.
  await expect(card).toContainText("Bludgeoning");

  // Leave, and the card goes.
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();

  // Press, and the same block opens as a dialog that stays put.
  await skeletonName.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Medium Undead");
  await dialog.getByTitle("Close").click();
  await expect(dialog).toBeHidden();

  // --- a mob: hovering the header reads it; pressing still folds the mob ----
  const lead = page.getByText("Goblin Warrior", { exact: true });
  await lead.hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Small Fey");
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();

  await lead.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // …and each member's name is a full door.
  const member = page.getByRole("button", { name: "Goblin Warrior 1", exact: true });
  await expect(member).toBeVisible();
  await member.click();
  await expect(page.getByRole("dialog")).toContainText("Small Fey");
  await page.getByRole("dialog").getByTitle("Close").click();

  // --- a custom foe has nothing behind it: plain text, no door --------------
  await expect(page.getByText("The Looming Shape", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "The Looming Shape", exact: true })).toHaveCount(0);
});

/*
The peek reads one entry by id, and the door answers exactly as the Den list
does: a monster is the DM's, a spell is anyone's, and a refusal is a 404 — a
player holding a monster's id must not learn from the status that it names
one.
*/
test("one entry by id answers as the list would, and refuses with 404", async ({ browser }) => {
  const dm = await (await browser.newContext()).newPage();
  const player = await (await browser.newContext()).newPage();
  await registerViaAPI(dm.request, newAccount("den-dm"));
  await registerViaAPI(player.request, newAccount("den-pl"));
  const campaign = await createCampaign(dm.request, unique("Den Door "));
  await joinCampaign(player.request, campaign.inviteCode);

  const goblin = await denEntry(dm.request, "Goblin Warrior");
  const spells = (await (await player.request.get("/api/rules/spell")).json()) as Array<{ id: string; name: string }>;
  expect(spells.length).toBeGreaterThan(0);

  const mine = await dm.request.get(`/api/rules/content/${goblin}`);
  expect(mine.status(), await mine.text()).toBe(200);
  expect(((await mine.json()) as { name: string }).name).toBe("Goblin Warrior");

  const theirs = await player.request.get(`/api/rules/content/${goblin}`);
  expect(theirs.status(), "a player is refused a monster the way a missing id is").toBe(404);

  const spell = await player.request.get(`/api/rules/content/${spells[0].id}`);
  expect(spell.status(), "the SRD is anyone's to read").toBe(200);

  const nowhere = await player.request.get("/api/rules/content/00000000-0000-4000-8000-000000000000");
  expect(nowhere.status()).toBe(404);
});
