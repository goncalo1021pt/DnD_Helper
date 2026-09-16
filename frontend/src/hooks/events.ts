/*
 * The event catalogue's feed (#315): what was emitted at a table, newest
 * first, with who was told. DM only. No screen reads it yet — the webhook
 * picker (#295) and a table's activity view will — but the hook sits where
 * every endpoint's does, so the client and the contract stay one thing.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useCampaignFeed(campaignId: string, limit = 50) {
  return useQuery({
    queryKey: ["feed", campaignId, limit],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/feed", {
        params: { path: { campaignId }, query: { limit } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
