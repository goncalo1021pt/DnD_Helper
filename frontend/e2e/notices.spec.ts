import { test, expect } from "@playwright/test";
import { newAccount, registerViaAPI, unique } from "./helpers";

/*
That a failed mutation is heard.

The mechanism is a single handler on the MutationCache, so it cannot sensibly
be tested by breaking one real feature — what matters is the default, and the
opt-out that keeps a good bespoke surface from being shouted over.

Both tests force the failure with `page.route` rather than hunting for a real
one. That is deliberate: a server error is exactly the case nobody can
reproduce on demand, and it is precisely the case that used to vanish.
*/

test("a failed mutation says so, with the server's own words", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("notice"));

  // Break exactly one call, the way a bad moment on the wifi would.
  await page.route("**/api/campaigns", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "The ledger is jammed." }),
    });
  });

  await page.goto("/questboard");
  await page.getByPlaceholder("Name of the campaign").fill(unique("Doomed "));
  await page.getByRole("button", { name: "Found", exact: true }).click();

  // The server's wording reaches the player, rather than a button that stopped.
  const notice = page.getByRole("status").getByText("The ledger is jammed.");
  await expect(notice).toBeVisible({ timeout: 15_000 });

  // And it can be dismissed.
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  await expect(notice).toBeHidden();
});

/*
That a request which never answers stops being a button that never stops (#130).

The report was about the Forge, but the Forge was innocent — its error surface
is correct and simply never fired, because a stalled `fetch` never settles into
an error at all. The deadline that fixes it lives in `api/client.ts` and covers
every call, so this proves it on the cheapest page that shows the same symptom:
a submit button stuck on its pending caption.
*/
test("a request that never answers gives up, and says why", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("stall"));

  // Swallow the call whole: no response, no error, no end. A bad link, exactly.
  let release = () => {};
  await page.route("**/api/campaigns", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise<void>((resolve) => (release = resolve));
    await route.abort().catch(() => {});
  });

  await page.goto("/questboard");
  await page.getByPlaceholder("Name of the campaign").fill(unique("Stalled "));
  await page.getByRole("button", { name: "Found", exact: true }).click();

  // The reported symptom, reproduced: pending caption, button disabled.
  await expect(page.getByRole("button", { name: "Founding…" })).toBeDisabled();

  // Before the deadline, that was the whole story. Now it ends.
  await expect(page.getByRole("status").getByText(/took too long/)).toBeVisible({
    timeout: 40_000,
  });
  await expect(page.getByRole("button", { name: "Found", exact: true })).toBeEnabled();

  release();
});
