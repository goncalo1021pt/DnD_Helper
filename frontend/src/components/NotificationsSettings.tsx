import { useEffect, useState } from "react";
import type { CampaignMembership, EventName } from "../api/client";
import { useNotificationSettings, useSetNotificationSettings } from "../hooks";
import { EMAIL_EVENTS } from "../lib/events";
import EventPicker from "./EventPicker";

/*
 * Notifications (#316) — the section of the profile's Settings where a
 * person says which events are emailed to them. Email goes to the account's
 * confirmed address; a Discord channel of their own is a webhook with the
 * Discord format, in the section below. A new account is told about the
 * next gathering and a handout to them, and nothing else, until it says
 * otherwise.
 */

export default function NotificationsSettings({ campaigns }: { campaigns: CampaignMembership[] }) {
  const { data: settings, isPending } = useNotificationSettings();
  const save = useSetNotificationSettings();
  // The boxes answer the press at once and the server's word replaces
  // them when it comes — a box that waits for a round trip reads as stuck.
  const [chosen, setChosen] = useState<Set<EventName>>(new Set());
  useEffect(() => {
    if (settings) setChosen(new Set(settings.emailEvents));
  }, [settings]);
  if (isPending || !settings) return null;

  const muted = campaigns.filter((m) => settings.mutedCampaignIds.includes(m.campaign.id));

  function toggle(name: EventName) {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setChosen(next);
    save.mutate({ emailEvents: EMAIL_EVENTS.map((e) => e.name).filter((n) => next.has(n)) });
  }

  const where = !settings.emailAddress ? (
    <span className="text-[#d68a72]">This account has no email address, so nothing is sent — the choices are kept for when it has one.</span>
  ) : !settings.emailVerified ? (
    <span className="text-[#e0a458]">
      Emails go to <span className="font-mono text-[12.5px]">{settings.emailAddress}</span> once it is confirmed — nothing is sent until then.
    </span>
  ) : (
    <>
      Emails go to <span className="font-mono text-[12.5px] text-[#e6d5af]">{settings.emailAddress}</span>. Every one carries a link that stops them.
    </>
  );

  return (
    <div data-testid="notifications-settings">
      <p className="font-body m-0 text-[13px] text-[#c9b183]">{where}</p>
      <div className="mt-3">
        <EventPicker events={EMAIL_EVENTS} picked={chosen} onToggle={toggle} namePrefix="email" surface="hall" />
      </div>
      <p className="font-body m-0 mt-3 text-[12px] italic text-[#9c855e]">
        {muted.length > 0 && (
          <>
            Muted, no email about {muted.length === 1 ? "it" : "them"}: {muted.map((m) => m.campaign.name).join(", ")} — unmute from the Player Menu at the table.{" "}
          </>
        )}
        Chronicle lines are not emailed. For Discord, register a webhook below and pick “Discord message”.
      </p>
    </div>
  );
}
