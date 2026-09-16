/*
 * API tokens (#294): the doors a script or an assistant walks through as you.
 *
 * Session-only on the wire — a token cannot list, mint or revoke tokens — so
 * these hooks are only ever driven from the profile in a browser.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ApiTokenInput } from "../api/client";

export function useApiTokens() {
  return useQuery({
    queryKey: ["apiTokens"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/tokens");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApiTokenInput) => {
      const { data, error } = await api.POST("/me/tokens", { body: input });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiTokens"] }),
  });
}

export function useRevokeApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string) => {
      const { error } = await api.DELETE("/me/tokens/{tokenId}", { params: { path: { tokenId } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiTokens"] }),
  });
}
