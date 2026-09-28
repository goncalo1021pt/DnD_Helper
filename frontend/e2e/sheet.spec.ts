import { test, expect } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
What the hero sheet is willing to tell a player about their own hero.

#132 is a *wrong number* rather than a missing one, which is why it is worth an
exact assertion: a Barbarian's Unarmored Defense was ignored, so their AC read
three points low and every attack roll at the table was judged against it.
Nobody notices that. A hit lands that should have missed and the session moves
on. "An AC is displayed" is what the app did before the fix too, so the number
itself is the test.
*/


test("a Barbarian's Unarmored Defense is in their AC", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("unarmored"));

  // DEX 14 (+2) and CON 16 (+3), and a Barbarian's starting kit carries no
  // armour — so 10 + 2 + 3 = 15. Before the fix the sheet said 12, because
  // acFromEquipment knew 10 + DEX and no feature could say otherwise.
  const id = await forgeHero(page.request, {
    name: unique("Grash "),
    className: "Barbarian",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });

  await page.goto(`/questboard/heroes/${id}`);
  const ac = page.getByText("AC", { exact: true }).locator("xpath=following-sibling::div").first();
  await expect(ac).toHaveText("15");
});

test("a Gnome's species traits and their lineage are on the sheet", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("traits"));

  const id = await forgeHero(page.request, {
    name: unique("Fizwick "),
    className: "Fighter",
    speciesName: "Gnome",
    backgroundName: "Acolyte",
    abilities: { str: 12, dex: 14, con: 13, int: 15, wis: 10, cha: 8 },
    skills: ["Athletics", "Survival"],
    speciesChoices: { lineage: ["Forest Gnome"], "lineage-ability": ["Intelligence"] },
  });

  await page.goto(`/questboard/heroes/${id}`);

  // The report, word for word: "I created a gnome of the forest, it did not
  // show any of the species abilities under the character sheet."
  await expect(page.getByText("Darkvision").first()).toBeVisible();
  await expect(page.getByText("Gnomish Cunning").first()).toBeVisible();
  // And the lineage that was chosen, not merely the invitation to choose one.
  await expect(page.getByText("Forest Gnome").first()).toBeVisible();

  // A feat the background granted now says what it *does*, rather than sitting
  // in a comma-separated list of names the player already knew.
  await expect(page.getByText("Magic Initiate (Cleric)").first()).toBeVisible();
  await expect(page.getByText("You learn two cantrips of your choice").first()).toBeVisible();
});

/*
Armour, and the number it changes.

Two things meet on this page: `slotsFor` decides what an inventory row can be
worn as, and `acFromEquipment` decides what wearing it is worth. Between them
sits the rig — three tiles, each a button that opens a picker of whatever fits.

HeroSheetPage is 878 lines and #108's next target, so this is the net under the
part of it that produces a number. Like #132, "an AC is displayed" was true
before and after every bug this page has ever had; the number is the test.
*/
test("worn armour changes the AC the sheet reports", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("armour"));

  // DEX 14 (+2), no armour: 10 + 2 = 12.
  const id = await forgeHero(page.request, {
    name: unique("Sir Kay "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 14, con: 13, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Survival"],
  });

  // Put a real piece of armour in the pack — from the library, so the sheet can
  // read its type and its AC rather than treating it as free text.
  const items = (await (await page.request.get("/api/rules/item")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const chain = items.find((i) => i.name === "Chain Mail");
  expect(chain, "Chain Mail should be in the armory").toBeTruthy();
  const added = await page.request.post(`/api/characters/${id}/items`, {
    data: { contentId: chain!.id, name: "Chain Mail", qty: 1 },
  });
  expect(added.ok(), await added.text()).toBeTruthy();

  await page.goto(`/questboard/heroes/${id}`);
  const ac = page.getByText("AC", { exact: true }).locator("xpath=following-sibling::div").first();
  await expect(ac).toHaveText("12");

  // The rig lives on the Inventory tab: three tiles, each a button that opens a
  // picker of whatever fits that slot.
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  // The empty tile, not the "Armor" type filter beside the pack — both are
  // buttons whose name starts with the word, and clicking the wrong one filters
  // the grid and equips nothing.
  await page.getByRole("button", { name: /Armor.*empty/i }).click();
  // Inside the picker: the pack behind it holds a Chain Mail tile of its own.
  await page.getByRole("dialog").getByRole("button", { name: /Chain Mail/ }).click();

  // Back on the sheet, the number has moved. Chain Mail is AC 16 flat — DEX
  // stops counting, which is the whole point of the formula living in the item
  // rather than in the page.
  await page.getByRole("button", { name: "The Sheet", exact: true }).click();
  await expect(ac).toHaveText("16", { timeout: 20_000 });
});

/*
The number the rules keep pointing at (#129).

Reported as "Rogue sneak and other similar features are missing". They were not
missing from the Features list — "Sneak Attack" was there with its whole text.
What was missing is the only part a Rogue needs mid-turn: how many dice. The
rules text says "see the Sneak Attack column of the Rogue table", and there was
no table.

So the assertion is the value at this hero's level, not that a table rendered.
*/
test("a Rogue is told how many Sneak Attack dice they actually have", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("sneak"));

  const id = await forgeHero(page.request, {
    name: unique("Shiv "),
    className: "Rogue",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 16, con: 13, int: 12, wis: 12, cha: 8 },
    skills: ["Acrobatics", "Perception", "Stealth", "Investigation"],
  });

  await page.goto(`/questboard/heroes/${id}`);
  await expect(page.getByText("Rogue Table")).toBeVisible({ timeout: 20_000 });

  // A level 1 Rogue sneaks for 1d6. Located by title, because "Sneak Attack"
  // also names the feature in the Features list right above — the whole point
  // being that the feature was already there and the number was not.
  await expect(page.getByTitle("Your Sneak Attack at level 1")).toHaveText(/Sneak Attack\s*1d6/);

  // And the road ahead is there too, so levelling up is not a surprise. The
  // progression carries all twenty rows: 10d6 twice, at levels 19 and 20, which
  // is the tail of the real table rather than a truncated one.
  await expect(page.getByRole("cell", { name: "10d6" })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "1d6" })).toHaveCount(2);
});

/*
Eleven of the twelve SRD classes have a table. The twelfth is the Wizard, whose
progression is spell slots and nothing else, and it should get no heading with
nothing under it.
*/
test("a class with no table gets no table", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("notable"));

  const id = await forgeHero(page.request, {
    name: unique("Plain "),
    className: "Wizard",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 14, con: 13, int: 16, wis: 12, cha: 8 },
    skills: ["Arcana", "History"],
  });

  await page.goto(`/questboard/heroes/${id}`);
  await expect(page.getByText("Features", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Table$/)).toHaveCount(0);
});

/*
Print opens the sheet in a tab of its own (#360). It used to be a hidden frame,
and Safari printed the page behind it. The tab is opened by the click, before
the PDF is drawn, so no popup blocker sees a window opened after an await —
then the finished file is put in it and the dialog asked for, once, only when
the tab holds the PDF and not the placeholder.

Headless Chromium has no PDF viewer to open a tab into, so window.open is
stubbed with a window that records what the printer does to it; the PDF itself
is fetched back from the blob address it was given.
*/
test("Print opens the finished sheet in a tab of its own, and asks for the dialog once (#360)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const stub = {
      closed: false,
      href: "",
      printed: 0,
      focused: 0,
      document: { title: "", body: { innerHTML: "" }, readyState: "complete" },
      location: {
        get href() {
          return stub.href;
        },
        set href(v: string) {
          stub.href = v;
        },
      },
      addEventListener: () => {},
      focus: () => {
        stub.focused++;
      },
      print: () => {
        stub.printed++;
      },
      close: () => {
        stub.closed = true;
      },
    };
    (window as unknown as { __sheetTab: typeof stub }).__sheetTab = stub;
    window.open = () => stub as unknown as Window;
  });
  const tab = () =>
    page.evaluate(() => {
      const t = (window as unknown as { __sheetTab: { href: string; printed: number; document: { title: string } } })
        .__sheetTab;
      return { href: t.href, printed: t.printed, title: t.document.title };
    });

  await page.goto("/");
  await registerViaAPI(page.request, newAccount("printer"));
  const id = await forgeHero(page.request, {
    name: unique("Inkwell "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Perception"],
  });
  await page.goto(`/questboard/heroes/${id}`);
  const print = page.getByRole("button", { name: "Print" });
  await expect(print).toBeVisible({ timeout: 20_000 });
  await print.click();

  // The tab was opened by the click and told what is happening…
  await expect.poll(async () => (await tab()).title).toBe("Setting the ink…");
  // …then handed the finished file and asked, once, for the dialog.
  await expect.poll(async () => (await tab()).href, { timeout: 30_000 }).toMatch(/^blob:/);
  await expect.poll(async () => (await tab()).printed).toBe(1);
  await page.waitForTimeout(700);
  expect((await tab()).printed, "asked once, not on every poll").toBe(1);

  const head = await page.evaluate(async () => {
    const t = (window as unknown as { __sheetTab: { href: string } }).__sheetTab;
    const bytes = new Uint8Array(await (await fetch(t.href)).arrayBuffer());
    return String.fromCharCode(...bytes.slice(0, 5));
  });
  expect(head).toBe("%PDF-");
  await expect(print).toBeEnabled();
});
