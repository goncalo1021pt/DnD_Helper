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
  // The nudge is gone once the address is confirmed.
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
