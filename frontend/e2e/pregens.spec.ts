import { expect, test } from "@playwright/test";
import {
  createCampaign,
  forgeHero,
  joinCampaign,
  newAccount,
  registerViaAPI,
  unique,
} from "./helpers";

/*
Pre-made heroes: the DM's pool, and a player claiming from it (#180).

A DM running a one-shot sets ready-built characters out for the table; a player
claims one and it becomes theirs, seated. The journeys worth protecting:

  - the DM offers one of their own resting heroes into the pool, from the roster;
  - it waits in the pool and is NOT counted among the party;
  - a player claims it — it joins their roster, badged "pre-made", and leaves
    the pool — and the claim survives a reload;
  - releasing it hands it back to the pool for the next taker.
*/
test("a DM offers a pregen, a player claims it, then releases it back (#180)", async ({
  browser,
}) => {
  const dmCtx = await browser.newContext();
  const playerCtx = await browser.newContext();
  const dm = await dmCtx.newPage();
  const player = await playerCtx.newPage();

  // The DM builds a ready-made hero, resting on their own shelf for now.
  await dm.goto("/");
  await registerViaAPI(dm.request, newAccount("pregen-dm"));
  const campaign = await createCampaign(dm.request, unique("One-Shot "));
  const heroName = unique("Sir Doran ");
  await forgeHero(dm.request, {
    name: heroName,
    className: "Fighter",
    speciesName: "Human",
    backgroundName: "Soldier",
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 8 },
    skills: ["Acrobatics", "Survival"],
    speciesChoices: { size: ["Medium"], skillful: ["Perception"], versatile: ["Alert"] },
  });

  // From the roster, the DM offers it into the pool.
  await dm.goto(`/questboard/campaigns/${campaign.id}/party`);
  await expect(dm.getByRole("heading", { name: "The Party" })).toBeVisible({ timeout: 30_000 });
  await dm.getByLabel("Offer a pre-made hero").selectOption({ label: heroName });
  await dm.getByRole("button", { name: "Offer", exact: true }).click();

  // It appears in the pool, and is NOT one of the party yet — no adventurers.
  await expect(dm.getByRole("heading", { name: "Pre-made heroes" })).toBeVisible();
  await expect(dm.getByRole("button", { name: "Claim this hero" })).toBeVisible();
  await expect(dm.getByText("No adventurers yet")).toBeVisible();

  // A player walks in and opens the roster.
  await player.goto("/");
  await registerViaAPI(player.request, newAccount("pregen-player"));
  await joinCampaign(player.request, campaign.inviteCode);
  await player.goto(`/questboard/campaigns/${campaign.id}/party`);
  await expect(player.getByRole("heading", { name: "Pre-made heroes" })).toBeVisible({
    timeout: 30_000,
  });

  // They claim it. It joins the party, badged "pre-made", and leaves the pool.
  await player.getByRole("button", { name: "Claim this hero" }).click();
  await expect(player.getByText(heroName)).toBeVisible();
  await expect(player.getByText("pre-made", { exact: true })).toBeVisible();
  await expect(player.getByText("1 adventurer")).toBeVisible();
  await expect(player.getByRole("button", { name: "Claim this hero" })).toHaveCount(0);

  // The claim is real — a reload keeps it.
  await player.reload();
  await expect(player.getByText(heroName)).toBeVisible({ timeout: 30_000 });
  await expect(player.getByRole("button", { name: "Claim this hero" })).toHaveCount(0);

  // Releasing hands it back to the pool: it leaves the party (no "pre-made"
  // badge, no adventurers) and is claimable again — its name now reads only
  // from the pool card.
  player.on("dialog", (d) => d.accept());
  await player.getByRole("button", { name: "Release", exact: true }).click();
  await expect(player.getByRole("button", { name: "Claim this hero" })).toBeVisible();
  await expect(player.getByText("pre-made", { exact: true })).toHaveCount(0);
  await expect(player.getByText("No adventurers yet")).toBeVisible();
});
