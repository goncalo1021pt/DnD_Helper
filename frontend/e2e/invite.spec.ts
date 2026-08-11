import { test, expect } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  registerViaAPI,
  settled,
  unique,
} from "./helpers";

/*
The invite code, and who is allowed to hold it (#207).

The reported problem was that the code was too easy to leak and too easy to
change by accident. Underneath it was worse than either: the code shipped in
every member's `GET /campaigns`, so a player could read their table's code out
of the payload and pass it on — after being kicked, or after being banned. The
UI drew it for the DM alone, which reads as safe and is not.

So the first test here is the one that matters, and it is deliberately an API
test: the leak was never visible on screen, and a test that only drove the UI
would have passed on the day the issue was filed.
*/

/** Every campaign this account is a member of, as the API hands them over. */
async function membershipsOf(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get("/api/campaigns");
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Array<{
    campaign: { id: string; name: string; inviteCode?: string };
    role: string;
  }>;
}

test("a player never receives the invite code, however they got in", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dminv"));
  const campaign = await createCampaign(dmPage.request, unique("The Open Door "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("plinv"));

  // The join response itself: they walked in holding the code, which is not a
  // reason to hand them a copy to keep.
  const joined = await plPage.request.post("/api/campaigns/join", {
    data: { code: campaign.inviteCode },
  });
  expect(joined.ok(), await joined.text()).toBeTruthy();
  const joinBody = (await joined.json()) as { campaign: { inviteCode?: string } };
  expect(joinBody.campaign.inviteCode, "the join response must not echo the code").toBeUndefined();

  // And the listing they poll from then on.
  const theirs = await membershipsOf(plPage.request);
  expect(theirs).toHaveLength(1);
  expect(theirs[0].role).toBe("player");
  expect(
    theirs[0].campaign.inviteCode,
    "a player's campaign listing must not carry the code that admits anyone",
  ).toBeUndefined();

  // The DM still has it — this is a withheld field, not a broken one.
  const dms = await membershipsOf(dmPage.request);
  expect(dms[0].campaign.inviteCode).toBe(campaign.inviteCode);

  await dmCtx.close();
  await plCtx.close();
});

test("a banned player cannot pass on a code they were never given", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmban"));
  const campaign = await createCampaign(dmPage.request, unique("The Barred Door "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  const player = newAccount("plban");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);

  const members = (await (
    await dmPage.request.get(`/api/campaigns/${campaign.id}/members`)
  ).json()) as Array<{ userId: string; name: string }>;
  const them = members.find((m) => m.name === player.username);
  expect(them, "the player should be on the roster").toBeTruthy();

  const banned = await dmPage.request.post(`/api/campaigns/${campaign.id}/bans`, {
    data: { userId: them!.userId },
  });
  expect(banned.ok(), await banned.text()).toBeTruthy();

  // The point of the ban: they are out, and they are not still holding the key.
  const theirs = await membershipsOf(plPage.request);
  expect(theirs.some((m) => m.campaign.id === campaign.id)).toBeFalsy();

  await dmCtx.close();
  await plCtx.close();
});

test("the header opens the invite rather than displaying it", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmhdr"));
  const campaign = await createCampaign(page.request, unique("The Quiet Header "));

  await page.goto(`/questboard/campaigns/${campaign.id}`);
  await expect(page.getByRole("button", { name: "Invite" })).toBeVisible();

  // The code is nowhere on the page until someone asks — this is the whole
  // point: the header rides along in every screenshot and screen-share.
  await expect(page.getByText(campaign.inviteCode, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog");

  // Still hidden inside the modal, and copyable without ever revealing it.
  await expect(dialog.getByText("••••••")).toBeVisible();
  await expect(dialog.getByText(campaign.inviteCode, { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Copy" })).toBeVisible();

  await dialog.getByRole("button", { name: "Reveal it" }).click();
  await expect(dialog.getByText(campaign.inviteCode, { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Hide it" }).click();
  await expect(dialog.getByText(campaign.inviteCode, { exact: true })).toHaveCount(0);
});

test("forging a new code asks first, and one mis-tap cannot do it", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("dmforge"));
  const campaign = await createCampaign(page.request, unique("The Changed Lock "));

  await page.goto(`/questboard/campaigns/${campaign.id}`);
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog");

  // The first press only asks. The old code still works at this point — which
  // is the bug: it used to be one unguarded tap from locking the table out.
  await dialog.getByRole("button", { name: "Forge a new code" }).click();
  await expect(dialog.getByText(/The old one stops working at once/)).toBeVisible();

  const stillListed = (await (await page.request.get("/api/campaigns")).json()) as Array<{
    campaign: { id: string; inviteCode?: string };
  }>;
  expect(
    stillListed.find((m) => m.campaign.id === campaign.id)!.campaign.inviteCode,
    "asking must not already have changed it",
  ).toBe(campaign.inviteCode);

  // Backing out leaves it alone.
  await dialog.getByRole("button", { name: "Keep this one" }).click();
  await expect(dialog.getByText(/The old one stops working at once/)).toHaveCount(0);

  // Going through with it forges a new one and shows it, since the DM asked
  // for it and has to hand it out.
  await dialog.getByRole("button", { name: "Forge a new code" }).click();
  await dialog.getByRole("button", { name: "Forge a new code" }).click();
  await settled(page);

  await expect(dialog.getByText(campaign.inviteCode, { exact: true })).toHaveCount(0);
  const fresh = ((await dialog.getByText(/^[A-Z0-9]{6}$/).textContent()) ?? "").trim();
  expect(fresh).toMatch(/^[A-Z0-9]{6}$/);
  expect(fresh).not.toBe(campaign.inviteCode);

  // And the old code no longer opens the door.
  const stale = await page.request.post("/api/campaigns/join", {
    data: { code: campaign.inviteCode },
  });
  expect(stale.status(), "the retired code should admit nobody").toBe(404);
});
