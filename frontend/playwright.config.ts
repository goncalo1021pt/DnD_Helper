import { defineConfig, devices } from "@playwright/test";

/*
End-to-end smoke tests (docs/VISION.md post-v1 item 1, issue #105).

These drive the real stack — Go server, embedded SPA, Postgres — rather than a
mocked frontend, because their job is to be the safety net under the frontend
refactor (#107, #108). A test that mocks the API cannot tell you that splitting
hooks.ts broke the wiring between them.

The app is started separately, not by Playwright, so the same specs run against
a container stack locally (`make test && make e2e`) and against a binary in CI.
Point them anywhere with E2E_BASE_URL.

Dev login is NOT used: these register real local accounts, because the login
gate is part of what we are protecting.
*/
export default defineConfig({
  testDir: "./e2e",
  // The journeys share one Postgres. They create their own users and campaigns
  // and never read each other's, but serial keeps failure output legible and
  // the table's invite codes uncontended.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // The tavern is a desktop-first board; the phone layout is its own concern.
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium" }],
});
