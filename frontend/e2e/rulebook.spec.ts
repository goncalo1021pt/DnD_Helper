import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  newAccount,
  quickAddHero,
  registerViaAPI,
  unique,
} from "./helpers";

/*
The Rulebook (#199).

The keywords the game leans on — weapon properties, conditions — were words a
player had to look up in a book at the table. These assert the two places the
rule now opens itself: a property on a weapon card, and a condition chip in
the middle of a fight. The seed itself is held to the validator in Go
(srd_rules_test.go); this is about the words being tappable where they appear.
*/

async function addByName(request: APIRequestContext, heroId: string, name: string): Promise<void> {
  const list = (await (await request.get(`/api/rules/item`)).json()) as Array<{ id: string; name: string }>;
  const hit = list.find((e) => e.name === name);
  expect(hit, `${name} should be in the armory`).toBeTruthy();
  const res = await request.post(`/api/characters/${heroId}/items`, {
    data: { contentId: hit!.id, qty: 1 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test("Versatile on a weapon card opens the rule", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("rulebook"));
  const id = await forgeHero(page.request, {
    name: unique("Lexica "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  await addByName(page.request, id, "Longsword");

  await page.goto(`/questboard/heroes/${id}`);
  await page.getByRole("button", { name: "Inventory" }).click();
  await page.getByRole("button", { name: /Longsword/ }).first().click();

  // The card's Properties row carries the keyword as a quiet affordance.
  await page.getByRole("button", { name: "Rule: Versatile" }).click();
  const rule = page.getByRole("dialog").last();
  await expect(rule.getByText("Versatile", { exact: true })).toBeVisible();
  await expect(rule.getByText(/used with one or two hands/)).toBeVisible();
  await expect(rule.getByText("Weapon property")).toBeVisible();
});

test("a condition chip mid-fight opens the rule", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("ruledm"));
  const campaign = await createCampaign(page.request, unique("Grapple Pit "));
  const heroId = await quickAddHero(page.request, campaign.id, unique("Wrestler "));

  const created = await page.request.post(`/api/campaigns/${campaign.id}/encounters`, {
    data: { name: unique("Pinned Down ") },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const encounterId = (await created.json()).id as string;
  const seated = await page.request.post(`/api/encounters/${encounterId}/combatants`, {
    data: { kind: "pc", characterId: heroId },
  });
  expect(seated.ok(), await seated.text()).toBeTruthy();
  await page.request.patch(`/api/encounters/${encounterId}`, { data: { status: "active" } });
  const fight = await (await page.request.get(`/api/encounters/${encounterId}`)).json();
  const combatantId = (fight.combatants as Array<{ id: string }>)[0].id;
  const pinned = await page.request.patch(`/api/combatants/${combatantId}`, {
    data: { conditions: ["Grappled"] },
  });
  expect(pinned.ok(), await pinned.text()).toBeTruthy();

  await page.goto(`/questboard/campaigns/${campaign.id}/encounters`);
  await page.getByRole("button", { name: "Rule: Grappled" }).click();
  const rule = page.getByRole("dialog").last();
  await expect(rule.getByText(/Speed 0\./).first()).toBeVisible();
  await expect(rule.getByText("Condition", { exact: true })).toBeVisible();
});

test("the codex grew a Rules shelf", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("ruletab"));
  const campaign = await createCampaign(page.request, unique("Library "));
  await page.goto(`/questboard/campaigns/${campaign.id}/codex`);
  await page.getByRole("button", { name: "Rules", exact: true }).click();
  await expect(page.getByText("Opportunity Attack").first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Search this shelf…").fill("Vex");
  await expect(page.getByText(/hands you Advantage on your next swing/)).toBeVisible();
});
