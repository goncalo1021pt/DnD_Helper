/*
 * Who is signed in, and the doors they came through.
 *
 * Logout and the 2FA routes are hand-rolled outside the OpenAPI surface, so they
 * use authPost rather than the generated client.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/http";
import { api } from "../api/client";

export interface AuthConfig {
  devLogin: boolean;
  localAuth: boolean;
  providers: string[];
  version?: string;
}

// Public endpoint describing which login options the backend actually offers.
// Lets a static SPA build render the right buttons (the build flag can't know
// the backend's mode). Lives outside the OpenAPI surface (auth routes).
export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth-config"],
    queryFn: async (): Promise<AuthConfig> => {
      const res = await apiFetch("/api/auth/config");
      if (!res.ok) throw new Error("failed to load auth config");
      return res.json();
    },
  });
}

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

// Logout lives outside the OpenAPI surface (auth routes), so call it directly.
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch("/api/auth/logout", { method: "POST" });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ── Two-factor auth (TOTP) ──────────────────────────────────────────────────
// These auth routes live outside the OpenAPI surface, so call them directly.
// A failed call throws with { status, data } so callers can read field errors.
type TwofaError = Error & { status: number; data: { field?: string; error?: string } };

async function authPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error("request failed"), { status: res.status, data }) as TwofaError;
  }
  return data as T;
}

export type TwofaSetup = { otpauthUrl: string; secret: string; qrPng: string };

export function useTwofaSetup() {
  return useMutation({ mutationFn: () => authPost<TwofaSetup>("/api/auth/2fa/setup") });
}

export function useTwofaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => authPost<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useTwofaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => authPost<Record<string, never>>("/api/auth/2fa/disable", { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
