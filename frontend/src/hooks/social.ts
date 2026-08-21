/*
 * Friends, and talking to them (#181).
 *
 * Campaign chat already existed and is called the Chronicle. These are the two
 * rooms it never covered: one person, and one party.
 *
 * Almost every friends door answers with the WHOLE roll rather than the thing
 * it changed, so a client never has to reason about what asking, accepting,
 * parting or blocking did to the other two shelves — it just takes the answer.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { FriendRoll } from "../api/client";

export function useFriends() {
  return useQuery({
    queryKey: ["friends"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/friends", {});
      if (error) throw error;
      return data;
    },
  });
}

/** Every friends act answers with the roll, so the cache takes it directly. */
function useRollMutation<TVars>(run: (vars: TVars) => Promise<FriendRoll | undefined>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (roll) => {
      if (roll) qc.setQueryData(["friends"], roll);
      // Who you may message follows from who you are friends with.
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useAskFriend() {
  return useRollMutation(async (friendCode: string) => {
    const { data, error } = await api.POST("/me/friends", { body: { friendCode } });
    if (error) throw error;
    return data;
  });
}

export function useReforgeFriendCode() {
  return useRollMutation(async () => {
    const { data, error } = await api.POST("/me/friends/code", {});
    if (error) throw error;
    return data;
  });
}

export function useAcceptFriend() {
  return useRollMutation(async (userId: string) => {
    const { data, error } = await api.PUT("/me/friends/{userId}", {
      params: { path: { userId } },
    });
    if (error) throw error;
    return data;
  });
}

export function useDropFriend() {
  return useRollMutation(async (userId: string) => {
    const { data, error } = await api.DELETE("/me/friends/{userId}", {
      params: { path: { userId } },
    });
    if (error) throw error;
    return data;
  });
}

export function useBlockUser() {
  return useRollMutation(async (userId: string) => {
    const { data, error } = await api.PUT("/me/blocks/{userId}", {
      params: { path: { userId } },
    });
    if (error) throw error;
    return data;
  });
}

export function useUnblockUser() {
  return useRollMutation(async (userId: string) => {
    const { data, error } = await api.DELETE("/me/blocks/{userId}", {
      params: { path: { userId } },
    });
    if (error) throw error;
    return data;
  });
}

/** The inbox: one row per person spoken with, newest first. */
export function useThreads() {
  return useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data, error } = await api.GET("/me/messages", {});
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** One conversation. Reading it is what marks it read, so the inbox follows. */
export function useThread(userId: string | null) {
  return useQuery({
    queryKey: ["thread", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await api.GET("/me/messages/{userId}", {
        params: { path: { userId: userId! } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSendDirectMessage(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { data, error } = await api.POST("/me/messages/{userId}", {
        params: { path: { userId } },
        body: { body },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["thread", userId] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function usePartyMessages(partyId: string | null) {
  return useQuery({
    queryKey: ["party-messages", partyId],
    enabled: !!partyId,
    queryFn: async () => {
      const { data, error } = await api.GET("/parties/{partyId}/messages", {
        params: { path: { partyId: partyId! } },
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSendPartyMessage(partyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { data, error } = await api.POST("/parties/{partyId}/messages", {
        params: { path: { partyId } },
        body: { body },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["party-messages", partyId] }),
  });
}
