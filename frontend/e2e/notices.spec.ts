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
That a request nobody answers still ends.

#130 was reported as "the Forge button thinks forever", but the Forge was only
the loudest victim: no request in the app had a deadline, so a stalled
connection left every mutation pending for as long as the tab was open — the
button disabled, its caption stuck, and nothing to do but reload and lose the
work. The error surfaces were all there and simply never fired, because the
mutation never settled into an error at all.

Founding a campaign stands in for forging a hero: the mechanism is shared
(lib/http.ts) and the button has the same two captions, but it takes one field
rather than a seven-step wizard. And the route is met with *silence* rather
than a refusal, because silence is what a dying connection actually looks like
and is the one failure the app used to have no answer for.
*/
test("a request nobody answers still ends, and says so", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("stall"));

  await page.route("**/api/campaigns", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    // Accepted, then left hanging — well past the client's 20-second budget.
    await new Promise((r) => setTimeout(r, 35_000));
    await route.abort();
  });

  await page.goto("/questboard");
  await page.getByPlaceholder("Name of the campaign").fill(unique("Silent "));
  const found = page.getByRole("button", { name: "Found", exact: true });
  await found.click();
  await expect(page.getByRole("button", { name: "Founding…" })).toBeVisible();

  // Before the deadline existed there was nothing that would ever fire here.
  await expect(page.getByRole("status")).toContainText(/took too long|Could not reach the server/, {
    timeout: 40_000,
  });
  // And the button is a button again, rather than a thing that thinks forever.
  await expect(found).toBeEnabled();
});
