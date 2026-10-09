import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, settled, unique } from "./helpers";

/*
What a class feature asks the player to choose (#382).

At the table a Fighter had no Fighting Style anywhere: the Forge never asked,
level-up never asked, and the sheet had nowhere to say. Every feature that
says "of your choice" was prose. These walk the three doors a choice now has —
the sheet (for every hero made before, who is owed one), the level-up, and the
server's refusals — the Forge's own step rides in forge.spec.ts.
*/

type Choice = { key: string; feature: string; name: string; count: number; picked: string[] };

async function choices(request: APIRequestContext, id: string): Promise<Choice[]> {
  const res = await request.get(`/api/characters/${id}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  return (body.character ?? body).sheet.featureChoices as Choice[];
}

async function sheetOf(page: Page, id: string) {
  await page.goto(`/questboard/heroes/${id}`);
  await settled(page);
}

test("a Fighter made before choices is asked for a style on the sheet, and it counts", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("styleless"));
  const id = await forgeHero(page.request, {
    name: unique("Harkon "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    skills: ["Athletics", "Perception"],
  });
  const items = (await (await page.request.get("/api/rules/item")).json()) as Array<{ id: string; name: string }>;
  const added = await page.request.post(`/api/characters/${id}/items`, {
    data: { contentId: items.find((i) => i.name === "Chain Mail")!.id, qty: 1 },
  });
  const mailId = (await added.json()).id as string;
  await page.request.patch(`/api/characters/${id}/items/${mailId}`, { data: { equipped: true } });

  await sheetOf(page, id);
  // The sheet says so up top, and where it lives.
  await expect(page.getByTestId("choices-waiting")).toContainText("Fighting Style");
  const style = (await choices(page.request, id)).find((c) => c.feature === "Fighting Style")!;
  const row = page.locator(`[data-choice-key="${style.key}"]`);
  await expect(row).toContainText("not chosen");
  await expect(page.getByText("AC", { exact: true }).first().locator("xpath=..")).toContainText("16");

  await row.getByRole("button", { name: "Choose" }).click();
  await page.getByRole("checkbox", { name: /^Defense/ }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(row).toContainText("Defense");
  await expect(row).not.toContainText("not chosen");
  // Defense is a feat on the sheet, and its +1 lands in the armour.
  await expect(page.getByText("AC", { exact: true }).first().locator("xpath=..")).toContainText("17");

  // A Fighter may change style; the old one leaves the feats with it.
  await row.getByRole("button", { name: "Change" }).click();
  await page.getByRole("checkbox", { name: /^Defense/ }).click();
  await page.getByRole("checkbox", { name: /^Archery/ }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Archery");
  const hero = await (await page.request.get(`/api/characters/${id}`)).json();
  const feats = (hero.character ?? hero).sheet.feats as string[];
  expect(feats).toContain("Archery");
  expect(feats).not.toContain("Defense");
});

test("the server holds a choice to its rules", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("rogueexp"));
  const id = await forgeHero(page.request, {
    name: unique("Vex "),
    className: "Rogue",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 16, con: 14, int: 12, wis: 12, cha: 10 },
    skills: ["Stealth", "Acrobatics", "Perception", "Sleight of Hand"],
  });
  const expertise = (await choices(page.request, id)).find((c) => c.feature === "Expertise")!;
  expect(expertise.count).toBe(2);
  const put = (picks: string[], key = expertise.key) =>
    page.request.put(`/api/characters/${id}/choices`, { data: { key, picks } });

  // Expertise needs a skill the hero is proficient in, and exactly the count.
  const untrained = await put(["Stealth", "Arcana"]);
  expect(untrained.status()).toBe(400);
  expect((await untrained.json()).error).toMatch(/Arcana/);
  expect((await put(["Stealth"])).status()).toBe(400);

  const made = await put(["Stealth", "Sleight of Hand"]);
  expect(made.ok(), await made.text()).toBeTruthy();
  expect((await made.json()).sheet.expertise).toEqual(["Sleight of Hand", "Stealth"]);

  // Expertise declares no swap: once made it is made.
  const changed = await put(["Stealth", "Acrobatics"]);
  expect(changed.status()).toBe(400);
  expect((await changed.json()).error).toMatch(/already chosen/);

  // And a key nobody asked is refused rather than stored.
  expect((await put(["Defense"], "nope:fighting-style")).status()).toBe(400);

  // The sheet doubles the bonus: DEX +3, proficiency +2 twice.
  await sheetOf(page, id);
  await expect(page.getByText(/◆ Stealth/).locator("xpath=..")).toContainText("+7");
});

test("a Paladin is asked for a style at level 2, and a Wizard cannot take one at 4", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("paladinstyle"));
  const id = await forgeHero(page.request, {
    name: unique("Aster "),
    className: "Paladin",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 14 },
    skills: ["Athletics", "Persuasion"],
  });
  expect((await choices(page.request, id)).some((c) => c.feature === "Fighting Style")).toBe(false);

  await sheetOf(page, id);
  await page.getByRole("button", { name: /level up/i }).click();
  await expect(page.getByText("Fighting Style", { exact: true }).first()).toBeVisible();
  // The Paladin's own alternative stands beside the feats.
  await expect(page.getByRole("checkbox", { name: /^Blessed Warrior/ })).toBeVisible();
  await page.getByRole("checkbox", { name: /^Archery/ }).click();
  await page.getByRole("button", { name: /^Rise to Level 2/ }).click();

  await expect
    .poll(async () => (await choices(page.request, id)).find((c) => c.feature === "Fighting Style")?.picked)
    .toEqual(["Archery"]);

  // A Fighting Style feat is the Fighting Style feature's to give; a Wizard
  // reaching an Ability Score Improvement has none.
  await registerViaAPI(page.request, newAccount("wizstyle"));
  const wiz = await forgeHero(page.request, {
    name: unique("Ezra "),
    className: "Wizard",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    skills: ["Arcana", "History"],
  });
  const rules = async (kind: string, name: string) =>
    ((await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{ id: string; name: string }>).find(
      (e) => e.name === name,
    )!.id;
  for (const body of [{}, { subclassId: await rules("subclass", "Evoker") }]) {
    const res = await page.request.post(`/api/characters/${wiz}/levelup`, { data: { hpMode: "average", ...body } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const refused = await page.request.post(`/api/characters/${wiz}/levelup`, {
    data: { hpMode: "average", featId: await rules("feat", "Archery") },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toMatch(/Fighting Style feature/);
});
