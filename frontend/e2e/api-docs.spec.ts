import { test, expect } from "@playwright/test";
import { newAccount, registerViaAPI } from "./helpers";

/*
The API documents itself (#348). The contract the server runs is served at
/api/openapi.json and .yaml, and every operation in it opens with the scope a
token needs — written at serve time from the same declaration the gate reads.
What is worth pinning is that no operation is silent, and that the two kinds
read as they should. /api/docs is one page reading it, with no session. The
profile links there, and a freshly minted token comes with a curl to paste.
*/

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

test("the contract is served, and every operation says what a token needs", async ({ request }) => {
  const res = await request.get("/api/openapi.json");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const spec = await res.json();
  expect(spec.openapi).toMatch(/^3\./);

  // The guide rides in the description — its sections, not its title.
  expect(spec.info.description).toContain("## Minting a token");
  expect(spec.info.description).not.toMatch(/^# The API/);

  // A token door names its scope; a session-only door says so; none is silent.
  expect(spec.paths["/campaigns/{campaignId}/quests"].post.description).toMatch(
    /^\*\*Token scope:\*\* `campaigns:run`/,
  );
  expect(spec.paths["/me/tokens"].post.description).toMatch(/^\*\*Session only\*\*/);
  let counted = 0;
  const paths = spec.paths as Record<string, Record<string, { description?: string } | undefined>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      counted++;
      expect(op.description ?? "", `${method.toUpperCase()} ${path}`).toMatch(
        /^\*\*(Token scope:|Session only)\*\*/,
      );
    }
  }
  expect(counted).toBeGreaterThan(150);

  const yaml = await request.get("/api/openapi.yaml");
  expect(yaml.status()).toBe(200);
  expect(yaml.headers()["content-type"]).toContain("yaml");
  expect(await yaml.text()).toContain("openapi: 3.");
});

test("the reference page renders the guide and the doors, with no session", async ({ page }) => {
  await page.goto("/api/docs");
  await expect(page).toHaveTitle(/The API/);
  // RapiDoc draws inside a shadow root; Playwright's locators see through it.
  // The guide is the landing page; a door opens on the right when chosen.
  await expect(page.getByText("Minting a token").last()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("/me/export").first()).toBeVisible();
  await page.goto("/api/docs#get-/me/export");
  await expect(page.getByText("Token scope:").first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("account:read", { exact: true }).first()).toBeVisible();
});

test("the profile points there, and a minted token comes with a curl to paste", async ({ page }) => {
  await registerViaAPI(page.request, newAccount("docs"));
  await page.goto("/questboard/profile");
  await expect(page.getByRole("link", { name: "How to use a token" })).toHaveAttribute("href", "/api/docs");

  await page.getByRole("button", { name: "New token" }).click();
  await page.locator('input[name="token-name"]').fill("the docs reader");
  await page.getByRole("button", { name: "Create token" }).click();
  const secret = (await page.getByTestId("token-secret").textContent())?.trim();
  expect(secret).toMatch(/^qb_/);
  // The dialog's defaults are rules and heroes, read only — so the curl aims at
  // a door those open, never at /me, which is account:read.
  await expect(page.getByTestId("token-curl")).toHaveText(
    `curl -H "Authorization: Bearer ${secret}" ${new URL(page.url()).origin}/api/me/characters`,
  );
});
