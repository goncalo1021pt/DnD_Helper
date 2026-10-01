import { expect, test, type Page } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Who is who (#302).

A player could not tell who ran their table, a name on the roster led nowhere,
and nobody could choose what they were called — a sign-in through Discord or
Google wrote the provider's name back every time. What is worth pinning: a
chosen name survives the next sign-in, a player reads who runs the table, a
name opens the person, and befriending by id reaches table-mates and nobody
else (an id is no way to find a stranger, so a stranger answers 404 exactly
as a code nobody holds does).
*/

async function devLogin(page: Page, opts: { name: string; id: string }) {
  const q = new URLSearchParams({ name: opts.name, id: opts.id });
  await page.goto(`/api/auth/dev/login?${q.toString()}`);
}

async function me(page: Page) {
  const res = await page.request.get("/api/me");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).user as { id: string; name: string };
}

test("a chosen name outlasts the provider's at the next sign-in", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const door = unique("named-");

  await devLogin(page, { name: "Provider Name", id: door });
  expect((await me(page)).name).toBe("Provider Name");

  // Until a name is chosen the provider's still reaches it.
  await devLogin(page, { name: "Provider Renamed", id: door });
  expect((await me(page)).name).toBe("Provider Renamed");

  await page.goto("/questboard/profile");
  await page.getByRole("button", { name: "Change your name" }).click();
  await page.getByLabel("Your name").fill("  Sir   Chosen  ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Sir Chosen" })).toBeVisible();

  await devLogin(page, { name: "Provider Again", id: door });
  expect((await me(page)).name).toBe("Sir Chosen");

  const blank = await page.request.patch("/api/me", { data: { name: "   " } });
  expect(blank.status()).toBe(400);
  await ctx.close();
});

test("a player reads who runs the table, and a name opens the person", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  const dmAccount = newAccount("rundm");
  await registerViaAPI(dm.request, dmAccount);
  const campaign = await createCampaign(dm.request, unique("Who Runs It "));

  const pCtx = await browser.newContext();
  const player = await pCtx.newPage();
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("runpl"));
  await joinCampaign(player.request, campaign.inviteCode!);

  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  await stranger.goto("/");
  await registerViaAPI(stranger.request, newAccount("runst"));

  // The header names the DM for the player.
  await player.goto(`/questboard/campaigns/${campaign.id}`);
  const runBy = player.getByTestId("run-by");
  await expect(runBy).toContainText(`run by ${dmAccount.username}`);

  // The name is a door: the card says who they are, and offers the ways in.
  await runBy.getByRole("button", { name: dmAccount.username }).click();
  const card = player.getByRole("dialog");
  await expect(card.getByTestId("person-card")).toContainText("Dungeon Master · holds the table");
  await card.getByRole("button", { name: "Ask to be friends" }).click();
  await expect(card.getByText("Asked — waiting on them")).toBeVisible();

  // The Player menu lists the whole table.
  await player.goto(`/questboard/campaigns/${campaign.id}/player`);
  await expect(player.getByTestId("at-the-table")).toContainText(dmAccount.username);

  // A table-mate's id befriends; a stranger's answers as nobody would.
  const playerId = (await me(player)).id;
  const dmId = (await me(dm)).id;
  const accepted = await dm.request.post("/api/me/friends", { data: { userId: playerId } });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const roll = await accepted.json();
  expect(roll.friends.find((f: { userId: string }) => f.userId === playerId)?.state).toBe("accepted");

  const refused = await stranger.request.post("/api/me/friends", { data: { userId: dmId } });
  expect(refused.status()).toBe(404);
  const both = await stranger.request.post("/api/me/friends", {
    data: { userId: dmId, friendCode: "ABCDEFGH" },
  });
  expect(both.status()).toBe(400);

  await dmCtx.close();
  await pCtx.close();
  await strangerCtx.close();
});
