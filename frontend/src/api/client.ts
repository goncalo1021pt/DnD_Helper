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
export type RulesKind = "class" | "species" | "background";
export type ForgeRequest =
  paths["/me/characters/forge"]["post"]["requestBody"]["content"]["application/json"];
export type AbilityScores = ForgeRequest["abilities"];
