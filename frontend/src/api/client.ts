import createClient from "openapi-fetch";
import type { paths } from "./schema";

// Single typed API client. baseUrl "/api" matches the OpenAPI server url; cookies
// are same-origin (dev proxy + prod embed) so the session rides along automatically.
export const api = createClient<paths>({ baseUrl: "/api" });

// Convenience aliases for the generated component schemas.
export type CurrentUser = NonNullable<
  paths["/me"]["get"]["responses"]["200"]["content"]["application/json"]
>;
export type CampaignMembership =
  paths["/campaigns"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type Campaign = CampaignMembership["campaign"];
export type Role = CampaignMembership["role"];

export type Quest =
  paths["/campaigns/{campaignId}/quests"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type QuestReward = Quest["rewards"][number];
export type QuestClaim = Quest["claims"][number];
export type QuestStatus = Quest["status"];
export type QuestDifficulty = Quest["difficulty"];
export type RewardType = QuestReward["type"];
export type CreateQuestInput =
  paths["/campaigns/{campaignId}/quests"]["post"]["requestBody"]["content"]["application/json"];
export type UpdateQuestInput =
  paths["/quests/{questId}"]["patch"]["requestBody"]["content"]["application/json"];
export type RewardInput = NonNullable<CreateQuestInput["rewards"]>[number];

export type Character =
  paths["/campaigns/{campaignId}/characters"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type CharacterInput =
  paths["/campaigns/{campaignId}/characters"]["post"]["requestBody"]["content"]["application/json"];

export type SkillTree =
  paths["/campaigns/{campaignId}/trees"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type SkillTreeInput =
  paths["/campaigns/{campaignId}/trees"]["post"]["requestBody"]["content"]["application/json"];
export type SkillTreeDetail =
  paths["/trees/{treeId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type SkillNode = SkillTreeDetail["nodes"][number];
export type SkillEdge = SkillTreeDetail["edges"][number];
export type SkillNodeInput =
  paths["/trees/{treeId}/nodes"]["post"]["requestBody"]["content"]["application/json"];
export type CharacterTreeState =
  paths["/characters/{characterId}/tree"]["get"]["responses"]["200"]["content"]["application/json"];

export type RulesContent =
  paths["/rules/{kind}"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type RulesKind = "class" | "species" | "background" | "subclass" | "feat" | "spell" | "item" | "monster";
export type RulesContentInput =
  paths["/rules/{kind}"]["post"]["requestBody"]["content"]["application/json"];
export type LevelUpRequest =
  paths["/characters/{characterId}/levelup"]["post"]["requestBody"]["content"]["application/json"];
export type CharacterDetail =
  paths["/characters/{characterId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type InventoryItem =
  paths["/characters/{characterId}/items"]["post"]["responses"]["201"]["content"]["application/json"];
export type InventoryItemInput =
  paths["/characters/{characterId}/items"]["post"]["requestBody"]["content"]["application/json"];
export type SpellSlot = NonNullable<
  NonNullable<Character["sheet"]>["spellSlots"]
>[number];
export type ImportReport =
  paths["/rules/import"]["post"]["responses"]["200"]["content"]["application/json"];
export type HomebrewImpact =
  paths["/rules/homebrew/impact"]["get"]["responses"]["200"]["content"]["application/json"];
export type HomebrewImpactRow = HomebrewImpact["byKind"][number];
export type HomebrewBooks =
  paths["/rules/homebrew/books"]["get"]["responses"]["200"]["content"]["application/json"];
export type HomebrewBookRow = HomebrewBooks["rows"][number];
export type ChronicleEvent =
  paths["/campaigns/{campaignId}/events"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type CodexEntry =
  paths["/campaigns/{campaignId}/codex"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type SeatConflict =
  paths["/characters/{characterId}/seat"]["put"]["responses"]["409"]["content"]["application/json"];
export type ForgeRequest =
  paths["/me/characters/forge"]["post"]["requestBody"]["content"]["application/json"];
export type AbilityScores = ForgeRequest["abilities"];
export type CampaignMap =
  paths["/campaigns/{campaignId}/maps"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type MapDetail =
  paths["/maps/{mapId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type MapPin = MapDetail["pins"][number];
export type MapPinInput =
  paths["/maps/{mapId}/pins"]["post"]["requestBody"]["content"]["application/json"];
export type RevealCircle = MapDetail["revealed"][number];
export type RevealBatch =
  paths["/maps/{mapId}/reveals"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type Encounter =
  paths["/campaigns/{campaignId}/encounters"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type EncounterDetail =
  paths["/campaigns/{campaignId}/encounters/active"]["get"]["responses"]["200"]["content"]["application/json"];
export type Combatant = EncounterDetail["combatants"][number];
export type AddCombatantInput =
  paths["/encounters/{encounterId}/combatants"]["post"]["requestBody"]["content"]["application/json"];
export type BestiaryEntry =
  paths["/campaigns/{campaignId}/bestiary"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type BestiaryNote = BestiaryEntry["notes"][number];
export type BestiarySection = BestiaryEntry["revealed"][number];
