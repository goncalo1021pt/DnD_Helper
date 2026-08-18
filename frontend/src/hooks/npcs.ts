/*
 * The people of a campaign (#215), and the two veils over them — who knows a
 * person, and who may read their numbers.
 *
 * Every write answers with the whole person rather than the row it touched,
 * so there is one shape to cache and one to render, like the shops.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CharacterInput, NpcInput, SetVisibilityInput } from "../api/client";

export function useNpcs(campaignId: string) {
  return useQuery({
    queryKey: ["npcs", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/npcs", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Every mutation here lands on the same list, so they share one invalidation. */
function useNpcMutation<TVars>(
  campaignId: string,
  run: (vars: TVars) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["npcs", campaignId] }),
  });
}

export function useCreateNpc(campaignId: string) {
  return useNpcMutation(campaignId, async (body: NpcInput) => {
    const { data, error } = await api.POST("/campaigns/{campaignId}/npcs", {
      params: { path: { campaignId } },
      body,
    });
    if (error) throw error;
    return data;
  });
}

export function useUpdateNpc(campaignId: string) {
  return useNpcMutation(
    campaignId,
    async (vars: { npcId: string; body: NpcInput }) => {
      const { data, error } = await api.PATCH("/npcs/{npcId}", {
        params: { path: { npcId: vars.npcId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
  );
}

/*
 * Forging a sheet for one of the Folk (#227). It lands on the npcs list like
 * every other write here — but it also makes a character, and the roster is
 * pointedly *not* invalidated, because a body never appears on it.
 */
export function useForgeNpcBody(campaignId: string) {
  return useNpcMutation(
    campaignId,
    async (vars: { npcId: string; body: CharacterInput }) => {
      const { data, error } = await api.POST("/npcs/{npcId}/body", {
        params: { path: { npcId: vars.npcId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
  );
}

export function useDeleteNpc(campaignId: string) {
  return useNpcMutation(campaignId, async (npcId: string) => {
    const { error } = await api.DELETE("/npcs/{npcId}", {
      params: { path: { npcId } },
    });
    if (error) throw error;
  });
}

export function useSetNpcVisibility(campaignId: string) {
  return useNpcMutation(
    campaignId,
    async (vars: { npcId: string; body: SetVisibilityInput }) => {
      const { data, error } = await api.PUT("/npcs/{npcId}/visibility", {
        params: { path: { npcId: vars.npcId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
  );
}

// Dropping a hero's exception puts them back on whatever the party sees.
export function useClearNpcOverride(campaignId: string) {
  return useNpcMutation(
    campaignId,
    async (vars: { npcId: string; characterId: string }) => {
      const { data, error } = await api.DELETE("/npcs/{npcId}/visibility/{characterId}", {
        params: { path: { npcId: vars.npcId, characterId: vars.characterId } },
      });
      if (error) throw error;
      return data;
    },
  );
}

export function useSetNpcStatsVisibility(campaignId: string) {
  return useNpcMutation(
    campaignId,
    async (vars: { npcId: string; body: SetVisibilityInput }) => {
      const { data, error } = await api.PUT("/npcs/{npcId}/stats-visibility", {
        params: { path: { npcId: vars.npcId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
  );
}

export function useClearNpcStatsOverride(campaignId: string) {
  return useNpcMutation(
    campaignId,
    async (vars: { npcId: string; characterId: string }) => {
      const { data, error } = await api.DELETE("/npcs/{npcId}/stats-visibility/{characterId}", {
        params: { path: { npcId: vars.npcId, characterId: vars.characterId } },
      });
      if (error) throw error;
      return data;
    },
  );
}
