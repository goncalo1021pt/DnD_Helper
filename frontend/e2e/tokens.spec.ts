import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createCampaign, forgeHero, newAccount, registerViaAPI, seatHero, unique } from "./helpers";

/*
API tokens (#294): the doors a script or an assistant walks through as you.

What is worth pinning is the shape of the refusals, because a token is a
credential handed to something that is not you. A token holds only the scopes
it was minted with (a 403 that names the missing one), a token minted for one
table sees the tavern from that seat alone, a token can never mint another,
and a revoked token is refused on the spot — 401, whatever else rode along.
*/

async function bearer(secret: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${secret}` } });
}

async function mint(
  request: APIRequestContext,
  input: { name: string; scopes: string[]; campaignId?: string | null; expiresInDays?: number },
): Promise<{ secret: string; id: string }> {
  const res = await request.post("/api/me/tokens", {
    data: { expiresInDays: 90, campaignId: null, ...input },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { secret: body.secret as string, id: body.token.id as string };
}

test("mint on the profile, the secret opens the doors it names and no other, revoke shuts it", async ({ page }) => {
  const account = newAccount("keys");
  await registerViaAPI(page.request, account);

  await page.goto("/questboard/profile");
  await expect(page.getByText("No tokens yet.")).toBeVisible();

  // Mint with the defaults: rules and heroes, read only, every table, 90 days.
  await page.getByRole("button", { name: "New token" }).click();
  await page.locator('input[name="token-name"]').fill("the assistant");
  await expect(page.getByRole("radio", { name: "Read" }).first()).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('select[name="token-expiry"]')).toHaveValue("90");
  await page.getByRole("button", { name: "Create token" }).click();

  const secret = (await page.getByTestId("token-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^qb_[A-Za-z0-9_-]{43}$/);
  await page.getByRole("button", { name: "I've saved it" }).click();

  // The row: name, the prefix only, the scopes, the expiry.
  const row = page.getByTestId("token-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("the assistant");
  await expect(row).toContainText(secret.slice(0, 11) + "…");
  await expect(row).not.toContainText(secret.slice(11));
  await expect(row).toContainText("rules:read");
  await expect(row).toContainText("heroes:read");
  await expect(row).toContainText("at every table you sit at");
  await expect(row).toContainText("expires");

  // As a bearer, with no cookie at all.
  const api = await bearer(secret);
  const classes = await api.get("/api/rules/class");
  expect(classes.status(), await classes.text()).toBe(200);
  expect((await classes.json()).length).toBeGreaterThan(0);
  const heroes = await api.get("/api/me/characters");
  expect(heroes.status(), await heroes.text()).toBe(200);

  // A door it was not minted for: 403, and told which scope it lacks.
  const me = await api.get("/api/me");
  expect(me.status()).toBe(403);
  expect((await me.json()).error).toContain("account:read");
  // A read scope opens no write.
  const write = await api.post("/api/me/characters/forge", { data: {} });
  expect(write.status()).toBe(403);
  expect((await write.json()).error).toContain("heroes:write");

  // A token can never mint, list or revoke tokens: session-only.
  for (const attempt of [api.get("/api/me/tokens"), api.post("/api/me/tokens", { data: { name: "x", scopes: ["rules:read"], expiresInDays: 0 } })]) {
    const res = await attempt;
    expect(res.status()).toBe(403);
  }

  // Revoke from the profile.
  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).last().click();
  await expect(page.getByText("No tokens yet.")).toBeVisible();

  const after = await api.get("/api/rules/class");
  expect(after.status()).toBe(401);
  expect(after.headers()["www-authenticate"]).toContain("Bearer");
  await api.dispose();

  // A secret nobody minted, and one that is not ours at all.
  const stranger = await bearer("qb_" + "A".repeat(43));
  expect((await stranger.get("/api/rules/class")).status()).toBe(401);
  await stranger.dispose();
  const other = await bearer("sk_live_nothing");
  expect((await other.get("/api/rules/class")).status()).toBe(401);
  await other.dispose();
});

test("a token tied to one table sees the tavern from that seat alone", async ({ page }) => {
  const account = newAccount("seat");
  await registerViaAPI(page.request, account);
  const home = await createCampaign(page.request, unique("Home "));
  const away = await createCampaign(page.request, unique("Away "));

  const seated = await forgeHero(page.request, {
    name: unique("Seated "),
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });
  await seatHero(page.request, seated, away.id);
  const shelf = await forgeHero(page.request, {
    name: unique("Shelf "),
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });

  const { secret } = await mint(page.request, {
    name: "home only",
    // Own, so founding and joining pass the scope gate and it is the seat
    // that refuses them.
    scopes: ["account:read", "campaigns:own", "heroes:read"],
    campaignId: home.id,
  });
  const api = await bearer(secret);

  // /me lists the one table.
  const me = await api.get("/api/me");
  expect(me.status(), await me.text()).toBe(200);
  const tables = ((await me.json()).campaigns as Array<{ campaign: { id: string } }>).map((m) => m.campaign.id);
  expect(tables).toEqual([home.id]);

  // Its own table opens, the other is refused as it would be to a stranger.
  expect((await api.get(`/api/campaigns/${home.id}/quests`)).status()).toBe(200);
  expect((await api.get(`/api/campaigns/${away.id}/quests`)).status()).toBe(403);

  // A hero on the shelf is readable, one seated elsewhere is not there at all.
  const heroes = await api.get("/api/me/characters");
  expect(heroes.status(), await heroes.text()).toBe(200);
  const ids = ((await heroes.json()) as Array<{ id: string }>).map((h) => h.id);
  expect(ids).toContain(shelf);
  expect(ids).not.toContain(seated);
  expect((await api.get(`/api/characters/${shelf}`)).status()).toBe(200);
  expect((await api.get(`/api/characters/${seated}`)).status()).toBe(403);

  // It was told where it lives: no founding, no joining.
  expect((await api.post("/api/campaigns", { data: { name: "Elsewhere" } })).status()).toBe(403);
  expect((await api.post("/api/campaigns/join", { data: { code: "ABCDEF" } })).status()).toBe(403);
  await api.dispose();

  // The row says so.
  await page.goto("/questboard/profile");
  await expect(page.getByTestId("token-row")).toContainText(`at ${home.name} only`);
});

test("a wide token reaches every table, and a session is never gated", async ({ page }) => {
  const account = newAccount("wide");
  await registerViaAPI(page.request, account);
  const one = await createCampaign(page.request, unique("One "));
  const two = await createCampaign(page.request, unique("Two "));

  const { secret } = await mint(page.request, { name: "everywhere", scopes: ["campaigns:read"], expiresInDays: 0 });
  const api = await bearer(secret);
  expect((await api.get(`/api/campaigns/${one.id}/quests`)).status()).toBe(200);
  expect((await api.get(`/api/campaigns/${two.id}/quests`)).status()).toBe(200);
  await api.dispose();

  // The browser's own session holds every scope: the gate never meets it.
  expect((await page.request.get("/api/me/tokens")).status()).toBe(200);
  const listed = (await (await page.request.get("/api/me/tokens")).json()) as Array<{ name: string; expiresAt?: string }>;
  expect(listed.map((t) => t.name)).toEqual(["everywhere"]);
  expect(listed[0].expiresAt).toBeUndefined();

  // A table nobody sits at cannot be named on a token.
  const stranger = newAccount("stranger");
  const ctx = await playwrightRequest.newContext();
  await registerViaAPI(ctx, stranger);
  const theirs = await createCampaign(ctx, unique("Theirs "));
  await ctx.dispose();
  const refused = await page.request.post("/api/me/tokens", {
    data: { name: "not mine", scopes: ["campaigns:read"], campaignId: theirs.id, expiresInDays: 90 },
  });
  expect(refused.status()).toBe(404);
});
