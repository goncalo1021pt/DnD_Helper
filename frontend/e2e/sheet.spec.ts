import { test, expect, type APIRequestContext } from "@playwright/test";
import { newAccount, registerViaAPI, unique } from "./helpers";

/*
What the hero sheet is willing to tell a player about their own hero.

#132 is a *wrong number* rather than a missing one, which is why it is worth an
exact assertion: a Barbarian's Unarmored Defense was ignored, so their AC read
three points low and every attack roll at the table was judged against it.
Nobody notices that. A hit lands that should have missed and the session moves
on. "An AC is displayed" is what the app did before the fix too, so the number
itself is the test.
*/

/** Forge a hero straight onto the account, as the wizard would. */
export async function forgeHero(
  request: APIRequestContext,
  hero: {
    name: string;
    className: string;
    speciesName: string;
    backgroundName: string;
    abilities: Record<string, number>;
    skills: string[];
    speciesChoices?: Record<string, string[]>;
  },
): Promise<string> {
  const byName = async (kind: string, want: string) => {
    const list = (await (await request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    const hit = list.find((e) => e.name === want);
    expect(hit, `${want} should be in the ${kind} library`).toBeTruthy();
    return hit!.id;
  };

  const res = await request.post("/api/me/characters/forge", {
    data: {
      name: hero.name,
      classId: await byName("class", hero.className),
      speciesId: await byName("species", hero.speciesName),
      backgroundId: await byName("background", hero.backgroundName),
      abilities: hero.abilities,
      skills: hero.skills,
      speciesChoices: hero.speciesChoices,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

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
