/*
 * A hero's second stat blocks — forms they take, companions that fight beside
 * them, summons that last an encounter.
 *
 * The creatures themselves ride down with the sheet (`character-detail`), so
 * every mutation here invalidates that one key rather than keeping a list of
 * its own. `useCreatureOptions` is the separate read: what the hero's features
 * grant, which is the only door a player has into monster stat blocks.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CreatureInput, CreaturePatch } from "../api/client";

export function useCreatureOptions(characterId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["creature-options", characterId],
    enabled: Boolean(characterId) && enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/characters/{characterId}/creature-options", {
        params: { path: { characterId: characterId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddCreature(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatureInput) => {
      const { data, error } = await api.POST("/characters/{characterId}/creatures", {
        params: { path: { characterId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useUpdateCreature(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ creatureId, ...body }: CreaturePatch & { creatureId: string }) => {
      const { data, error } = await api.PATCH(
        "/characters/{characterId}/creatures/{creatureId}",
        { params: { path: { characterId, creatureId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useDeleteCreature(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (creatureId: string) => {
      const { error } = await api.DELETE("/characters/{characterId}/creatures/{creatureId}", {
        params: { path: { characterId, creatureId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}
