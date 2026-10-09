import { expect, test, type APIRequestContext } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, settled, unique } from "./helpers";

/*
Eldritch Invocations and Metamagic as class feature choices (#384).

#382 gave class features a way to ask; these two were still prose, and an
Ability Score Improvement was the only door to an invocation. Now the Warlock's
feature asks — read against each invocation's prerequisite, which the books
write in prose — and the ASI door is shut.
*/

type Choice = { key: string; feature: string; count: number; picked: string[] };

async function hero(request: APIRequestContext, id: string) {
  const body = await (await request.get(`/api/characters/${id}`)).json();
  return (body.character ?? body) as { sheet: { feats: string[]; featureChoices: Choice[] } };
}

async function choiceOf(request: APIRequestContext, id: string, feature: string): Promise<Choice> {
  return (await hero(request, id)).sheet.featureChoices.find((c) => c.feature === feature)!;
}

async function levelTo(request: APIRequestContext, id: string, from: number, to: number, at: Record<number, object> = {}) {
  for (let next = from + 1; next <= to; next++) {
    const res = await request.post(`/api/characters/${id}/levelup`, { data: { hpMode: "average", ...(at[next] ?? {}) } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
}

const rule = async (request: APIRequestContext, kind: string, name: string) =>
  ((await (await request.get(`/api/rules/${kind}`)).json()) as Array<{ id: string; name: string }>).find(
    (e) => e.name === name,
  )!.id;

test("a Warlock's invocations answer to their prerequisites, and some may be taken twice", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("warlock"));
  const id = await forgeHero(page.request, {
    name: unique("Mordecai "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    skills: ["Arcana", "Deception"],
  });
  let inv = await choiceOf(page.request, id, "Eldritch Invocations");
  expect(inv.count).toBe(1);
  const put = (picks: string[]) =>
    page.request.put(`/api/characters/${id}/choices`, { data: { key: inv.key, picks } });

  // Agonizing Blast asks for Warlock 2.
  const early = await put(["Agonizing Blast"]);
  expect(early.status()).toBe(400);
  expect((await early.json()).error).toMatch(/needs Warlock level 2/);
  expect((await put(["Pact of the Blade"])).ok()).toBeTruthy();

  // Warlock 2 knows three; a repeatable invocation may fill two of them.
  await levelTo(page.request, id, 1, 2);
  inv = await choiceOf(page.request, id, "Eldritch Invocations");
  expect(inv.count).toBe(3);
  const twice = await put(["Pact of the Blade", "Agonizing Blast", "Agonizing Blast"]);
  expect(twice.ok(), await twice.text()).toBeTruthy();
  expect((await hero(page.request, id)).sheet.feats.filter((f) => f === "Agonizing Blast")).toHaveLength(2);
  const notRepeatable = await put(["Pact of the Blade", "Devil's Sight", "Devil's Sight"]);
  expect(notRepeatable.status()).toBe(400);

  // Warlock 5: Thirsting Blade stands on Pact of the Blade, held or picked alongside.
  await levelTo(page.request, id, 2, 5, {
    3: { subclassId: await rule(page.request, "subclass", "Fiend Patron") },
    4: { asi: { cha: 2 } },
  });
  inv = await choiceOf(page.request, id, "Eldritch Invocations");
  expect(inv.count).toBe(5);
  const noPact = await put(["Pact of the Tome", "Agonizing Blast", "Agonizing Blast", "Devil's Sight", "Thirsting Blade"]);
  expect(noPact.status()).toBe(400);
  expect((await noPact.json()).error).toMatch(/needs Pact of the Blade/);
  const withPact = await put(["Pact of the Blade", "Agonizing Blast", "Agonizing Blast", "Devil's Sight", "Thirsting Blade"]);
  expect(withPact.ok(), await withPact.text()).toBeTruthy();

  // An invocation is no longer an Ability Score Improvement's to give.
  await levelTo(page.request, id, 5, 7);
  const asi = await page.request.post(`/api/characters/${id}/levelup`, {
    data: { hpMode: "average", featId: await rule(page.request, "feat", "Eldritch Mind") },
  });
  expect(asi.status()).toBe(400);
  expect((await asi.json()).error).toMatch(/class feature/);
});

test("a Sorcerer is asked for Metamagic at level 2, in the picker", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("sorcerer"));
  const id = await forgeHero(page.request, {
    name: unique("Ilsa "),
    className: "Sorcerer",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    skills: ["Arcana", "Deception"],
  });
  expect((await hero(page.request, id)).sheet.featureChoices.some((c) => c.feature === "Metamagic")).toBe(false);

  await page.goto(`/questboard/heroes/${id}`);
  await settled(page);
  await page.getByRole("button", { name: /level up/i }).click();
  await expect(page.getByText("Metamagic", { exact: true }).first()).toBeVisible();
  await page.getByRole("checkbox", { name: /^Quickened Spell/ }).click();
  await page.getByRole("checkbox", { name: /^Twinned Spell/ }).click();
  await page.getByRole("button", { name: /^Rise to Level 2/ }).click();

  await expect
    .poll(async () => (await choiceOf(page.request, id, "Metamagic"))?.picked)
    .toEqual(["Quickened Spell", "Twinned Spell"]);
  expect((await hero(page.request, id)).sheet.feats).toEqual(
    expect.arrayContaining(["Quickened Spell", "Twinned Spell"]),
  );
});

test("the picker holds Thirsting Blade until Pact of the Blade is picked beside it", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("pactpick"));
  const id = await forgeHero(page.request, {
    name: unique("Corvin "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    skills: ["Arcana", "Deception"],
  });
  await levelTo(page.request, id, 1, 5, {
    3: { subclassId: await rule(page.request, "subclass", "Fiend Patron") },
    4: { asi: { cha: 2 } },
  });

  await page.goto(`/questboard/heroes/${id}`);
  await settled(page);
  const inv = await choiceOf(page.request, id, "Eldritch Invocations");
  await page.locator(`[data-choice-key="${inv.key}"]`).getByRole("button", { name: "Choose" }).click();
  const thirsting = page.getByRole("checkbox", { name: /^Thirsting Blade/ });
  await expect(thirsting).toBeDisabled();
  await expect(thirsting).toContainText("needs Pact of the Blade");
  // Witch Sight is Warlock 15: offered, and said why not.
  await expect(page.getByRole("checkbox", { name: /^Witch Sight/ })).toContainText("needs Warlock level 15");

  await page.getByRole("checkbox", { name: /^Pact of the Blade/ }).click();
  await expect(thirsting).toBeEnabled();
  await thirsting.click();
  // Giving the pact up takes what stood on it.
  await page.getByRole("checkbox", { name: /^Pact of the Blade/ }).click();
  await expect(thirsting).toHaveAttribute("aria-checked", "false");
});
