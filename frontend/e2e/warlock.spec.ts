import { test, expect } from "@playwright/test";
import { forgeHero, newAccount, registerViaAPI, unique } from "./helpers";

/*
A pure Warlock on their own sheet (#360).

The pact row used to be drawn inside the block for shared slots, which only
existed when there were some — so a Warlock with no other class had no slots
on screen at all, and nothing to tick. The API was right the whole time
(multiclass-casting.spec.ts); this one is about what a person can press.
*/
test("a pure Warlock sees and spends their pact slot", async ({ page }) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("pact"));
  const heroId = await forgeHero(page.request, {
    name: unique("Hexbound "),
    className: "Warlock",
    speciesName: "Dwarf",
    backgroundName: "Acolyte",
    abilities: { str: 10, dex: 13, con: 14, int: 10, wis: 12, cha: 15 },
    skills: ["Arcana", "Deception"],
  });

  await page.goto(`/questboard/heroes/${heroId}`);
  const slot = page.getByRole("button", { name: "Pact slot 1 of 1" });
  await expect(slot, "a Warlock 1 has one pact slot on their sheet").toBeVisible();

  await slot.click();
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/characters/${heroId}`);
      return ((await res.json()) as { character: { sheet?: { pactSlots?: { used: number } } } }).character
        .sheet?.pactSlots?.used;
    })
    .toBe(1);
});
