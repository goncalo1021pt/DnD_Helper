import { test, expect } from "@playwright/test";
import { newAccount, registerViaUI, unique } from "./helpers";

/*
The journey the app exists for: a DM founds a table, nails up a notice, a
player walks in with the invite code and claims it.

If this passes, the spine is intact — auth, the campaign hall, the board, the
invite gate, membership, and claiming. It is deliberately the one spec that
does everything through the UI.
*/

test("a DM founds a table and posts a quest; a player joins and claims it", async ({
  browser,
}) => {
  const dm = newAccount("dm");
  const player = newAccount("pl");
  const campaignName = unique("The Sundered ");
  const questTitle = unique("Rats in the Cellar ");

  // --- the DM's side -------------------------------------------------------
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await registerViaUI(dmPage, dm);

  await dmPage.getByPlaceholder("Name of the campaign").fill(campaignName);
  await dmPage.getByRole("button", { name: "Found", exact: true }).click();

  // The new table appears and opens onto its hall.
  await dmPage.getByText(campaignName, { exact: false }).first().click();
  await expect(dmPage.getByRole("heading", { name: "The Quest Board" })).toBeVisible();

  // Lift the invite code out of the header for the player.
  const inviteButton = dmPage.locator('button[title*="Copy invite code" i]').first();
  const invite = ((await inviteButton.textContent()) ?? "").replace(/invite/i, "").trim();
  expect(invite).toMatch(/^[A-Z0-9]{6}$/);

  // Nail up a notice. Wait for the board itself: the hall also shows the quest
  // title (in its board preview) *and* the Chronicle line announcing it, so
  // asserting on the title before the page settles matches three things.
  await dmPage.getByRole("link", { name: /Open the board/i }).click();
  await expect(dmPage.getByRole("button", { name: "Post a Quest" })).toBeVisible();
  await dmPage.getByRole("button", { name: "Post a Quest" }).click();
  await expect(dmPage.getByRole("heading", { name: "Nail Up a Notice" })).toBeVisible();

  await dmPage.getByPlaceholder("e.g. Rats in the Cellar").fill(questTitle);
  await dmPage
    .getByPlaceholder("What is asked, and what is at stake…")
    .fill("The cellar squeaks. Something down there is bigger than a rat.");
  await dmPage.getByPlaceholder("Bram the Barkeep").fill("Bram the Barkeep");

  // The veil toggle is labelled with its *current* state, not the action it
  // performs — so read it before deciding to click, or you draft the notice
  // you meant to reveal.
  const veil = dmPage.getByRole("button", {
    name: /The party can see this|Drafted — hidden from the party/,
  });
  if (/Drafted/.test((await veil.textContent()) ?? "")) await veil.click();
  await expect(veil).toHaveText(/The party can see this/);

  await dmPage.getByRole("button", { name: "Nail it to the board" }).click();

  // The board card, not the Chronicle line that announces the same title —
  // under load the live update lands before this settles and matches both.
  await expect(dmPage.getByText(questTitle).first()).toBeVisible();

  // --- the player's side ---------------------------------------------------
  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await registerViaUI(playerPage, player);

  await playerPage.getByPlaceholder("Invite code").fill(invite);
  await playerPage.getByRole("button", { name: "Join", exact: true }).click();

  await playerPage.getByText(campaignName, { exact: false }).first().click();
  await playerPage.getByRole("link", { name: /Open the board/i }).click();
  // Land on the board before looking for the notice — on the hall the title
  // also appears in the board preview and in the Chronicle's "A notice is
  // nailed to the board" line, and matching those is not the same claim.
  await expect(playerPage.getByRole("heading", { name: "The Quest Board" })).toBeVisible();

  // The notice the DM revealed is on the player's board too — the card, not
  // the Chronicle line announcing it, which the board also carries.
  const notice = playerPage.getByText(questTitle).first();
  await expect(notice).toBeVisible();

  // And they can take it.
  await playerPage.getByRole("button", { name: /Claim/i }).first().click();
  await expect(playerPage.getByRole("button", { name: /Release|Abandon/i }).first()).toBeVisible();

  await dmCtx.close();
  await playerCtx.close();
});
