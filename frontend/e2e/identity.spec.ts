import { expect, test, type Page } from "@playwright/test";
import { newAccount, registerViaAPI, unique } from "./helpers";

/*
One person, one account, however many doors (#269).

Signing in with Google after registering with a password used to make a SECOND
account on the same address — campaigns, heroes and homebrew split across two
identities belonging to one person, with no way to put them back together. The
address was only ever unique among password accounts, because `users` held one
(provider, provider_id) and there was nowhere to hang a second door.

The doors moved to `user_identities`, and the rules are:

  - a door already hung        -> that account, as always
  - a new door, address held
    by an account that PROVED
    it                         -> hang it there; same person, second door
  - a new door, address held
    but never proven           -> refused; an unconfirmed account may be a
                                  squatter, and linking hands it over
  - nobody holds the address   -> a new person

Real OAuth cannot be driven from a browser, so these ride the dev door, which
goes through exactly the same resolution and can carry an address for the
purpose.
*/

/** Sign in through the dev door as a given provider identity. */
async function devLogin(page: Page, opts: { name: string; id?: string; email?: string }) {
  const q = new URLSearchParams({ name: opts.name });
  if (opts.id) q.set("id", opts.id);
  if (opts.email) q.set("email", opts.email);
  await page.goto(`/api/auth/dev/login?${q.toString()}`);
}

async function me(page: Page) {
  const res = await page.request.get("/api/me");
  if (!res.ok()) return null;
  return (await res.json()).user as { id: string; name: string; email?: string };
}

test("a second door onto a proven address is the same account, not a second one", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = `${unique("wanderer")}@example.com`.toLowerCase();

  // First visit: a new person. A provider vouches for the address, so it
  // arrives proven.
  await devLogin(page, { name: "Wanderer", id: unique("door-a-"), email });
  const first = await me(page);
  expect(first?.email).toBe(email);

  // A DIFFERENT door — another provider identity — carrying the same proven
  // address. Before #269 this made a second account.
  await page.request.post("/api/auth/logout");
  await devLogin(page, { name: "Wanderer Elsewhere", id: unique("door-b-"), email });
  const second = await me(page);
  expect(second?.id).toBe(first?.id);

  // Linking must not quietly rewrite who they are, either.
  expect(second?.name).toBe("Wanderer");

  await ctx.close();
});

test("the same door twice is the same account", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const door = unique("returning-");

  await devLogin(page, { name: "Returning", id: door });
  const first = await me(page);
  await page.request.post("/api/auth/logout");
  await devLogin(page, { name: "Returning", id: door });
  expect((await me(page))?.id).toBe(first?.id);

  await ctx.close();
});

test("a password account's address cannot be taken by registering it twice", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  const account = newAccount("holder");
  await registerViaAPI(page.request, account);

  // A second registration on the same address is refused, and told which door
  // to use — "already exists" alone left people stranded at the wrong one.
  const again = await page.request.post("/api/auth/register", {
    data: { email: account.email, username: newAccount("other").username, password: account.password },
  });
  expect(again.status()).toBe(409);
  const body = await again.json();
  expect(body.field).toBe("email");
  expect(body.error).toContain("password");

  await ctx.close();
});

test("an unconfirmed account is not handed to whoever turns up with its address", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");

  // A password account registers an address and never confirms it. Whether
  // this is a squatter or the owner being slow, it is not ours to give away.
  const account = newAccount("unconfirmed");
  await registerViaAPI(page.request, account);
  const registered = await me(page);
  await page.request.post("/api/auth/logout");

  // A provider now vouches for that same address. The sign-in is refused,
  // rather than either creating a second account or handing this one over.
  await devLogin(page, { name: "Claimant", id: unique("claim-"), email: account.email });
  expect(await me(page)).toBeNull();
  await expect(page.getByText(/hasn't been confirmed yet/)).toBeVisible({ timeout: 15_000 });

  // The account it protected is untouched and still signs in.
  const back = await page.request.post("/api/auth/login", {
    data: { identifier: account.username, password: account.password },
  });
  expect(back.status()).toBe(204);
  expect((await me(page))?.id).toBe(registered?.id);

  await ctx.close();
});

test("registering onto an address a provider already holds is refused", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = `${unique("provider")}@example.com`.toLowerCase();

  await devLogin(page, { name: "Provider Person", id: unique("prov-"), email });
  expect((await me(page))?.email).toBe(email);
  await page.request.post("/api/auth/logout");

  // This is the bug as reported: a second account on the address already used
  // to sign in with a provider.
  const attempt = await page.request.post("/api/auth/register", {
    data: { email, username: newAccount("second").username, password: "correct-horse-battery-42" },
  });
  expect(attempt.status()).toBe(409);
  expect((await attempt.json()).field).toBe("email");

  await ctx.close();
});
