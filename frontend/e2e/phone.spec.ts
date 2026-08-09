import { test, expect, devices, type Page } from "@playwright/test";
import { createCampaign, forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
Nothing scrolls sideways on a phone.

The app is used at a table, which means it is used on phones, and the Playwright
config is desktop-only by design — journeys are about behaviour, not width. This
is the one thing worth checking at phone size, because it is the failure that
makes a page unusable rather than ugly: one element wider than the viewport and
the whole document scrolls, so every tap lands slightly wrong.

Both pages here earned it. The places table (#149) packs a name, a description,
counts, a chip and three buttons into one row; the hero sheet (#129) grew a
twenty-row class table. Both were shipped untested at this width.
*/

/*
The browser is pinned, and that is not a detail.

A device descriptor carries `defaultBrowserType`, and every phone in that list
says "webkit" — so spreading one silently moves the whole file off the project's
browser. CI installs chromium and nothing else (`playwright install ... chromium`),
so this file passed locally, where the Playwright image ships all three, and
could only ever fail on CI:

    browserType.launch: Executable doesn't exist at .../webkit-2336/pw_run.sh

Naming the browser keeps the descriptor to what it is wanted for — the viewport,
the touch flags, the user agent — and takes the browser choice back.
*/
test.use({ ...devices["iPhone 13"], browserName: "chromium" });

/** How far past the right edge of the window anything reaches. */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("the places page fits a phone", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("phoneplace"));
  const c = await createCampaign(page.request, unique("Phone Table "));

  // A deep tree with long text — the shape most likely to push a row wide.
  const chart = async (name: string, parentName?: string) => {
    const all = (await (await page.request.get(`/api/campaigns/${c.id}/locations`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    const parentId = parentName ? all.find((l) => l.name === parentName)?.id : undefined;
    await page.request.post(`/api/campaigns/${c.id}/locations`, {
      data: {
        name,
        description: "A description long enough to threaten the row's width on a narrow screen",
        ...(parentId ? { parentId } : {}),
      },
    });
  };
  await chart("Faerun");
  await chart("The Sword Coast", "Faerun");
  await chart("Baldur's Gate — the Lower City wards", "The Sword Coast");

  await page.goto(`/questboard/campaigns/${c.id}/world`);
  await expect(page.getByRole("heading", { name: "The World" })).toBeVisible({ timeout: 20_000 });
  expect(await sidewaysOverflow(page), "the places page must not scroll sideways").toBeLessThanOrEqual(0);
});

test("the hero sheet fits a phone, class table and all", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("phonesheet"));

  // A Monk carries the widest table in the SRD — three columns beside the level.
  const id = await forgeHero(page.request, {
    name: unique("Bao "),
    className: "Monk",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 12, dex: 16, con: 14, int: 10, wis: 15, cha: 8 },
    skills: ["Acrobatics", "Stealth"],
  });

  await page.goto(`/questboard/heroes/${id}`);
  await expect(page.getByText("Monk Table")).toBeVisible({ timeout: 20_000 });
  // The table itself may scroll inside its own box — that is what overflow-x-auto
  // is for. What must not happen is the page scrolling with it.
  expect(await sidewaysOverflow(page), "the hero sheet must not scroll sideways").toBeLessThanOrEqual(0);
});
