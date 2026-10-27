import { expect, test, type APIRequestContext } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, postQuest, registerViaAPI, unique } from "./helpers";

/*
Putting a chronicle line right, and writing one with line breaks (#411).

Who may do what is the part worth pinning: a DM rewords and strikes the
table's story notes and rulings and strikes any other line; a player rewords
and strikes their own chat; nobody rewords the app's record or another
person's words — and every refusal is a 404. Then that the composer keeps a
line break on a keyboard (Shift+Enter) and on a phone (Enter).
*/

type Line = { id: string; kind: string; message: string; canEdit: boolean; canDelete: boolean; editedAt?: string };

async function feed(request: APIRequestContext, campaignId: string): Promise<Line[]> {
  const res = await request.get(`/api/campaigns/${campaignId}/events?limit=50`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

async function write(request: APIRequestContext, campaignId: string, message: string): Promise<Line> {
  const res = await request.post(`/api/campaigns/${campaignId}/events`, { data: { message } });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

test("a DM curates the chronicle and a player owns their own lines", async ({ browser }) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("chrdm"));
  const campaign = await createCampaign(dm.request, unique("Chronicle "));
  const other = await createCampaign(dm.request, unique("Elsewhere "));

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("chrpl"));
  await joinCampaign(pl.request, campaign.inviteCode!);

  const note = await write(dm.request, campaign.id, "The bridge fell.\n\n\n\nWe swam.");
  // Line breaks are kept; a wall of blank lines is not.
  expect(note.message).toBe("The bridge fell.\n\nWe swam.");
  const chat = await write(pl.request, campaign.id, "did anyone grab the rope");
  await postQuest(dm.request, campaign.id, "Find the rope");
  const appLine = (await feed(dm.request, campaign.id)).find((l) => l.kind === "quest_posted")!;
  expect(appLine, "posting a notice writes a line of its own").toBeTruthy();

  // What each reader is offered, line by line.
  const asPlayer = Object.fromEntries((await feed(pl.request, campaign.id)).map((l) => [l.id, l]));
  expect(asPlayer[note.id]).toMatchObject({ canEdit: false, canDelete: false });
  expect(asPlayer[chat.id]).toMatchObject({ canEdit: true, canDelete: true });
  expect(asPlayer[appLine.id]).toMatchObject({ canEdit: false, canDelete: false });
  const asDM = Object.fromEntries((await feed(dm.request, campaign.id)).map((l) => [l.id, l]));
  expect(asDM[note.id]).toMatchObject({ canEdit: true, canDelete: true });
  expect(asDM[chat.id]).toMatchObject({ canEdit: false, canDelete: true });
  expect(asDM[appLine.id]).toMatchObject({ canEdit: false, canDelete: true });

  const at = (id: string, campaignId = campaign.id) => `/api/events/${id}?campaignId=${campaignId}`;

  // A player rewords their own line, and it says so.
  const reworded = await pl.request.patch(at(chat.id), { data: { message: "did anyone grab the rope?\nI dropped it" } });
  expect(reworded.ok(), await reworded.text()).toBeTruthy();
  expect(await reworded.json()).toMatchObject({ message: "did anyone grab the rope?\nI dropped it" });
  expect((await reworded.json()).editedAt).toBeTruthy();

  // Nobody rewords somebody else's words or the app's record, and every
  // refusal is the 404 of a line that is not there.
  expect((await pl.request.patch(at(note.id), { data: { message: "x" } })).status()).toBe(404);
  expect((await dm.request.patch(at(chat.id), { data: { message: "x" } })).status()).toBe(404);
  expect((await dm.request.patch(at(appLine.id), { data: { message: "x" } })).status()).toBe(404);
  expect((await pl.request.delete(at(note.id))).status()).toBe(404);
  expect((await pl.request.delete(at(appLine.id))).status()).toBe(404);
  // Through another table's lens a line is not there either.
  expect((await dm.request.delete(at(note.id, other.id))).status()).toBe(404);
  // Too long is refused; nothing is a 400.
  expect((await dm.request.patch(at(note.id), { data: { message: "a".repeat(2001) } })).status()).toBe(400);

  // The DM rewords their own note, strikes the player's chat and the app's line.
  expect((await dm.request.patch(at(note.id), { data: { message: "The bridge fell. We swam." } })).ok()).toBeTruthy();
  expect((await dm.request.delete(at(chat.id))).status()).toBe(204);
  expect((await dm.request.delete(at(appLine.id))).status()).toBe(204);
  // Striking a line undoes nothing: the notice is still on the board.
  const quests = await (await dm.request.get(`/api/campaigns/${campaign.id}/quests`)).json();
  expect(quests.map((q: { title: string }) => q.title)).toContain("Find the rope");

  const left = await feed(pl.request, campaign.id);
  expect(left.map((l) => l.id)).toEqual([note.id]);
  expect(left[0].message).toBe("The bridge fell. We swam.");

  await dmCtx.close();
  await plCtx.close();
});

test("the composer keeps line breaks, and a line is reworded and struck in place", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("chrui"));
  const campaign = await createCampaign(page.request, unique("Quill "));
  await page.goto(`/questboard/campaigns/${campaign.id}/chronicle`);

  const box = page.getByLabel("Write in the chronicle");
  await box.click();
  await box.pressSequentially("First line");
  await box.press("Shift+Enter");
  await box.pressSequentially("Second line");
  await box.press("Enter");
  await expect(box).toHaveValue("");

  const line = page.locator("[data-focus-id]").filter({ hasText: "First line" });
  await expect(line).toBeVisible();
  // Two lines on the screen, not one run together.
  const text = await line.locator(".whitespace-pre-wrap").innerText();
  expect(text).toBe("First line\nSecond line");

  await line.getByRole("button", { name: "Line actions" }).click();
  await line.getByRole("button", { name: "Edit" }).click();
  const editor = line.getByLabel("Reword this line");
  await editor.fill("First line, put right");
  await line.getByRole("button", { name: "Save" }).click();
  await expect(line).toContainText("First line, put right");
  await expect(line).toContainText("edited");

  await line.getByRole("button", { name: "Line actions" }).click();
  await line.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("[data-focus-id]").filter({ hasText: "put right" })).toHaveCount(0);
});

test("on a phone Enter starts a new line and the button posts", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("chrphone"));
  const campaign = await createCampaign(page.request, unique("Thumbs "));
  await page.goto(`/questboard/campaigns/${campaign.id}/chronicle`);

  const box = page.getByLabel("Write in the chronicle");
  await box.tap();
  await box.pressSequentially("Top");
  await box.press("Enter");
  await box.pressSequentially("Bottom");
  await expect(box).toHaveValue("Top\nBottom");
  await page.getByRole("button", { name: "Chronicle it" }).tap();
  await expect(box).toHaveValue("");
  const line = page.locator("[data-focus-id]").filter({ hasText: "Top" });
  expect(await line.locator(".whitespace-pre-wrap").innerText()).toBe("Top\nBottom");
  await ctx.close();
});
