/*
 * The table, live (#109).
 *
 * The encounter tracker polled every 8 seconds, so a DM advancing a turn was
 * news to the players up to 8 seconds later — long enough to be confusing when
 * someone is waiting to act.
 *
 * This opens one EventSource per campaign and turns each nudge into a query
 * invalidation. It deliberately does NOT push state: what arrives is a topic,
 * and TanStack refetches through the endpoint it already used, which is the
 * endpoint that knows what this viewer is allowed to see. A stream carrying
 * data would have to redo every redaction rule in the app — the encounter's
 * hidden combatants, the veil over other players' sheets, a shop's unrevealed
 * shelves — and the first one anybody forgot would broadcast the DM's secrets.
 *
 * The poll stays. Cloudflare tunnels and mobile networks both drop long-lived
 * connections, and EventSource's own reconnect is not something to bet a
 * session on — so a table that loses the stream degrades to exactly today's
 * behaviour instead of freezing.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Which cached queries each topic makes stale. */
const KEYS: Record<string, string[][]> = {
  encounter: [["encounter-active"], ["encounters"], ["encounter"]],
  chronicle: [["events"], ["handouts"]],
  quests: [["quests"]],
  map: [["reveals"], ["map"], ["maps"]],
  // Seat requests ride the party topic too, so the DM's door page hears the
  // knock and a waiting player hears the nod without a refresh (#247).
  party: [["characters"], ["character-detail"], ["my-characters"], ["seat-requests"], ["my-seat-requests"]],
  vendors: [["vendors"]],
  npcs: [["npcs"]],
  // A party room lives inside a campaign, so its nudge rides the campaign's
  // stream; the ones who may not read it are told nothing by a topic that
  // carries nothing (#181).
  // `me` carries the header's waiting count, so both topics make it stale.
  messages: [["party-messages"], ["threads"], ["thread"], ["me"]],
  friends: [["friends"], ["threads"], ["me"]],
};

/**
 * Listen to a campaign's stream for as long as this component is mounted.
 *
 * Safe to call from more than one place: the browser pools identical
 * EventSource URLs poorly, so the app calls it once, high up, in CampaignView.
 */
export function useLiveCampaign(campaignId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!campaignId) return;
    // Not available in older browsers and not worth a polyfill — the poll
    // underneath is the whole fallback story.
    if (typeof EventSource === "undefined") return;

    const source = new EventSource(`/api/campaigns/${campaignId}/events/stream`);

    const listeners: Array<[string, () => void]> = Object.entries(KEYS).map(
      ([topic, keys]) => [
        topic,
        () => {
          for (const key of keys) qc.invalidateQueries({ queryKey: key });
        },
      ],
    );
    for (const [topic, handler] of listeners) source.addEventListener(topic, handler);

    // EventSource retries on its own, and its errors are routine — a tunnel
    // hiccup, a phone changing masts. Nothing is reported to the player,
    // because from where they sit nothing has gone wrong: the poll keeps the
    // table in sync while the browser reconnects.
    source.onerror = () => {};

    return () => {
      for (const [topic, handler] of listeners) source.removeEventListener(topic, handler);
      source.close();
    };
  }, [campaignId, qc]);
}


/*
The account's own stream (#181).

Friendship and a direct message belong to a person rather than to a table, so
they travel in a room of their own — and one that has to be listened to from
anywhere in the app, not only inside a campaign. Mounted once, high up, beside
the campaign one.
*/
export function useLiveAccount(signedIn: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!signedIn || typeof EventSource === "undefined") return;

    const source = new EventSource("/api/me/events/stream");
    const listeners: Array<[string, () => void]> = (["friends", "messages"] as const).map(
      (topic) => [
        topic,
        () => {
          for (const key of KEYS[topic]) qc.invalidateQueries({ queryKey: key });
        },
      ],
    );
    for (const [topic, handler] of listeners) source.addEventListener(topic, handler);
    source.onerror = () => {};

    return () => {
      for (const [topic, handler] of listeners) source.removeEventListener(topic, handler);
      source.close();
    };
  }, [signedIn, qc]);
}
