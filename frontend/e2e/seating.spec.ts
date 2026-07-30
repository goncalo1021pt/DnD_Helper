import { test, expect } from "@playwright/test";
import { createCampaign, joinCampaign, newAccount, registerViaAPI, unique } from "./helpers";

/*
Being refused a seat, and being told why.

This is #128, and it is the bug that cost a real session: the codex refused a
hero, the server said exactly which content it objected to, and the roster's
Summon button threw the payload away and did nothing. The DM could not tell a
refusal from a broken button, so the table played without the app.

The assertion that matters here is not that seating is refused — the server
already did that correctly, and its handlers are unit-tested. It is that the
refusal is *legible on screen*. A test that only checked the 409 would have
passed happily all through the session that went wrong.
*/

/** Forge a minimal hero straight onto the account, as the wizard would. */
async function forgeHero(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  className: string,
): Promise<{ id: string; classId: string }> {
  const rules = await (await request.get("/api/rules/class")).json();
  const klass = (rules as Array<{ id: string; name: string }>).find((c) => c.name === className);
  expect(klass, `${className} should be in the rules library`).toBeTruthy();

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
      name,
      classId: klass!.id,
      // Acolyte grants Insight + Religion, so these two class picks cannot
      // collide with it — the conflict rules are forge.spec's subject, not this
      // test's.
      backgroundId: await byName("background", "Acolyte"),
      speciesId: await byName("species", "Dwarf"),
      abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      skills: ["Perception", "Survival"],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { id: (await res.json()).id as string, classId: klass!.id };
}

test("a hero the codex refuses is turned away with the reason on screen", async ({
  browser,
}) => {
  const dm = newAccount("dmseat");
  const player = newAccount("plseat");

  // --- the DM's table, with Fighter barred ---------------------------------
  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await dmPage.goto("/");
  await registerViaAPI(dmPage.request, dm);
  const campaign = await createCampaign(dmPage.request, unique("The Barred Door "));

  const rules = (await (await dmPage.request.get("/api/rules/class")).json()) as Array<{
    id: string;
    name: string;
  }>;
  const fighter = rules.find((c) => c.name === "Fighter")!;
  const banned = await dmPage.request.put(
    `/api/campaigns/${campaign.id}/codex/${fighter.id}`,
    { data: { status: "banned" } },
  );
  expect(banned.ok(), await banned.text()).toBeTruthy();

  // --- a player with a Fighter walks in ------------------------------------
  const plCtx = await browser.newContext();
  const plPage = await plCtx.newPage();
  await plPage.goto("/");
  await registerViaAPI(plPage.request, player);
  await forgeHero(plPage.request, "Brannor", "Fighter");
  await joinCampaign(plPage.request, campaign.inviteCode);

  // --- they try to summon them onto the roster -----------------------------
  await plPage.goto(`/questboard/campaigns/${campaign.id}/party`);
  await plPage.getByRole("combobox").last().selectOption({ label: "Brannor" });
  await plPage.getByRole("button", { name: "Summon", exact: true }).click();

  // The refusal is explained, names the offending content, and offers the fix.
  await expect(plPage.getByText(/The Codex Objects/i)).toBeVisible({ timeout: 15_000 });
  await expect(plPage.getByText(/Fighter/).first()).toBeVisible();
  await expect(plPage.getByText(/banned by the DM/i)).toBeVisible();

  await dmCtx.close();
  await plCtx.close();
});
