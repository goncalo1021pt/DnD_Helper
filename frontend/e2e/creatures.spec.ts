import { test, expect } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
The second stat block.

The report was that a Druid can read "you assume a Beast form" on their sheet
and had nowhere in the app to find out what a wolf's numbers were: the stat
blocks all live in the Den, and the Den is a DM room. So the journey worth
protecting is the whole of it — a player, on their own sheet, reaching a
creature they are entitled to and nothing else.

The CR ceiling is asserted by name rather than by count. "Some beasts are
offered" is what a broken filter would also produce; "the Wolf is offered and
the Dire Wolf is not" is the rule.
*/

async function levelTo(request: import("@playwright/test").APIRequestContext, id: string, level: number) {
  for (let at = 1; at < level; at++) {
    const res = await request.post(`/api/characters/${id}/levelup`, {
      data: { hpMode: "average" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
}

test("a Druid reaches the beasts Wild Shape grants, and nothing else", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("wildshape"));

  const id = await forgeHero(page.request, {
    name: unique("Brambleback "),
    className: "Druid",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 17, cha: 8 },
    skills: ["Nature", "Perception"],
  });
  // Wild Shape arrives at Druid level 2 — at level 1 the panel must stay empty.
  await levelTo(page.request, id, 2);

  await page.goto(`/questboard/heroes/${id}`);
  await expect(page.getByText("Forms & Companions")).toBeVisible();

  await page.getByRole("button", { name: "Add" }).first().click();
  const picker = page.getByRole("dialog");

  // The allowance, read off the Beast Shapes table rather than the prose: four
  // forms, CR 1/4, no flying yet, and the temporary hit points assuming one
  // grants (equal to the Druid's level).
  await expect(picker.getByText(/Wild Shape — 4 known · up to CR 1\/4/)).toBeVisible();
  await expect(picker.getByText(/no flying forms yet/)).toBeVisible();
  await expect(picker.getByText(/\+2 temp HP/)).toBeVisible();

  // A CR 1/4 Beast is in; a CR 1 Beast is over the ceiling, and a CR 0 Beast
  // with a Fly Speed is grounded until level 8.
  await expect(picker.getByRole("button", { name: /^Wolf/ })).toBeVisible();
  await expect(picker.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: /^Eagle/ })).toHaveCount(0);

  await picker.getByPlaceholder("Search…").fill("Wolf");
  await picker.getByRole("button", { name: /^Wolf/ }).locator("xpath=..").getByRole("button", { name: "Take" }).click();

  // On the sheet: named, stamped with the feature that granted it, and saying
  // the rule a player gets wrong — a form keeps the hero's own hit points.
  await expect(page.getByRole("button", { name: "Wolf", exact: true })).toBeVisible();
  await expect(page.getByText("Wild Shape").first()).toBeVisible();
  await expect(page.getByText(/keeps your hit points · \+2 temp HP/)).toBeVisible();

  // Taking the form is a state the sheet holds, not a note the player keeps.
  await page.getByRole("button", { name: "Take the form" }).click();
  await expect(page.getByRole("button", { name: "Drop the form" })).toBeVisible();
});

/*
Molding, which is the point of the feature rather than a nicety.

Half the companions in print scale off the hero and the other half get
houseruled, so a stat block that cannot be edited is a stat block that is wrong
at somebody's table. Overriding one number must not disturb the rest.
*/
test("a molded number beats the book, and leaves the others alone", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mold"));

  const id = await forgeHero(page.request, {
    name: unique("Thornwake "),
    className: "Druid",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 17, cha: 8 },
    skills: ["Nature", "Perception"],
  });
  await levelTo(page.request, id, 2);

  // Straight to the API for the setup: the picker has its own test above.
  const options = (await (
    await page.request.get(`/api/characters/${id}/creature-options`)
  ).json()) as { forms: Array<{ options: Array<{ contentId: string; name: string }> }> };
  const wolf = options.forms[0].options.find((o) => o.name === "Wolf")!;
  expect(wolf, "the Wolf should be an eligible form").toBeTruthy();

  const created = await page.request.post(`/api/characters/${id}/creatures`, {
    data: { role: "form", contentId: wolf.contentId, name: "Grey", grantedBy: "Wild Shape" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  await page.goto(`/questboard/heroes/${id}`);
  await expect(page.getByRole("button", { name: "Grey", exact: true })).toBeVisible();
  // The book's Wolf wears AC 12.
  await expect(page.getByText("AC 12")).toBeVisible();

  await page.getByRole("button", { name: "Mold" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("AC").or(editor.locator("input").nth(1)).fill("14");
  await editor.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("AC 14")).toBeVisible();
  await expect(page.getByText("molded")).toBeVisible();

  // The rest of the block still tracks the library entry.
  const detail = (await (await page.request.get(`/api/characters/${id}`)).json()) as {
    creatures: Array<{ molded: string[]; block: Record<string, unknown> }>;
  };
  expect(detail.creatures[0].molded).toEqual(["ac"]);
  expect(detail.creatures[0].block.hp).toBe(11);
});
