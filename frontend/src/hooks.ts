import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";

// Current user (or null when unauthenticated). A 401 is an expected, non-error
// state for the login gate.
export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/me");
      if (response.status === 401) return null;
      if (error) throw error;
      return data ?? null;
    },
  });
}

export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await api.GET("/campaigns");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/campaigns", { body: { name } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// Logout lives outside the OpenAPI surface (auth routes), so call it directly.
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
