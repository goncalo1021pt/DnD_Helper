/*
 * Content-as-data: the rules library, a hero's sheet, and the Forge that
 * builds one. Also level-ups, spells, and inventory.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  InventoryItemInput,
  ForgeRequest,
  LevelUpRequest,
  RulesContentInput,
  RulesKind,
} from "../api/client";

export function useRules(kind: RulesKind, enabled = true) {
  return useQuery({
    queryKey: ["rules", kind],
    enabled,
    staleTime: 5 * 60_000, // rules change on deploy, not per click
    queryFn: async () => {
      const { data, error } = await api.GET("/rules/{kind}", {
        params: { path: { kind } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

const ALL_KINDS: RulesKind[] = [
  "class", "subclass", "species", "background", "feat", "spell", "item",
];

/** Every visible rules entry across all kinds — for codex-wide rulings. */
export function useAllRules() {
  return useQueries({
    queries: ALL_KINDS.map((kind) => ({
      queryKey: ["rules", kind],
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const { data, error } = await api.GET("/rules/{kind}", {
          params: { path: { kind } },
        });
        if (error) throw error;
        return data ?? [];
      },
    })),
    combine: (results) => results.flatMap((r) => r.data ?? []),
  });
}

export function useCharacterDetail(characterId: string | undefined) {
  return useQuery({
    queryKey: ["character-detail", characterId],
    enabled: !!characterId,
    queryFn: async () => {
      const { data, error } = await api.GET("/characters/{characterId}", {
        params: { path: { characterId: characterId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useSetSpellSlots(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (used: number[]) => {
      const { data, error } = await api.PUT("/characters/{characterId}/slots", {
        params: { path: { characterId } },
        body: { used },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
    },
  });
}

/**
 * Trade prepared spells after a Long Rest. The server is the authority on
 * whether this hero's class may do it at all and how many — see the class
 * data's spellChanges rule.
 */
export function useSwapSpells(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (swaps: Array<{ replace: string; with: string }>) => {
      const { data, error } = await api.POST("/characters/{characterId}/spells/swap", {
        params: { path: { characterId } },
        body: { swaps },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["my-characters"] });
    },
  });
}

export function useAddItem(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: InventoryItemInput) => {
      const { data, error } = await api.POST("/characters/{characterId}/items", {
        params: { path: { characterId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useUpdateItem(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      itemId: string;
      qty?: number;
      equipped?: boolean;
      slot?: "armor" | "mainhand" | "offhand";
    }) => {
      const { data, error } = await api.PATCH(
        "/characters/{characterId}/items/{itemId}",
        {
          params: { path: { characterId, itemId: vars.itemId } },
          body: { qty: vars.qty, equipped: vars.equipped, slot: vars.slot },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useDeleteItem(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await api.DELETE(
        "/characters/{characterId}/items/{itemId}",
        { params: { path: { characterId, itemId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-detail", characterId] }),
  });
}

export function useCreateRules(kind: RulesKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RulesContentInput) => {
      const { data, error } = await api.POST("/rules/{kind}", {
        params: { path: { kind } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules", kind] }),
  });
}

export function useUpdateRules(kind: RulesKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { contentId: string; body: RulesContentInput }) => {
      const { data, error } = await api.PUT("/rules/content/{contentId}", {
        params: { path: { contentId: vars.contentId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules", kind] }),
  });
}

export function useDeleteRules(kind: RulesKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contentId: string) => {
      const { error } = await api.DELETE("/rules/content/{contentId}", {
        params: { path: { contentId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules", kind] }),
  });
}

export function useLevelUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { characterId: string; body: LevelUpRequest }) => {
      const { data, error } = await api.POST("/characters/{characterId}/levelup", {
        params: { path: { characterId: vars.characterId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["my-characters"] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["character-detail", vars.characterId] });
    },
  });
}

export function useForgeCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ForgeRequest) => {
      const { data, error } = await api.POST("/me/characters/forge", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-characters"] }),
  });
}

// --- Skill trees ---
