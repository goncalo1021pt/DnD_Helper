import { expect, test } from "@playwright/test";
import {
  createCampaign,
  joinCampaign,
  newAccount,
  registerViaAPI,
  unique,
} from "./helpers";

/*
The table, live (#109).

The tracker polled every 8 seconds, so a DM advancing a turn was news to the
players up to 8 seconds later — long enough to be confusing when someone is
sitting there waiting to act.

This asserts the MECHANISM — that the nudge crosses from the DM's request to a
player's open stream — rather than that the player's screen eventually catches
up. The screen catching up proves nothing: TanStack also refetches on window
focus, so a UI assertion here passes with the stream ripped out entirely. I
tried it that way first and it did exactly that.
*/
test("a nudge crosses from the DM's turn to a player's open stream", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmlive"));
  const campaign = await createCampaign(dmPage.request, unique("Live Table "));

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("pllive"));
  await joinCampaign(plPage.request, campaign.inviteCode);
  await plPage.goto(`/questboard/campaigns/${campaign.id}`);

  // A fight with something in it, triggered.
  await dmPage.goto(`/questboard/campaigns/${campaign.id}/encounters`);
  await dmPage.getByPlaceholder("Prepare a new encounter — name it…").fill("The Long Night");
  await dmPage.getByRole("button", { name: "Prepare", exact: true }).click();
  await dmPage.getByPlaceholder("Search monsters…").fill("Goblin Warrior");
  const add = dmPage.getByRole("button", { name: "Add", exact: true }).first();
  await expect(add).toBeEnabled({ timeout: 20_000 });
  await add.click();
  await dmPage.getByRole("button", { name: /Trigger/ }).click();
  await expect(dmPage.getByText(/Round\s*1/i)).toBeVisible({ timeout: 20_000 });

  // The player is listening, in their own browser, with their own session.
  const heard = plPage.evaluate(
    (id) =>
      new Promise<string>((resolve) => {
        const es = new EventSource(`/api/campaigns/${id}/events/stream`);
        es.addEventListener("encounter", () => {
          es.close();
          resolve("encounter");
        });
        setTimeout(() => {
          es.close();
          resolve("nothing arrived");
        }, 10_000);
      }),
    campaign.id,
  );
  // Let the stream settle before causing the thing it should carry.
  await plPage.waitForTimeout(1_000);

  await dmPage.getByRole("button", { name: /Next turn/ }).click();

  expect(await heard, "the DM's turn should reach a player's stream").toBe("encounter");

  await dmCtx.close();
  await plCtx.close();
});

/*
And the stream is a stream: it stays open, and it is a member's to read.
*/
test("the stream is open to members and closed to strangers", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("streamer"));
  const campaign = await createCampaign(page.request, unique("Stream Table "));

  // A member gets an event stream rather than JSON. Read it in the browser and
  // abort the moment the headers land: `request.get` buffers the whole body,
  // and this body is designed never to end.
  const peek = async (p: typeof page, id: string) =>
    p.evaluate(async (url) => {
      const ctrl = new AbortController();
      const res = await fetch(url, { signal: ctrl.signal });
      const out = { status: res.status, type: res.headers.get("content-type") ?? "" };
      ctrl.abort();
      return out;
    }, `/api/campaigns/${id}/events/stream`);

  const open = await peek(page, campaign.id);
  expect(open.status).toBe(200);
  expect(open.type).toContain("text/event-stream");

  // Someone else's table is not readable.
  const outsiderCtx = await page.context().browser()!.newContext();
  const outsider = await outsiderCtx.newPage();
  await outsider.goto("/");
  await registerViaAPI(outsider.request, newAccount("outsider"));
  const refused = await peek(outsider, campaign.id);
  expect(refused.status, "a stranger cannot listen to a table they are not at").toBe(403);
  await outsiderCtx.close();
});
