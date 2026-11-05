import { useEffect, useState } from "react";
import type { CampaignMembership, EventName } from "../api/client";
import { useNotificationSettings, useSetNotificationSettings } from "../hooks";
import { EMAIL_EVENTS } from "../lib/events";
import { localLabel } from "../lib/digest";
import { HourSelect } from "./DigestWhen";
import EmailEventPicker, { type EmailMode } from "./EmailEventPicker";

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
  const [modes, setModes] = useState<Map<EventName, EmailMode>>(new Map());
  const [hour, setHour] = useState(18);
  useEffect(() => {
    if (!settings) return;
    const next = new Map<EventName, EmailMode>();
    settings.digestEvents.forEach((n) => next.set(n, "daily"));
    settings.emailEvents.forEach((n) => next.set(n, "now"));
    setModes(next);
    setHour(settings.digestHour);
  }, [settings]);
  if (isPending || !settings) return null;

  const muted = campaigns.filter((m) => settings.mutedCampaignIds.includes(m.campaign.id));

  function persist(next: Map<EventName, EmailMode>, utcHour: number) {
    const names = EMAIL_EVENTS.map((e) => e.name);
    save.mutate({
      emailEvents: names.filter((n) => next.get(n) === "now"),
      digestEvents: names.filter((n) => next.get(n) === "daily"),
      digestHour: utcHour,
    });
  }

  function setMode(name: EventName, mode: EmailMode) {
    const next = new Map(modes);
    next.set(name, mode);
    setModes(next);
    persist(next, hour);
  }

  function setDigestHour(utc: number) {
    setHour(utc);
    persist(modes, utc);
  }

  const anyDaily = [...modes.values()].includes("daily");

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
        <EmailEventPicker events={EMAIL_EVENTS} modes={modes} onSet={setMode} />
      </div>
      {anyDaily && (
        <div className="font-body mt-3 flex flex-wrap items-baseline gap-2 text-[12.5px] text-[#e6d5af]" data-testid="digest-hour">
          <span>The daily digest arrives at</span>
          <HourSelect hour={hour} onChange={setDigestHour} surface="hall" name="digest-hour" label="Hour of the daily digest" />
          <span className="text-[11.5px] italic text-[#9c855e]">
            your time, one email for every table ({localLabel(hour)} today — a clock change moves it by an hour).
          </span>
        </div>
      )}
      <p className="font-body m-0 mt-3 text-[12px] italic text-[#9c855e]">
        {muted.length > 0 && (
          <>
            Muted, no email about {muted.length === 1 ? "it" : "them"}: {muted.map((m) => m.campaign.name).join(", ")} — unmute from the Player Menu at the table.{" "}
          </>
        )}
        Daily collects the chatty ones into one email a day, with a section for each table; nothing is sent on a quiet day. For Discord, register a webhook below and pick “Discord message”.
      </p>
    </div>
  );
}
