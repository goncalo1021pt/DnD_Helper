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
