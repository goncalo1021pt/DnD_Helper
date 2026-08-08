/*
 * The shops of a campaign (#102), and the till that takes money (#174).
 *
 * Every write answers with the whole shop rather than the row it touched, so
 * there is one shape to cache and one to render — a reveal that came back as a
 * bare line would leave the page guessing where to put it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { StockInput, StockPatch, VendorInput } from "../api/client";

export function useVendors(campaignId: string) {
  return useQuery({
    queryKey: ["vendors", campaignId],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns/{campaignId}/vendors", {
        params: { path: { campaignId } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Every mutation here lands on the same list, so they share one invalidation. */
function useVendorMutation<TVars>(
  campaignId: string,
  run: (vars: TVars) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendors", campaignId] }),
  });
}

export function useCreateVendor(campaignId: string) {
  return useVendorMutation(campaignId, async (body: VendorInput) => {
    const { data, error } = await api.POST("/campaigns/{campaignId}/vendors", {
      params: { path: { campaignId } },
      body,
    });
    if (error) throw error;
    return data;
  });
}

export function useUpdateVendor(campaignId: string) {
  return useVendorMutation(
    campaignId,
    async (vars: { vendorId: string; body: VendorInput }) => {
      const { data, error } = await api.PATCH("/vendors/{vendorId}", {
        params: { path: { vendorId: vars.vendorId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
  );
}

export function useDeleteVendor(campaignId: string) {
  return useVendorMutation(campaignId, async (vendorId: string) => {
    const { error } = await api.DELETE("/vendors/{vendorId}", {
      params: { path: { vendorId } },
    });
    if (error) throw error;
  });
}

export function useAddStock(campaignId: string) {
  return useVendorMutation(
    campaignId,
    async (vars: { vendorId: string; body: StockInput }) => {
      const { data, error } = await api.POST("/vendors/{vendorId}/stock", {
        params: { path: { vendorId: vars.vendorId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
  );
}

export function useUpdateStock(campaignId: string) {
  return useVendorMutation(
    campaignId,
    async (vars: { stockId: string; body: StockPatch }) => {
      const { data, error } = await api.PATCH("/stock/{stockId}", {
        params: { path: { stockId: vars.stockId } },
        body: vars.body,
      });
      if (error) throw error;
      return data;
    },
  );
}

export function useDeleteStock(campaignId: string) {
  return useVendorMutation(campaignId, async (stockId: string) => {
    const { error } = await api.DELETE("/stock/{stockId}", {
      params: { path: { stockId } },
    });
    if (error) throw error;
  });
}

/**
 * Buy one of a line (#174). Stands apart from the shared wrapper because a
 * purchase moves more than the shop: the buyer's purse and pack change too,
 * so their character caches refresh alongside the shelves.
 */
export function useBuyStock(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { stockId: string; characterId: string }) => {
      const { data, error } = await api.POST("/stock/{stockId}/buy", {
        params: { path: { stockId: vars.stockId } },
        body: { characterId: vars.characterId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["vendors", campaignId] });
      qc.invalidateQueries({ queryKey: ["character-detail", vars.characterId] });
      qc.invalidateQueries({ queryKey: ["characters"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
