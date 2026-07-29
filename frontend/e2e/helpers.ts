import { expect, type Page, type APIRequestContext } from "@playwright/test";

/*
The vocabulary the specs speak.

Two rules keep this suite from becoming the brittle thing everyone warns about:

  1. Every run makes its own users and campaigns, named with a unique suffix.
     Nothing is shared, nothing is cleaned up between runs, and a failed run
     leaves its wreckage behind for inspection instead of poisoning the next.
  2. Setup that is not the thing under test goes through the API, not the UI.
     A test about the encounter tracker should fail when the tracker breaks,
     not when the registration form moves.
*/

/** A suffix unique to this moment — usernames and campaign names must not collide. */
export function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

export interface Account {
  username: string;
  email: string;
  password: string;
}

export function newAccount(prefix = "test"): Account {
  const username = unique(prefix);
  return {
    username,
    email: `${username}@example.test`,
    password: "Correct-Horse-9-Battery",
  };
}

/** Register through the UI — the login gate is part of what we protect. */
export async function registerViaUI(page: Page, account: Account): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Log In" }).first().click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();

  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="new-username"]').fill(account.username);
  await page.locator('input[name="new-password"]').fill(account.password);
  await page.getByRole("button", { name: "Create account & enter" }).click();

  // Registration signs you in and drops you at the board.
  await expect(page).toHaveURL(/\/questboard/, { timeout: 20_000 });
}

/** Sign in through the UI with an account that already exists. */
export async function loginViaUI(page: Page, account: Account): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Log In" }).first().click();
  await page.locator('input[name="username"]').fill(account.username);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
}

/**
 * Register straight against the API. For the setup half of a test — see rule 2
 * above.
 *
 * Pass `page.request`, not the bare `request` fixture: `page.request` shares the
 * browser context's cookie jar, so the session it opens is the one the page is
 * already holding and `page.goto` lands signed in. The `request` fixture keeps
 * its own jar and would leave the page a stranger.
 */
export async function registerViaAPI(
  request: APIRequestContext,
  account: Account,
): Promise<void> {
  const res = await request.post("/api/auth/register", {
    data: {
      email: account.email,
      username: account.username,
      password: account.password,
    },
  });
  expect(res.status(), await res.text()).toBe(204);
}

export interface Campaign {
  id: string;
  name: string;
  inviteCode: string;
}

/**
 * Create a campaign via the API. Returns the whole campaign, because the
 * invite code comes back with it and there is no GET for one — a member joins
 * with the code, so a test that needs a second player needs this object.
 */
export async function createCampaign(
  request: APIRequestContext,
  name: string,
): Promise<Campaign> {
  const res = await request.post("/api/campaigns", { data: { name } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Campaign;
}

/** Walk in with an invite code. */
export async function joinCampaign(
  request: APIRequestContext,
  code: string,
): Promise<void> {
  const res = await request.post("/api/campaigns/join", { data: { code } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Quick-add a table-born hero onto a roster (DM only). */
export async function quickAddHero(
  request: APIRequestContext,
  campaignId: string,
  name: string,
): Promise<string> {
  const res = await request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name, class: "Orc Barbarian", level: 3, hpCurrent: 24, hpMax: 24 },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

/**
 * Wait for the SPA to settle after a mutation. TanStack Query refetches on
 * invalidation, so "the button was clicked" is not "the server agreed".
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}
