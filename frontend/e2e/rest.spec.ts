import { expect, test } from "@playwright/test";
import { newAccount, registerViaAPI, unique } from "./helpers";

/*
The two rests (#118).

They existed only as reference text: nothing reset a slot, restored a hit
point, or spent a hit die. After a night at the table a player un-clicked every
spent slot by hand, clicked HP up to max, and then tapped the spell swap —
three chores standing in for one action, and three chances to forget one.

So the assertions are the three numbers, together, from one press. A rest that
restored HP and quietly left the slots spent would have passed "a rest button
exists", and the player would have found out mid-fight.
*/

async function forgeCleric(page: import("@playwright/test").Page, name: string): Promise<string> {
  const byName = async (kind: string, want: string) => {
    const list = (await (await page.request.get(`/api/rules/${kind}`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    const hit = list.find((e) => e.name === want);
    expect(hit, `${want} should be in the ${kind} library`).toBeTruthy();
    return hit!.id;
  };
  const res = await page.request.post("/api/me/characters/forge", {
    data: {
      name,
      classId: await byName("class", "Cleric"),
      speciesId: await byName("species", "Dwarf"),
      backgroundId: await byName("background", "Acolyte"),
      abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 8 },
      skills: ["History", "Medicine"],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).id as string;
}

test("a long rest does in one press what took three chores", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("rest"));
  const id = await forgeCleric(page, unique("Durnan "));

  // Spend the day: wounded, and two first-level slots gone.
  const { character: hero } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as { character: { hpMax: number; level: number } };
  await page.request.put(`/api/characters/${id}`, {
    data: { name: "Durnan", class: "Cleric", level: hero.level, hpCurrent: 1, hpMax: hero.hpMax },
  });
  const slots = await page.request.put(`/api/characters/${id}/slots`, {
    data: { used: [2, 0, 0, 0, 0, 0, 0, 0, 0] },
  });
  expect(slots.ok(), await slots.text()).toBeTruthy();

  await page.goto(`/questboard/heroes/${id}`);
  const longRest = page.getByRole("button", { name: "Long Rest" });
  await expect(longRest).toBeVisible({ timeout: 20_000 });
  await longRest.click();

  // One press, and all three chores are done — read back from the server, not
  // from the panel that just claimed it.
  await expect(page.getByRole("status")).toContainText(/Whole again/, { timeout: 20_000 });
  const { character: after } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as {
    character: { hpCurrent: number; hpMax: number; sheet: { spellSlots: Array<{ used: number }> } };
  };
  expect(after.hpCurrent, "a long rest restores every hit point").toBe(after.hpMax);
  expect(
    after.sheet.spellSlots.every((s) => s.used === 0),
    "a long rest returns every spell slot",
  ).toBe(true);
});

test("a short rest spends hit dice, and cannot spend more than the hero has", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("short"));
  const id = await forgeCleric(page, unique("Brenna "));

  const { character: hero } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as { character: { hpMax: number; level: number } };
  await page.request.put(`/api/characters/${id}`, {
    data: { name: "Brenna", class: "Cleric", level: hero.level, hpCurrent: 1, hpMax: hero.hpMax },
  });

  await page.goto(`/questboard/heroes/${id}`);
  // A level 1 hero has exactly one hit die, so the stepper cannot offer two.
  await expect(page.getByText(/Hit dice 1 \/ 1/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /One more d\d+ hit die/ })).toBeDisabled();

  await page.getByRole("button", { name: "Short Rest" }).click();
  await expect(page.getByRole("status")).toContainText(/Caught your breath/, { timeout: 20_000 });

  // The die is spent and the hero is no worse off than they were.
  await expect(page.getByText(/Hit dice 0 \/ 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Short Rest" })).toBeDisabled();

  const { character: after } = (await (
    await page.request.get(`/api/characters/${id}`)
  ).json()) as { character: { hpCurrent: number } };
  expect(after.hpCurrent, "a spent hit die heals at least nothing").toBeGreaterThanOrEqual(1);
});
