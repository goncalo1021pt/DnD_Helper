/*
 * Realms: the ground a campaign stands on, and outlives it (#233).
 *
 * Stage one is the container only — nothing is shared between two campaigns in
 * one realm — so these hooks touch remarkably little. What they do all touch is
 * the campaign listing, because a realm is *read* off the campaign (its name
 * rides along for everyone) while being *listed* only to its owner. Rename one
 * and every campaign standing in it is now labelled differently.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/** Your own realms, including empty ones — an emptied realm is where the next campaign begins. */
export function useRealms() {
  return useQuery({
    queryKey: ["realms"],
    queryFn: async () => {
      const { data, error } = await api.GET("/realms", {});
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Every realm write relabels campaigns, so the listing and /me are re-read. */
function useRealmMutation<TVars>(run: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["realms"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useRenameRealm() {
  return useRealmMutation(async ({ realmId, name }: { realmId: string; name: string }) => {
    const { data, error } = await api.PATCH("/realms/{realmId}", {
      params: { path: { realmId } },
      body: { name },
    });
    if (error) throw error;
    return data;
  });
}

export function useDeleteRealm() {
  return useRealmMutation(async (realmId: string) => {
    const { error } = await api.DELETE("/realms/{realmId}", {
      params: { path: { realmId } },
    });
    if (error) throw error;
  });
}

/**
 * Move a campaign onto other ground. The nil UUID sends it back to a realm of
 * its own — freshly made and named after the campaign, the same thing founding
 * a table does by default.
 */
export function useSetCampaignRealm() {
  return useRealmMutation(
    async ({ campaignId, realmId }: { campaignId: string; realmId: string }) => {
      const { data, error } = await api.PUT("/campaigns/{campaignId}/realm", {
        params: { path: { campaignId } },
        body: { realmId },
      });
      if (error) throw error;
      return data;
    },
  );
}
