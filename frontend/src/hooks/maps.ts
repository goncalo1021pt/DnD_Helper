/*
 * Battle maps, pins, sub-maps, and the fog composited server-side.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { MapPinInput, MapShapeInput, SetVisibilityInput } from "../api/client";

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
      locationId?: string;
      // Omitted means hidden (#276): a new map is the DM's until they say.
      visibleToParty?: boolean;
    }) => {
      const { data, error } = await api.POST("/campaigns/{campaignId}/maps", {
        params: { path: { campaignId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maps", campaignId] }),
  });
}

/*
The veil over a map's existence (#276). Both doors answer with the map as it
now stands, and both invalidate the atlas AND that map's detail: revealing one
changes what a player's shelf holds, and hiding one changes whether the page
they are standing on still answers at all.
*/
function useMapVeilMutation<V>(
  campaignId: string,
  mutationFn: (vars: V) => Promise<unknown>,
  mapIdOf: (vars: V) => string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["maps", campaignId] });
      qc.invalidateQueries({ queryKey: ["map", mapIdOf(vars)] });
    },
  });
}

export function useSetMapVisibility(campaignId: string) {
  return useMapVeilMutation(
    campaignId,
    async (vars: { mapId: string; body: SetVisibilityInput }) => {
      const { data, error } = await api.PUT("/maps/{mapId}/visibility", {
        params: { path: { mapId: vars.mapId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
    (v) => v.mapId,
  );
}

// Dropping a hero's exception puts them back on whatever the table sees.
export function useClearMapOverride(campaignId: string) {
  return useMapVeilMutation(
    campaignId,
    async (vars: { mapId: string; characterId: string }) => {
      const { data, error } = await api.DELETE("/maps/{mapId}/visibility/{characterId}", {
        params: { path: { mapId: vars.mapId, characterId: vars.characterId } },
      });
      if (error) throw error;
      return data;
    },
    (v) => v.mapId,
  );
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
      // locationId: the place this map depicts (#229) — the nil UUID unfiles,
      // absent means unchanged.
      body: { name: string; parentMapId?: string; fogEnabled?: boolean; locationId?: string };
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
      locationId?: string;
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

/*
 * Tie a batch to a place after the fact, or cut it loose. The circles are the
 * DM's drawing — deciding later that the eastern road was really "knowledge of
 * Vale" should not mean stamping it all over again.
 */
export function useSetRevealLocation(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { batchId: string; locationId: string | null }) => {
      const { data, error } = await api.PATCH("/reveals/{batchId}", {
        params: { path: { batchId: vars.batchId } },
        body: { locationId: vars.locationId },
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

/*
 * Roads and regions drawn on a map (#262).
 *
 * Both are the same thing to the server — an ordered run of points, stroked or
 * filled — so one set of hooks serves the street tool and the kingdom overlay,
 * and every one of them re-reads the map detail, which is where shapes arrive
 * already filtered for the caller.
 */
function useShapeMutation<TVars>(mapId: string, run: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["map", mapId] }),
  });
}

export function useCreateMapShape(mapId: string) {
  return useShapeMutation(mapId, async (body: MapShapeInput) => {
    const { data, error } = await api.POST("/maps/{mapId}/shapes", {
      params: { path: { mapId } },
      body,
    });
    if (error) throw error;
    return data;
  });
}

export function useUpdateMapShape(mapId: string) {
  return useShapeMutation(mapId, async (vars: { shapeId: string; body: MapShapeInput }) => {
    const { data, error } = await api.PATCH("/shapes/{shapeId}", {
      params: { path: { shapeId: vars.shapeId } },
      body: vars.body,
    });
    if (error) throw error;
    return data;
  });
}

export function useDeleteMapShape(mapId: string) {
  return useShapeMutation(mapId, async (shapeId: string) => {
    const { error } = await api.DELETE("/shapes/{shapeId}", {
      params: { path: { shapeId } },
    });
    if (error) throw error;
  });
}
