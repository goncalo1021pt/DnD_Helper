import { test, expect, request as playwrightRequest, type APIResponse } from "@playwright/test";
import { newAccount, registerViaAPI } from "./helpers";

/*
Rate limits (#314): a ceiling in front of every door.

A token is a script, and a script with a bug is a loop. What is worth pinning:
the refusal is a 429 that says when to come back, a heavy door (the codex list)
empties the bucket sooner than a cheap one would, the owner is told on the
profile rather than in a log, and a browser doing what browsers do on a page
load never meets any of it.

The numbers are the defaults (60 a minute per token, burst 120; the codex costs
5) — the stack under test runs with no RATE_LIMIT_* set.
*/

test("a token that hammers the codex meets its ceiling, is told when to come back, and wears it on the profile", async ({ page }) => {
  const account = newAccount("loop");
  await registerViaAPI(page.request, account);
  const minted = await page.request.post("/api/me/tokens", {
    data: { name: "the loop", scopes: ["rules:read"], campaignId: null, expiresInDays: 90 },
  });
  expect(minted.status(), await minted.text()).toBe(201);
  const secret = (await minted.json()).secret as string;
  const api = await playwrightRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${secret}` } });

  // Every shelf costs 5 of a 120 burst: the twenty-fifth is refused. A slow
  // run refills a little on the way, so the count is a window, not a number.
  let refused: APIResponse | null = null;
  let passed = 0;
  for (let i = 0; i < 40 && !refused; i++) {
    const res = await api.get("/api/rules/class");
    if (res.status() === 429) {
      refused = res;
    } else {
      expect(res.status(), await res.text()).toBe(200);
      passed++;
    }
  }
  expect(refused, "forty shelves should not fit in one burst").not.toBeNull();
  expect(passed).toBeGreaterThanOrEqual(20);
  expect(passed).toBeLessThanOrEqual(30);

  const retryAfter = Number(refused!.headers()["retry-after"]);
  expect(Number.isInteger(retryAfter) && retryAfter >= 1, `Retry-After ${refused!.headers()["retry-after"]}`).toBeTruthy();
  expect(((await refused!.json()) as { error: string }).error).toContain("try again");
  await api.dispose();

  // The row says so, in words and as a stamp.
  await page.goto("/questboard/profile");
  const row = page.getByTestId("token-row");
  await expect(row).toContainText("hit its ceiling");
  await expect(row.getByText("HIT ITS CEILING", { exact: true })).toBeVisible();
});

test("a browser's page-load burst never meets a ceiling", async ({ page }) => {
  const account = newAccount("burst");
  await registerViaAPI(page.request, account);
  const statuses = await Promise.all(
    Array.from({ length: 60 }, () => page.request.get("/api/me").then((r) => r.status())),
  );
  expect(statuses.every((s) => s === 200), statuses.join(",")).toBeTruthy();
});
