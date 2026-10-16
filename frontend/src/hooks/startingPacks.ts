/*
Starting packs (#390): what a DM may hand a hero as their start, and the packs
a table writes for itself.
*/

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CustomPackInput } from "../api/client";

/** The books' options for this hero's class and background, and the table's own. */
export function useStartingPacks(characterId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["starting-packs", characterId],
    enabled: !!characterId && enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/characters/{characterId}/starting-packs", {
        params: { path: { characterId: characterId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCampaignPacks(campaignId: string) {
  return useQuery({
    queryKey: ["campaign-packs", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/packs", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

function useInvalidatePacks(campaignId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["campaign-packs", campaignId] });
    qc.invalidateQueries({ queryKey: ["starting-packs"] });
  };
}

export function useSavePack(campaignId: string) {
  const done = useInvalidatePacks(campaignId);
  return useMutation({
    mutationFn: async ({ packId, body }: { packId?: string; body: CustomPackInput }) => {
      if (packId) {
        const { data, error } = await api.PUT("/campaigns/{campaignId}/packs/{packId}", {
          params: { path: { campaignId, packId } },
          body,
        });
        if (error) throw error;
        return data;
      }
      const { data, error } = await api.POST("/campaigns/{campaignId}/packs", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: done,
  });
}

export function useDeletePack(campaignId: string) {
  const done = useInvalidatePacks(campaignId);
  return useMutation({
    mutationFn: async (packId: string) => {
      const { error } = await api.DELETE("/campaigns/{campaignId}/packs/{packId}", {
        params: { path: { campaignId, packId } },
      });
      if (error) throw error;
    },
    onSuccess: done,
  });
}
