import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { newAccount, registerViaUI, loginViaUI, registerViaAPI } from "./helpers";
import { totp } from "./totp";

/*
The front door: registration, the email nudge, and the second factor.

This is the one journey where a regression locks real people out of their own
table, so it is worth driving through the UI rather than trusting the handlers'
unit tests.
*/

/*
The front door gives up too (#130).

`notices.spec` proves the deadline through the typed client. This is the other
transport: `/api/auth/*` is hand-rolled and sits outside the OpenAPI surface, so
the whole sign-in flow reaches the network through `apiFetch` directly rather
than through `api.POST`. It is worth its own test because it is the one place
where the deadline landing in `api/client.ts` instead of `lib/http.ts` would
have looked entirely fixed and left the bug in place.

And it is the first screen anyone sees. `LandingPage.submit` has always had the
right catch — "Could not reach the tavern" — and it never ran, because a stalled
fetch never rejects. The button just sat at "…" for as long as the tab was open.
*/
test("a sign-in that never answers gives up rather than sitting at '…'", async ({ page }) => {
  // No account needed: the request is swallowed before it reaches the server,
  // so what these credentials say is beside the point.
  await page.route("**/api/auth/login", async (route) => {
    // Accepted, then met with silence — well past the client's budget.
    await new Promise((r) => setTimeout(r, 35_000));
    await route.abort();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Log In" }).first().click();
  await page.locator('input[name="username"]').fill("nobody");
  await page.locator('input[name="password"]').fill("does-not-matter");
  const signIn = page.getByRole("button", { name: "Sign in", exact: true }).last();
  await signIn.click();

  // The reported symptom, reproduced: the button reads "…" and is disabled.
  await expect(page.getByRole("button", { name: "…", exact: true })).toBeDisabled();

  // Now the catch that was always there finally runs.
  await expect(page.getByText(/Could not reach the tavern/i)).toBeVisible({ timeout: 40_000 });
  await expect(signIn).toBeEnabled();
});

test("a new account enters unverified and is nudged to confirm", async ({ page }) => {
  const account = newAccount("verify");
  await registerViaUI(page, account);

  // Registration signs you in immediately — verification is a nudge, not a gate.
  await expect(page.getByText(/Confirm your email/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend link/i })).toBeVisible();

  // The nudge can be dismissed and stays dismissed for the visit.
  await page.getByRole("button", { name: /Dismiss/i }).click();
  await expect(page.getByText(/Confirm your email/i)).toBeHidden();
});

/*
Confirming for real needs the link, which only exists in the message the server
sent. With no Resend key configured the server logs it instead (logMailer), so
when the harness tells us where that log is, we can follow it exactly as a
player would.
*/
test("the emailed link verifies the address", async ({ page }) => {
  const logPath = process.env.E2E_SERVER_LOG;
  test.skip(
    !logPath,
    "set E2E_SERVER_LOG to the server's log file to follow the verification link",
  );

  const account = newAccount("link");
  await registerViaUI(page, account);
  await expect(page.getByText(/Confirm your email/i)).toBeVisible();

  // The most recent verify-email link in the log is ours — accounts are unique
  // per run, so match on this address rather than taking the last line blind.
  await expect
    .poll(() => readFileSync(logPath!, "utf8").includes(account.email), {
      timeout: 10_000,
    })
    .toBe(true);
  const log = readFileSync(logPath!, "utf8");
  const afterAddress = log.slice(log.lastIndexOf(account.email));
  const link = afterAddress.match(/\/verify-email\?token=[^\s"]+/)?.[0];
  expect(link, "no verification link was logged").toBeTruthy();

  await page.goto(link!);

  // Walking in from the confirmation page is a client-side link, so the nudge
  // has to be gone without a reload — reloading was the workaround in #224, not
  // the fix.
  await page.getByRole("link", { name: /Enter the Tavern/i }).click();
  await expect(page).toHaveURL(/\/questboard/);
  await expect(page.getByText(/Confirm your email/i)).toBeHidden();

  // And it stays gone across a fresh load.
  await page.goto("/questboard");
  await expect(page.getByText(/Confirm your email/i)).toBeHidden();
});

test("2FA, once enrolled, is demanded at the door", async ({ page }) => {
  const account = newAccount("twofa");
  await registerViaAPI(page.request, account);

  // Enrol through the API — the enrolment UI is not what this test protects.
  const setup = await page.request.post("/api/auth/2fa/setup");
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const { secret } = (await setup.json()) as { secret: string };
  expect(secret).toBeTruthy();

  const enable = await page.request.post("/api/auth/2fa/enable", {
    data: { code: totp(secret) },
  });
  expect(enable.ok(), await enable.text()).toBeTruthy();

  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();

  // The password alone is no longer enough.
  await loginViaUI(page, account);
  const codeField = page.locator('input[inputmode="numeric"], input[name*="code" i]').first();
  await expect(codeField).toBeVisible({ timeout: 15_000 });

  await codeField.fill(totp(secret));
  await page.getByRole("button", { name: /Verify|Confirm|Continue|Enter/i }).last().click();

  await expect(page).toHaveURL(/\/questboard/, { timeout: 20_000 });
});
