/*
 * Battle maps, pins, sub-maps, and the fog composited server-side.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { slowUpload } from "../lib/http";
import type { MapPinInput } from "../api/client";

export function useMaps(campaignId: string) {
  return useQuery({
    queryKey: ["maps", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/maps", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateMap(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      imageBase64: string;
      parentMapId?: string;
    }) => {
      // The image rides in the body as base64, so this is the one call that is
      // slow on purpose rather than stuck. See slowUpload() in lib/http.ts.
      const { data, error } = await api.POST("/campaigns/{campaignId}/maps", {
        params: { path: { campaignId } },
        body,
        ...slowUpload(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maps", campaignId] }),
  });
}

export function useMapDetail(mapId: string | undefined) {
  return useQuery({
    queryKey: ["map", mapId],
    enabled: !!mapId,
    queryFn: async () => {
      const { data, error } = await api.GET("/maps/{mapId}", {
        params: { path: { mapId: mapId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateMap(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      mapId: string;
      body: { name: string; parentMapId?: string; fogEnabled?: boolean };
    }) => {
      const { data, error } = await api.PATCH("/maps/{mapId}", {
        params: { path: { mapId: vars.mapId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["maps", campaignId] });
      qc.invalidateQueries({ queryKey: ["map", vars.mapId] });
    },
  });
}

export function useDeleteMap(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mapId: string) => {
      const { error } = await api.DELETE("/maps/{mapId}", {
        params: { path: { mapId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maps", campaignId] }),
  });
}

export function useCreateMapPin(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MapPinInput) => {
      const { data, error } = await api.POST("/maps/{mapId}/pins", {
        params: { path: { mapId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", mapId] }),
  });
}

export function useUpdateMapPin(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pinId: string; body: MapPinInput }) => {
      const { data, error } = await api.PATCH("/pins/{pinId}", {
        params: { path: { pinId: vars.pinId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", mapId] }),
  });
}

export function useDeleteMapPin(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pinId: string) => {
      const { error } = await api.DELETE("/pins/{pinId}", {
        params: { path: { pinId } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", mapId] }),
  });
}

export function useRevealBatches(mapId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["reveals", mapId],
    enabled: !!mapId && enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/maps/{mapId}/reveals", {
        params: { path: { mapId: mapId! } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useSubmitReveals(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      note?: string;
      circles: { x: number; y: number; r: number }[];
    }) => {
      const { data, error } = await api.POST("/maps/{mapId}/reveals", {
        params: { path: { mapId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map", mapId] });
      qc.invalidateQueries({ queryKey: ["reveals", mapId] });
    },
  });
}

export function useDeleteReveals(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await api.DELETE("/reveals/{batchId}", {
        params: { path: { batchId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map", mapId] });
      qc.invalidateQueries({ queryKey: ["reveals", mapId] });
    },
  });
}

// ── Encounters ───────────────────────────────────────────────────────────
