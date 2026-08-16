import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { newAccount, registerViaUI, registerViaAPI, loginViaUI, unique } from "./helpers";
import { totp } from "./totp";

/*
Exploratory QA — the front door: registration, the verify-your-address nudge,
and the second factor. Every assertion doubles as an observation about what a
brand-new player actually meets at the threshold.

Needs E2E_SERVER_LOG pointing at a follow of the server's log (the dev mailer
prints emails there instead of sending them).
*/

type Timing = { action: string; ms: number };

async function timed<T>(sink: Timing[], action: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  const ms = Date.now() - t0;
  sink.push({ action, ms });
  console.log(`TIMING ${action} ${ms}ms`);
  return out;
}

function wireConsole(page: Page, label: string, sink: string[]) {
  page.on("console", (msg) => {
    if (msg.type() === "error") sink.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => sink.push(`[${label}] pageerror: ${err.message}`));
}

function dumpConsole(sink: string[]) {
  for (const line of sink) console.log(`CONSOLE ${line}`);
  if (sink.length === 0) console.log("CONSOLE clean — no errors captured");
}

/** The newest verify-email link the server logged for this address. */
function verifyLinkFor(logPath: string, email: string): string | undefined {
  const log = readFileSync(logPath, "utf8");
  const at = log.lastIndexOf(email);
  if (at === -1) return undefined;
  return log.slice(at).match(/\/verify-email\?token=[^\s"]+/)?.[0];
}

test("register at the door: the nudge shows, the app is open, the link retires it", async ({ page }) => {
  const logPath = process.env.E2E_SERVER_LOG;
  test.skip(!logPath, "set E2E_SERVER_LOG to the server's log file");

  const timings: Timing[] = [];
  const errors: string[] = [];
  wireConsole(page, "newcomer", errors);
  const account = newAccount("xqdoor");
  const campaignName = unique("Door Watch ");

  // A stranger's first paint of the landing page.
  await timed(timings, "landing page load", async () => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Log In" }).first()).toBeVisible();
  });

  await timed(timings, "register via UI", () => registerViaUI(page, account));

  // Fresh in the tavern, unverified: the nudge must be up, with its two actions.
  await expect(page.getByText(/Confirm your email/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend link/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dismiss/i })).toBeVisible();
  await page.screenshot({ path: "exp-shots/auth-door/01-registered-nudge.png", fullPage: true });

  // The nudge is a nudge, not a wall: an unverified account founds a campaign
  // through the UI and it sticks.
  await page.getByPlaceholder("Name of the campaign").fill(campaignName);
  await timed(timings, "found campaign while unverified", async () => {
    await page.getByRole("button", { name: "Found", exact: true }).click();
    await expect(page.getByText(campaignName, { exact: false }).first()).toBeVisible();
  });
  await page.screenshot({ path: "exp-shots/auth-door/02-unverified-can-found.png", fullPage: true });

  // The server logged the confirmation email; fish the link out before pressing
  // Resend, so we hold the original token.
  await expect
    .poll(() => verifyLinkFor(logPath!, account.email) !== undefined, { timeout: 10_000 })
    .toBe(true);
  const firstLink = verifyLinkFor(logPath!, account.email)!;

  // Resend gives feedback rather than silence.
  await page.getByRole("button", { name: /Resend link/i }).click();
  await expect(page.getByText(/Sent — check your inbox/i)).toBeVisible();
  await page.screenshot({ path: "exp-shots/auth-door/03-resend-feedback.png", fullPage: true });

  // A mail client opens the link in its own tab while the tavern stays open here.
  const mailTab = await page.context().newPage();
  wireConsole(mailTab, "mail-tab", errors);
  await timed(timings, "verify-email page load", async () => {
    await mailTab.goto(firstLink);
    await expect(mailTab.getByText(/confirmed/i)).toBeVisible({ timeout: 15_000 });
  });
  await mailTab.screenshot({ path: "exp-shots/auth-door/04-email-confirmed.png", fullPage: true });

  // Walking back in from the confirmation page: no nudge, no reload needed.
  await mailTab.getByRole("link", { name: /Enter the Tavern/i }).click();
  await expect(mailTab).toHaveURL(/\/questboard/);
  await expect(mailTab.getByText(/Confirm your email/i)).toBeHidden();

  // #226: the tab that was open the whole time must hear about it too — the
  // banner (currently in its "Sent —" state) has to leave without a reload.
  await timed(timings, "original tab drops the nudge (cross-tab)", async () => {
    await expect(page.getByText(/check your inbox/i)).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(/Confirm your email/i)).toBeHidden();
  });
  await mailTab.close();
  await page.screenshot({ path: "exp-shots/auth-door/05-nudge-gone-same-tab.png", fullPage: true });

  // And it stays gone across a fresh load.
  await page.goto("/questboard");
  await expect(page.getByText(campaignName, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Confirm your email/i)).toBeHidden();

  dumpConsole(errors);
});

test("re-opening a spent confirmation link: what the second click actually says", async ({ page }) => {
  const logPath = process.env.E2E_SERVER_LOG;
  test.skip(!logPath, "set E2E_SERVER_LOG to the server's log file");

  const errors: string[] = [];
  wireConsole(page, "second-click", errors);
  const account = newAccount("xqspent");
  await registerViaAPI(page.request, account);

  await expect
    .poll(() => verifyLinkFor(logPath!, account.email) !== undefined, { timeout: 10_000 })
    .toBe(true);
  const link = verifyLinkFor(logPath!, account.email)!;

  // First click confirms (spending the token).
  const token = decodeURIComponent(link.split("token=")[1]);
  const first = await page.request.post("/api/auth/verify-email", { data: { token } });
  expect(first.status()).toBe(204);

  // Second click — the other device, or the same mail twice. The address IS
  // verified; observe what the page tells this player.
  await page.goto(link);
  const failText = page.getByText(/invalid or has expired/i);
  const okText = page.getByText(/Your email is confirmed/i);
  await expect(failText.or(okText)).toBeVisible({ timeout: 15_000 });
  console.log(`OBS second click of a spent link shows: ${
    (await okText.isVisible()) ? "confirmed (good)" : "'invalid or has expired' (misleading — the address is verified)"
  }`);
  await page.screenshot({ path: "exp-shots/auth-door/14-spent-link-second-click.png", fullPage: true });

  dumpConsole(errors);
});

test("a wrong password is refused with a clear message, and the right one still opens the door", async ({ page }) => {
  const timings: Timing[] = [];
  const errors: string[] = [];
  wireConsole(page, "returning", errors);
  const account = newAccount("xqpwd");
  await registerViaAPI(page.request, account);
  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();

  await loginViaUI(page, { ...account, password: "Not-The-Right-One-7" });
  // The server deliberately answers the same for a missing account and a wrong
  // password; a shared-IP burst can also trip the limiter — say which we saw.
  const refusal = page.getByText(/Invalid username or password|Too many attempts/i);
  await expect(refusal).toBeVisible();
  console.log(`OBS refusal message: ${(await refusal.textContent())?.trim()}`);
  await page.screenshot({ path: "exp-shots/auth-door/06-wrong-password.png", fullPage: true });

  // Same form, right password: in.
  await page.locator('input[name="password"]').fill(account.password);
  await timed(timings, "sign in (password only)", async () => {
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
    await expect(page).toHaveURL(/\/questboard/, { timeout: 20_000 });
  });

  dumpConsole(errors);
});

test("2FA enrolled through the profile is demanded at the door: wrong code refused, right code admits", async ({ page }) => {
  const timings: Timing[] = [];
  const errors: string[] = [];
  wireConsole(page, "enrollee", errors);
  const account = newAccount("xq2fa");
  await registerViaAPI(page.request, account);

  await timed(timings, "profile page load", async () => {
    await page.goto("/questboard/profile");
    await expect(page.getByText(/Two-factor authentication/i)).toBeVisible();
  });
  await page.screenshot({ path: "exp-shots/auth-door/07-profile-settings.png", fullPage: true });

  // Enrol the way a player would: modal, QR, hand-typed key, 6-digit code.
  await page.getByRole("button", { name: "Enable 2FA" }).click();
  await expect(page.getByAltText("2FA QR code")).toBeVisible({ timeout: 15_000 });
  const secret = ((await page.getByText(/^[A-Z2-7]{16,}$/).textContent()) ?? "").trim();
  expect(secret, "the hand-entry key should be shown beside the QR").toBeTruthy();
  await page.screenshot({ path: "exp-shots/auth-door/08-enroll-qr.png", fullPage: true });

  await page.locator('input[inputmode="numeric"]').fill(totp(secret));
  await timed(timings, "confirm enrolment code", async () => {
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText(/Save your recovery codes/i)).toBeVisible({ timeout: 15_000 });
  });

  // The recovery codes are the only copy the player will ever get — count them.
  const recoveryCodes = (await page.getByText(/^[0-9a-f]{4}-[0-9a-f]{4}$/).allTextContents()).map((c) => c.trim());
  console.log(`OBS recovery codes shown: ${recoveryCodes.length}`);
  expect(recoveryCodes.length, "recovery codes should be displayed").toBeGreaterThan(0);
  await page.screenshot({ path: "exp-shots/auth-door/09-recovery-codes.png", fullPage: true });
  await page.getByRole("button", { name: /I've saved them/i }).click();

  // The profile now says it is on.
  await expect(page.getByText(/You'll enter a code from your authenticator/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn off" })).toBeVisible();
  await page.screenshot({ path: "exp-shots/auth-door/10-2fa-on.png", fullPage: true });

  // Out, cookies gone — now the door.
  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();

  await loginViaUI(page, account);
  const codeField = page.locator('input[inputmode="numeric"]');
  await timed(timings, "password accepted -> code demanded", async () => {
    await expect(codeField).toBeVisible({ timeout: 15_000 });
  });
  await expect(page.getByText(/Enter the 6-digit code/i)).toBeVisible();
  await page.screenshot({ path: "exp-shots/auth-door/11-code-demanded.png", fullPage: true });

  // A wrong code is refused, and says so.
  const wrong = totp(secret) === "000000" ? "111111" : "000000";
  await codeField.fill(wrong);
  await page.getByRole("button", { name: /Verify & enter/i }).click();
  await expect(page.getByText(/didn't match/i)).toBeVisible();
  await expect(page).not.toHaveURL(/\/questboard/);
  await page.screenshot({ path: "exp-shots/auth-door/12-wrong-code-refused.png", fullPage: true });

  // The right code admits. One retry in case we straddle a 30s TOTP boundary.
  await timed(timings, "verify right code", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await codeField.fill(totp(secret));
      await page.getByRole("button", { name: /Verify & enter/i }).click();
      try {
        await expect(page).toHaveURL(/\/questboard/, { timeout: 8_000 });
        return;
      } catch {
        if (attempt === 1) throw new Error("right TOTP code did not admit after two attempts");
      }
    }
  });
  await page.screenshot({ path: "exp-shots/auth-door/13-admitted.png", fullPage: true });

  // Bonus door: a recovery code also works, once.
  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();
  await loginViaUI(page, account);
  await expect(codeField).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Use a recovery code/i }).click();
  await page.locator('input[autocomplete="one-time-code"]').fill(recoveryCodes[0]);
  await timed(timings, "verify recovery code", async () => {
    await page.getByRole("button", { name: /Verify & enter/i }).click();
    await expect(page).toHaveURL(/\/questboard/, { timeout: 15_000 });
  });

  dumpConsole(errors);
});
