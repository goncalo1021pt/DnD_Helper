import { expect, test } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
The shared roll log (#176).

Two things the tower could not do: roll more than one die at a time, and roll
where anyone else could see it. The journeys worth protecting are that a pool
of mixed dice rolls at once, that a public roll reaches the *other* player's
chronicle, and that the server — not the browser — is what decides the number.
*/

test("a pool of mixed dice rolls at once, and stays private by default", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("pool"));
  const campaign = await createCampaign(page.request, unique("Tower "));

  await page.goto(`/questboard/campaigns/${campaign.id}/board`);
  await page.getByTitle("Open the dice tower").click();

  // The combo from the issue: 1d4 + 2d8, built by tapping.
  await page.getByLabel("Add a d4").click();
  await page.getByLabel("Add a d8").click();
  await page.getByLabel("Add a d8").click();

  // Named largest die first, however it was tapped in.
  const rollButton = page.getByRole("button", { name: "Roll 2d8 + 1d4" });
  await expect(rollButton).toBeVisible();
  await rollButton.click();
  await expect(page.getByText(/2d8 \+ 1d4: /)).toBeVisible({ timeout: 20_000 });

  // Private by default: nothing reached the chronicle.
  const events = (await (
    await page.request.get(`/api/campaigns/${campaign.id}/events?category=rolls`)
  ).json()) as unknown[];
  expect(events).toHaveLength(0);
});

test("a roll in the open reaches the other player's chronicle", async ({ browser }) => {
  const dm = newAccount("rolldm");
  const player = newAccount("rollpl");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("Open Table "));

  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await playerPage.goto("/");
  await registerViaAPI(playerPage.request, player);
  await joinCampaign(playerPage.request, campaign.inviteCode);

  // The player rolls six d6 where the table can see it.
  await playerPage.goto(`/questboard/campaigns/${campaign.id}/board`);
  await playerPage.getByTitle("Open the dice tower").click();
  for (let i = 0; i < 6; i++) await playerPage.getByLabel("Add a d6").click();
  await playerPage.getByLabel(/Roll in the open/).check();
  await playerPage.getByRole("button", { name: "Roll 6d6" }).click();
  await expect(playerPage.getByText("in the open")).toBeVisible({ timeout: 20_000 });

  // The DM reads it in the Rolls channel, dice and all.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/chronicle`);
  await dmPage.getByRole("button", { name: "Rolls", exact: true }).click();
  const line = dmPage.getByText(/rolls 6d6:/);
  await expect(line).toBeVisible({ timeout: 20_000 });
  // Six faces and a total, so the table can check the arithmetic.
  await expect(line).toHaveText(/6d6: (\d+, ){5}\d+ = \d+/);
  // No stray markup: the chronicle prints a message verbatim.
  await expect(line).not.toHaveText(/\*\*/);
});

test("the server rolls a public roll, and refuses a pool the tower does not carry", async ({
  page,
}) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("rollapi"));
  const campaign = await createCampaign(page.request, unique("Fair Dice "));

  // A d7 is not a die this tower carries, however the request was composed.
  const bogus = await page.request.post(`/api/campaigns/${campaign.id}/rolls`, {
    data: { groups: [{ count: 1, sides: 7 }], modifier: 0 },
  });
  expect(bogus.status()).toBe(400);

  // Nor is a hundred and one dice.
  const greedy = await page.request.post(`/api/campaigns/${campaign.id}/rolls`, {
    data: { groups: [{ count: 101, sides: 6 }], modifier: 0 },
  });
  expect(greedy.status()).toBe(400);

  // A real pool comes back rolled — by the server, with every face shown.
  const good = await page.request.post(`/api/campaigns/${campaign.id}/rolls`, {
    data: { groups: [{ count: 2, sides: 6 }], modifier: 3, label: "Fireball" },
  });
  expect(good.status()).toBe(201);
  const result = (await good.json()) as {
    expression: string;
    total: number;
    groups: Array<{ sides: number; results: number[] }>;
  };
  expect(result.expression).toBe("2d6 + 3");
  expect(result.groups[0].results).toHaveLength(2);
  expect(result.total).toBeGreaterThanOrEqual(5);
  expect(result.total).toBeLessThanOrEqual(15);

  // A non-member cannot roll at someone else's table.
  const strangerCtx = await page.context().browser()!.newContext();
  const stranger = await strangerCtx.newPage();
  await stranger.goto("/");
  await registerViaAPI(stranger.request, newAccount("stranger"));
  const barred = await stranger.request.post(`/api/campaigns/${campaign.id}/rolls`, {
    data: { groups: [{ count: 1, sides: 20 }], modifier: 0 },
  });
  expect([403, 404]).toContain(barred.status());
  await strangerCtx.close();
});
