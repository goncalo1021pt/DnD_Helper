/*
 * One box over a table (#321). The server composes the answer from the same
 * list doors the screens read, so whatever comes back is already what this
 * viewer may see — the client only asks and shows.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export const SEARCH_MIN = 2;

export function useCampaignSearch(campaignId: string, q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ["search", campaignId, query],
    enabled: query.length >= SEARCH_MIN,
    staleTime: 30_000,
    // Keep the last answer on screen while the next keystroke is asked, so the
    // list does not blink empty between letters.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/search", {
        params: { path: { campaignId }, query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
  });
}
