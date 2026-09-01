import { test, expect } from "@playwright/test";
import { createCampaign, createLocation, newAccount, registerViaAPI, unique } from "./helpers";

/*
The quest board's place filter (#290).

The board used to spell every place out as a flat wall of buttons that stopped
scaling the moment a world grew past a screen. The LocationPicker replaces it
with a searchable, collapsible tree. This drives the behaviour that matters:
type to find a place anywhere in the world, pick it, and the board narrows to
that place AND everything beneath it — because "show me Barovia" means the whole
region, not just notices pinned to the region's own name.
*/
test("the board's place picker searches, then filters to a place and its descendants (#290)", async ({
  page,
}) => {
  await page.goto("/");
  await registerViaAPI(page.request, newAccount("boarddm"));
  const campaign = await createCampaign(page.request, unique("Board "));

  const barovia = await createLocation(page.request, campaign.id, "Barovia");
  const castle = await createLocation(page.request, campaign.id, "Castle Ravenloft", barovia);
  const mordent = await createLocation(page.request, campaign.id, "Mordent");

  const post = (title: string, locationId: string | null) =>
    page.request.post(`/api/campaigns/${campaign.id}/quests`, {
      data: {
        title, description: "A notice.", giver: "", location: "", locationId,
        visibleToParty: true, difficulty: "medium", status: "available", rewards: [],
      },
    });
  await post("Slay the count", castle); // deep inside Barovia
  await post("A Mordent haunting", mordent);
  await post("An unpinned errand", null);

  await page.goto(`/questboard/campaigns/${campaign.id}/board`);
  await expect(page.getByRole("heading", { name: "The Quest Board" })).toBeVisible({
    timeout: 30_000,
  });

  // Everywhere: all three notices are on the board.
  await expect(page.getByText("Slay the count")).toBeVisible();
  await expect(page.getByText("A Mordent haunting")).toBeVisible();
  await expect(page.getByText("An unpinned errand")).toBeVisible();

  // Open the picker, type to find Barovia, and choose it.
  await page.getByRole("button", { name: /Everywhere/ }).click();
  await page.getByPlaceholder("Search places…").fill("barovia");
  await page.getByRole("button", { name: /^Barovia/ }).click();

  // The board now shows only Barovia's subtree — the notice in Castle Ravenloft
  // (a child) stays; Mordent and the unpinned one fall away.
  await expect(page.getByText("Slay the count")).toBeVisible();
  await expect(page.getByText("A Mordent haunting")).toHaveCount(0);
  await expect(page.getByText("An unpinned errand")).toHaveCount(0);

  // The trigger reads the chosen place, and the filter rides in the URL so a
  // reload keeps it.
  await expect(page.getByRole("button", { name: /^Barovia/ })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Slay the count")).toBeVisible();
  await expect(page.getByText("A Mordent haunting")).toHaveCount(0);
});
