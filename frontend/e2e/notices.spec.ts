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
