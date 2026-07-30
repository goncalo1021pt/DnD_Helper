/*
 * Account-level heroes — the My Heroes shelf, and seating them at a table.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CharacterInput } from "../api/client";

export function useMyCharacters() {
  return useQuery({
    queryKey: ["my-characters"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/characters");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateMyCharacter() {
  const qc = useQueryClient();
  return useMutation({
    // Quiet: CharacterForm prints the server's wording under the field it belongs to.
    meta: { quiet: true },
    mutationFn: async (body: CharacterInput) => {
      const { data, error } = await api.POST("/me/characters", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-characters"] }),
  });
}

export function useSeatCharacter() {
  const qc = useQueryClient();
  return useMutation({
    // Quiet: SeatConflictModal lists exactly which content the codex refused, on both doors into a table (#128).
    meta: { quiet: true },
    mutationFn: async ({
      characterId,
      campaignId,
    }: {
      characterId: string;
      campaignId: string | null;
    }) => {
      const { data, error, response } = await api.PUT("/characters/{characterId}/seat", {
        params: { path: { characterId } },
        body: { campaignId },
      });
      if (error) throw error;
      // 202: the door is barred — the request waits for the DM's nod.
      return { data, pending: response.status === 202 };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["my-seat-requests"] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["character-detail", vars.characterId] });
    },
  });
}

// --- Rules content + the forge ---
