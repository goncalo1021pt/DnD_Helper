import { test, expect, type APIRequestContext } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
What a multiclassed hero's sheet says (#190, part 4).

The features panel read the starting class alone, so a Fighter who took a
Cleric level was shown their Fighting Style and told nothing at all about
being a Cleric — the class was on the header and nowhere else. And where two
classes grant the same feature the sheet must say it once, because "if you
gain the Extra Attack feature from more than one class, the features don't
stack" (PHB 2024, p.44) and two entries read as two extra attacks.
*/

async function classIdNamed(request: APIRequestContext, want: string) {
  const list = (await (await request.get("/api/rules/class")).json()) as Array<{
    id: string;
    name: string;
  }>;
  return list.find((c) => c.name === want)!.id;
}

test("the sheet shows the features of every class, not just the first", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mcsheet"));
  const heroId = await forgeHero(page.request, {
    name: unique("Bellcaster "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 12, con: 14, int: 10, wis: 13, cha: 8 },
    skills: ["Athletics", "Perception"],
  });

  await page.goto(`/questboard/heroes/${heroId}`);
  await expect(page.getByText("Second Wind").first()).toBeVisible();

  const cleric = await classIdNamed(page.request, "Cleric");
  const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
    data: { hpMode: "average", classId: cleric },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  await page.reload();
  // Both classes now speak for themselves.
  await expect(page.getByText("Second Wind").first()).toBeVisible();
  await expect(page.getByText("Divine Order").first()).toBeVisible();
});

test("a feature granted twice is listed once, and says it does not stack", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("mcstack"));
  // Fighter and Ranger both grant Extra Attack at their level 5.
  const heroId = await forgeHero(page.request, {
    name: unique("Twinblade "),
    className: "Fighter",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 13, cha: 8 },
    skills: ["Athletics", "Perception"],
  });
  const fighter = await classIdNamed(page.request, "Fighter");
  const ranger = await classIdNamed(page.request, "Ranger");
  const subclasses = (await (await page.request.get("/api/rules/subclass")).json()) as Array<{
    id: string;
    name: string;
    data: { class?: string };
  }>;
  const pick = (cls: string) => subclasses.find((s) => s.data.class === cls)!.id;

  // Both classes take an ASI at their own level 4, and a subclass at 3.
  const level = async (classId: string, opts: { subclass?: string; asi?: boolean } = {}) => {
    const res = await page.request.post(`/api/characters/${heroId}/levelup`, {
      data: {
        hpMode: "average",
        classId,
        ...(opts.subclass ? { subclassId: opts.subclass } : {}),
        ...(opts.asi ? { asi: { con: 2 } } : {}),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  };
  // Fighter to 5 (Extra Attack), then Ranger to 5 (Extra Attack again).
  await level(fighter); // 2
  await level(fighter, { subclass: pick("Fighter") }); // 3
  await level(fighter, { asi: true }); // 4
  await level(fighter); // 5 — Extra Attack
  for (const n of [1, 2, 3, 4, 5]) {
    await level(ranger, {
      ...(n === 3 ? { subclass: pick("Ranger") } : {}),
      ...(n === 4 ? { asi: true } : {}),
    });
  }

  await page.goto(`/questboard/heroes/${heroId}`);
  await expect(page.getByText("Extra Attack").first()).toBeVisible();
  // Once, not twice — and the sheet says why.
  await expect(page.getByText("Extra Attack", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/does not stack/).first()).toBeVisible();
});
