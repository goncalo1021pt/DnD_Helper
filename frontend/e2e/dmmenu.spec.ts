import { test, expect } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  registerViaAPI,
  unique,
} from "./helpers";

/*
The DM's own menu: the door, the table's rules, and the end of a campaign.

DMMenuPage is 865 lines and the last of #108's six with no coverage at all —
large and unnetted, which is the worst pairing on that list. These two cover the
sections that decide something rather than display it: whether a player can sit
down, and whether the table still exists.

Both are driven by two browsers, because both are about what a *second* person
can do — a rule the DM sets alone and never sees the effect of is not the rule.
*/

test("a barred door holds a hero until the DM lets them in", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmdoor"));
  const campaign = await createCampaign(dmPage.request, unique("Barred Table "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("pldoor"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  // The door starts open. Bar it from the Table Rules, through the UI, because
  // the select is the only place this rule is ever set.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/dm`);
  await dmPage.getByRole("combobox").filter({ hasText: /heroes seat freely/ }).selectOption("barred");

  // A hero on the player's own account — `quickAddHero` is the DM's roster form
  // and a player is "not allowed" to use it, which is the point of the door.
  const made = await plPage.request.post("/api/me/characters", {
    data: { name: unique("Knock "), class: "Orc Barbarian", level: 3, hpCurrent: 24, hpMax: 24 },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const heroId = (await made.json()).id as string;
  const seat = await plPage.request.put(`/api/characters/${heroId}/seat`, {
    data: { campaignId: campaign.id },
  });
  expect(seat.ok(), await seat.text()).toBeTruthy();

  // The DM sees them waiting, and nobody is seated yet.
  await dmPage.reload();
  await expect(dmPage.getByRole("button", { name: "Let them in" })).toBeVisible({
    timeout: 20_000,
  });

  await dmPage.getByRole("button", { name: "Let them in" }).click();
  await expect(dmPage.getByRole("button", { name: "Let them in" })).toHaveCount(0, {
    timeout: 20_000,
  });

  // And the hero is at the table for real, not merely gone from the queue.
  const party = await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/characters`)
  ).json();
  expect(party.map((c: { id: string }) => c.id)).toContain(heroId);

  await dmCtx.close();
  await plCtx.close();
});

/*
Disbanding is the one irreversible thing a DM can do from this page, which is
why it is typed rather than clicked — and why it is worth a test that the
player's copy of the table goes too.
*/
test("disbanding takes the table away from everyone at it", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmend"));
  const name = unique("Doomed Table ");
  const campaign = await createCampaign(dmPage.request, name);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plend"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  await plPage.goto("/questboard");
  await expect(plPage.getByText(name)).toBeVisible({ timeout: 20_000 });

  await dmPage.goto(`/questboard/campaigns/${campaign.id}/dm`);
  await dmPage.getByRole("button", { name: "Disband this campaign" }).click();

  // The name has to be typed out: a click alone cannot end a campaign.
  const confirm = dmPage.getByRole("dialog").getByRole("button", { name: /Disband/ });
  await expect(confirm).toBeDisabled();
  await dmPage.getByPlaceholder(name).fill(name);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Gone from the DM's hall, and from the player's.
  await expect(dmPage).toHaveURL(/\/questboard\/?$/, { timeout: 20_000 });
  await expect(dmPage.getByText(name)).toHaveCount(0);
  await plPage.reload();
  await expect(plPage.getByText(name)).toHaveCount(0, { timeout: 20_000 });

  await dmCtx.close();
  await plCtx.close();
});
