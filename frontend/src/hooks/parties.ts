/*
 * Parties: named groups of heroes inside one campaign (#232).
 *
 * A party is a brush, not a gate — revealing something "to the Harbour Crew"
 * stamps the same per-hero exceptions the DM could have clicked one at a time.
 * So these mutations touch the roster and the veiled lists alike: a grant made
 * with a party lands as ordinary per-hero rows, and every list that shows them
 * has to be re-read.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { PartyInput } from "../api/client";

export function useParties(campaignId: string) {
  return useQuery({
    queryKey: ["parties", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/parties", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Forming, renaming and disbanding all change the roster's shape. */
function usePartyMutation<TVars>(campaignId: string, run: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parties", campaignId] });
      qc.invalidateQueries({ queryKey: ["characters", campaignId] });
    },
  });
}

export function useCreateParty(campaignId: string) {
  return usePartyMutation(campaignId, async (body: PartyInput) => {
    const { data, error } = await api.POST("/campaigns/{campaignId}/parties", {
      params: { path: { campaignId } },
      body,
    });
    if (error) throw error;
    return data;
  });
}

export function useRenameParty(campaignId: string) {
  return usePartyMutation(campaignId, async (vars: { partyId: string; body: PartyInput }) => {
    const { data, error } = await api.PATCH("/parties/{partyId}", {
      params: { path: { partyId: vars.partyId } },
      body: vars.body,
    });
    if (error) throw error;
    return data;
  });
}

export function useDeleteParty(campaignId: string) {
  return usePartyMutation(campaignId, async (partyId: string) => {
    const { error } = await api.DELETE("/parties/{partyId}", {
      params: { path: { partyId } },
    });
    if (error) throw error;
  });
}

export function useSetCharacterParty(campaignId: string) {
  return usePartyMutation(
    campaignId,
    async (vars: { characterId: string; partyId: string | null }) => {
      const { data, error } = await api.PUT("/characters/{characterId}/party", {
        params: { path: { characterId: vars.characterId } },
        body: { partyId: vars.partyId },
      });
      if (error) throw error;
      return data;
    },
  );
}
