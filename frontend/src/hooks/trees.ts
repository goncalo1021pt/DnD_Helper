/*
 * Custom skill trees: the Loom that designs them, and the pacts and picks that
 * spend them.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SkillEdge, SkillNodeInput, SkillTreeInput } from "../api/client";

export function useTrees(campaignId: string) {
  return useQuery({
    queryKey: ["trees", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/trees", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateTree(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SkillTreeInput) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/trees", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trees", campaignId] }),
  });
}

export function useTree(treeId: string) {
  return useQuery({
    queryKey: ["tree", treeId],
    queryFn: async () => {
      const { data, error } = await api.GET("/trees/{treeId}", {
        params: { path: { treeId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateTree(campaignId: string, treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SkillTreeInput) => {
      const { data, error } = await api.PATCH("/trees/{treeId}", {
        params: { path: { treeId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tree", treeId] });
      qc.invalidateQueries({ queryKey: ["trees", campaignId] });
    },
  });
}

export function useDeleteTree(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (treeId: string) => {
      const { error } = await api.DELETE("/trees/{treeId}", {
        params: { path: { treeId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trees", campaignId] }),
  });
}

export function useCreateNode(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SkillNodeInput) => {
      const { data, error } = await api.POST("/trees/{treeId}/nodes", {
        params: { path: { treeId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useUpdateNode(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nodeId, body }: { nodeId: string; body: SkillNodeInput }) => {
      const { data, error } = await api.PATCH("/nodes/{nodeId}", {
        params: { path: { nodeId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useDeleteNode(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      const { error } = await api.DELETE("/nodes/{nodeId}", {
        params: { path: { nodeId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useSetEdges(treeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (edges: SkillEdge[]) => {
      const { data, error } = await api.PUT("/trees/{treeId}/edges", {
        params: { path: { treeId } },
        body: { edges },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tree", treeId] }),
  });
}

export function useCharacterTree(characterId: string) {
  return useQuery({
    queryKey: ["character-tree", characterId],
    queryFn: async () => {
      const { data, error } = await api.GET("/characters/{characterId}/tree", {
        params: { path: { characterId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useSetPact(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (treeId: string) => {
      const { data, error } = await api.PUT("/characters/{characterId}/tree", {
        params: { path: { characterId } },
        body: { treeId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-tree", characterId] }),
  });
}

export function useGrantPicks(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (picks: number) => {
      const { data, error } = await api.POST("/characters/{characterId}/tree/grants", {
        params: { path: { characterId } },
        body: { picks },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-tree", characterId] }),
  });
}

export function useSpendPick(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      const { data, error } = await api.POST("/characters/{characterId}/tree/picks", {
        params: { path: { characterId } },
        body: { nodeId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["character-tree", characterId] }),
  });
}

// --- The Bestiary ---------------------------------------------------------

// ── the Map ────────────────────────────────────────────────────────────────
