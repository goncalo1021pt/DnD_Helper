import { test, expect } from "@playwright/test";
import {
  createCampaign,
  createLocation,
  joinCampaign,
  newAccount,
  postQuest,
  registerViaAPI,
  revealLocation,
  settled,
  unique,
} from "./helpers";

/*
The World — the room the places got in #103, renamed from "Places" in #196.

The issue asked for two things, and only one of them was missing code. The
place tree has always supported reparenting — `PATCH /locations/{id}` checks
for cycles and re-runs the depth cap over the moved subtree, and it is unit
tested. What it did not have was a way in: the "Move inside" select lived
behind an unlabelled eye button, inside a modal, on the quest board. So the
first test drives the *reported* scenario end to end through the UI, because
the gap was never in the endpoint and a test against the endpoint would have
passed on the day the issue was filed.

The rest covers what moving places out of the board is for: players get a
gazetteer of what they have been let in on, and a place links out to the
notices hanging in it.
*/

test("a city charted before its country can be moved into it", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("cartog"));
  const campaign = await createCampaign(page.request, unique("The Wrong Map "));

  // The reported shape exactly: the city exists, the country does not yet, so
  // the city was charted as a realm of its own.
  await createLocation(page.request, campaign.id, "Redwater");
  const bel = await createLocation(page.request, campaign.id, "Kingdom of Bel");

  await page.goto(`/questboard/campaigns/${campaign.id}/world`);
  await expect(page.getByRole("heading", { name: "The World" })).toBeVisible();
  // Located by the row's own control rather than by name: every place name is
  // also an <option> in two parent pickers, so text alone matches three times.
  await expect(page.getByRole("button", { name: "Edit Redwater" })).toBeVisible();

  // Reparenting is reachable from the pencil, where someone looking to edit a
  // place would actually go.
  await page.getByRole("button", { name: "Edit Redwater" }).click();
  await page.getByLabel("Move inside").selectOption(bel);
  await page.getByRole("button", { name: "Save the chart" }).click();
  await settled(page);

  // Reopening reads the server's answer back, not the select we just set: the
  // panel closes on success and the tree is refetched.
  await page.getByRole("button", { name: "Edit Redwater" }).click();
  await expect(page.getByLabel("Move inside")).toHaveValue(bel);
});

test("a place refuses to be moved inside itself", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("cycle"));
  const campaign = await createCampaign(page.request, unique("The Knot "));

  const realm = await createLocation(page.request, campaign.id, "Kingdom of Aur");
  await createLocation(page.request, campaign.id, "Aurhold", realm);

  await page.goto(`/questboard/campaigns/${campaign.id}/world`);
  await page.getByRole("button", { name: "Edit Kingdom of Aur" }).click();

  // The parent picker drops the place being edited, so the only way to ask for
  // a cycle is through its own child — which the server is the one to refuse.
  await page.getByLabel("Move inside").selectOption({ label: "— Aurhold" });
  await page.getByRole("button", { name: "Save the chart" }).click();

  // The rejection reaches the table twice — inline under the form, and through
  // the app-wide mutation notice. Either one is the point; the old modal showed
  // neither, because there was no way to ask for the move in the first place.
  await expect(
    page.getByText("a place cannot be moved inside itself").first(),
  ).toBeVisible();
});

/*
Found while screenshotting this page, which is the only reason it was found:
a script renamed a place and the city silently jumped to the root of the map.

`PATCH /locations/{id}` used to write `parent_id` from the request body, and an
absent field decodes to exactly the same nil as an explicit null — so any body
that did not mention the parent read as "make this a root". A rename detached
the place, everything nested inside it came along, and because the veil resolves
up the ancestor chain, anything down there that was only dark because an
ancestor was veiled became visible to the party. Silent, and it lifts a veil.

The fix is structural rather than careful: the update endpoint cannot touch the
tree at all, and moving is its own call where saying nothing is not a possible
input. This test is at the API rather than through the page because the page was
never the thing that got it wrong — it always sent every field.
*/
test("renaming a place cannot quietly detach it, or lift the veil under it", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, newAccount("dmdetach"));
  const campaign = await createCampaign(dmPage.request, unique("The Quiet Detach "));

  // A revealed city inside a veiled realm: dark to the party only because of
  // what sits above it. This is the state a detach would silently expose.
  const realm = await createLocation(dmPage.request, campaign.id, "Kingdom of Aur");
  const city = await createLocation(dmPage.request, campaign.id, "Redwater", realm);
  await revealLocation(dmPage.request, city);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, newAccount("pldetach"));
  await joinCampaign(plPage.request, campaign.inviteCode);

  const seenByPlayer = async () =>
    ((await (
      await plPage.request.get(`/api/campaigns/${campaign.id}/locations`)
    ).json()) as Array<{ name: string }>).map((l) => l.name);

  expect(await seenByPlayer()).not.toContain("Redwater");

  // A body that says nothing whatsoever about the tree.
  const res = await dmPage.request.patch(`/api/locations/${city}`, {
    data: { name: "Redwater Port", description: "" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  const after = (await res.json()) as { parentId?: string; depth: number };
  expect(after.parentId, "the rename must not have re-hung the place").toBe(realm);
  expect(after.depth).toBe(1);

  // The consequence that made this worth fixing rather than documenting.
  expect(await seenByPlayer()).not.toContain("Redwater Port");

  await dmCtx.close();
  await plCtx.close();
});

test("the description a place has always had can finally be written", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("scribe"));
  const campaign = await createCampaign(page.request, unique("The Gazetteer "));
  await createLocation(page.request, campaign.id, "Saltmarch");

  await page.goto(`/questboard/campaigns/${campaign.id}/world`);
  await page.getByRole("button", { name: "Edit Saltmarch" }).click();
  await page
    .getByLabel("What is known of it")
    .fill("A port of black sand and worse manners.");
  await page.getByRole("button", { name: "Save the chart" }).click();
  await settled(page);

  // `locations.description` was in the schema from the start and no screen ever
  // set it, so it was permanently empty in every campaign.
  await expect(
    page.getByText("A port of black sand and worse manners."),
  ).toBeVisible();
});

test("a place hands the board the notices hanging in it", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("filed"));
  const campaign = await createCampaign(page.request, unique("Two Corners "));

  const north = await createLocation(page.request, campaign.id, "Northreach");
  const south = await createLocation(page.request, campaign.id, "Southreach");
  await postQuest(page.request, campaign.id, "Wolves at the north gate", north);
  await postQuest(page.request, campaign.id, "Smugglers in the south docks", south);

  await page.goto(`/questboard/campaigns/${campaign.id}/world`);

  // The count is a door, not a decoration — that is the whole argument for
  // places being a hub rather than a filing dropdown on the board.
  await page.getByTitle("Open the board filtered to Northreach").click();
  await expect(page).toHaveURL(new RegExp(`/board\\?place=${north}`));
  await expect(page.getByText("Wolves at the north gate")).toBeVisible();
  await expect(page.getByText("Smugglers in the south docks")).toBeHidden();
});

test("the party's gazetteer holds only what the DM has revealed", async ({ browser }) => {
  const dm = newAccount("dmgaz");
  const player = newAccount("plgaz");

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("The Veiled Coast "));

  const known = await createLocation(dmPage.request, campaign.id, "Havenport");
  await createLocation(dmPage.request, campaign.id, "The Drowned Vault");
  await revealLocation(dmPage.request, known);

  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await joinCampaign(plPage.request, campaign.inviteCode);

  await plPage.goto(`/questboard/campaigns/${campaign.id}/world`);
  await expect(plPage.getByText("Havenport")).toBeVisible();
  await expect(plPage.getByText("The Drowned Vault")).toBeHidden();

  // A gazetteer is something you read. The cartographer's table is not on it.
  await expect(plPage.getByPlaceholder("e.g. Lisboa")).toBeHidden();
  await expect(plPage.getByRole("button", { name: "Edit Havenport" })).toBeHidden();

  await dmCtx.close();
  await plCtx.close();
});

/*
The ladder (#196): a place sits under its own parent.

The page indents by depth, so ORDER is what says whose child a row is. The
old ordering sorted by depth and then by name, which banded the list — every
kingdom in the world together, alphabetically across unrelated continents —
and two kingdoms with different parents rendered as adjacent, equally
indented rows under whichever continent happened to sort last.
*/
test("a place is listed under its own parent, not banded with its depth", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("ladder"));
  const campaign = await createCampaign(page.request, unique("Six Faced "));

  // The issue's own world, built out of order on purpose.
  const world = await createLocation(page.request, campaign.id, "6 Faced World");
  const milis = await createLocation(page.request, campaign.id, "Milis Continent", world);
  const human = await createLocation(page.request, campaign.id, "Human Continent", world);
  await createLocation(page.request, campaign.id, "Demon Continent", world);
  // Alphabetically first among the kingdoms, but it belongs to Human.
  await createLocation(page.request, campaign.id, "Asura Kingdom", human);
  await createLocation(page.request, campaign.id, "Holy Milis Empire", milis);

  const order = ((await (
    await page.request.get(`/api/campaigns/${campaign.id}/locations`)
  ).json()) as Array<{ name: string }>).map((l) => l.name);

  expect(order).toEqual([
    "6 Faced World",
    "Demon Continent",
    "Human Continent",
    "Asura Kingdom", // inside Human — and now sitting under it
    "Milis Continent",
    "Holy Milis Empire", // inside Milis
  ]);

  // And that is the order the page draws. Scoped to the row titles: the
  // "Move inside" select lists every place too, and matching those would be
  // asserting the dropdown, not the ladder.
  await page.goto(`/questboard/campaigns/${campaign.id}/world`);
  await expect(page.getByRole("heading", { name: "The World" })).toBeVisible();
  const drawn = await page.locator("span.font-heading.truncate").allTextContents();
  expect(drawn.map((t) => t.trim()).filter((t) => order.includes(t))).toEqual(order);
});

/* A link someone bookmarked when this room was called Places still lands. */
test("the old /places address still finds the world", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("oldlink"));
  const campaign = await createCampaign(page.request, unique("Bookmark "));

  await page.goto(`/questboard/campaigns/${campaign.id}/places`);
  await expect(page.getByRole("heading", { name: "The World" })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaign.id}/world$`));
});

/*
Striking a place must not lift its veil (#238). The FK unpins its notices and
folk (ON DELETE SET NULL), but the place's veil dies with the row — so the
delete first freezes what each viewer could see through that veil onto the
content's own visibility. Dark stays dark, public stays public.
*/
test("deleting a veiled place keeps its notices and folk dark; a public place's stay public", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("veilfrz"));
  const campaign = await createCampaign(dm.request, unique("Frozen Veil "));

  const plCtx = await browser.newContext();
  const pl = await plCtx.newPage();
  await pl.goto("/");
  await registerViaAPI(pl.request, newAccount("veilfrzpl"));
  await joinCampaign(pl.request, campaign.inviteCode);

  // A secret place (veiled by default) with a party-visible notice and a
  // party-visible person filed in it — both dark today only because of it.
  const secret = await createLocation(dm.request, campaign.id, "The Silent Reach");
  const questId = await postQuest(dm.request, campaign.id, "Steal the Whisper-Pearl", secret);
  await dm.request.put(`/api/quests/${questId}/visibility`, {
    data: { scope: "party", visible: true },
  });
  const npcRes = await dm.request.post(`/api/campaigns/${campaign.id}/npcs`, {
    data: { name: "The Silent Broker", locationId: secret },
  });
  expect(npcRes.ok(), await npcRes.text()).toBeTruthy();
  await dm.request.put(`/api/npcs/${(await npcRes.json()).id}/visibility`, {
    data: { scope: "party", visible: true },
  });

  // And a public place with a public notice — the control group.
  const publicLoc = await createLocation(dm.request, campaign.id, "Milltown");
  await revealLocation(dm.request, publicLoc);
  const publicQuest = await postQuest(dm.request, campaign.id, "Rats in the Granary", publicLoc);
  await dm.request.put(`/api/quests/${publicQuest}/visibility`, {
    data: { scope: "party", visible: true },
  });

  const playerQuests = async () =>
    (await (await pl.request.get(`/api/campaigns/${campaign.id}/quests`)).json()) as Array<{
      title: string;
      location?: string | null;
    }>;
  const playerNpcs = async () =>
    (await (await pl.request.get(`/api/campaigns/${campaign.id}/npcs`)).json()) as Array<{
      name: string;
    }>;

  // Before: the player sees only the public notice, and nobody.
  expect((await playerQuests()).map((q) => q.title)).toEqual(["Rats in the Granary"]);
  expect(await playerNpcs()).toEqual([]);

  // Strike both places.
  for (const id of [secret, publicLoc]) {
    const del = await dm.request.delete(`/api/locations/${id}`);
    expect(del.ok(), await del.text()).toBeTruthy();
  }

  // After: exactly the same world. The secret notice did not surface, its
  // title and its place's name never reach the player; the public notice
  // survived its place's death without going dark.
  const after = await playerQuests();
  expect(after.map((q) => q.title)).toEqual(["Rats in the Granary"]);
  const raw = JSON.stringify(after) + JSON.stringify(await playerNpcs());
  expect(raw).not.toContain("Whisper-Pearl");
  expect(raw).not.toContain("Silent Reach");
  expect(raw).not.toContain("Silent Broker");

  // The DM keeps everything, unfiled, each notice remembering where it hung.
  const dmQuests = (await (
    await dm.request.get(`/api/campaigns/${campaign.id}/quests`)
  ).json()) as Array<{ title: string; location?: string | null }>;
  const pearl = dmQuests.find((q) => q.title === "Steal the Whisper-Pearl");
  expect(pearl, "the DM still holds the secret notice").toBeTruthy();
  expect(pearl!.location, "it remembers where it hung").toBe("The Silent Reach");

  await dmCtx.close();
  await plCtx.close();
});
