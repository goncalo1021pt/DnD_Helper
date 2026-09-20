import { useState } from "react";
import type { Campaign, EventName } from "../../api/client";
import { usePingTableChannel, useRemoveTableChannel, useSetTableChannel } from "../../hooks";
import { TABLE_EVENTS } from "../../lib/events";
import ParchmentModal from "../ui/ParchmentModal";

/*
 * The Herald (#316): the table's own Discord channel — a webhook with no
 * owner that posts what the WHOLE table may hear. A handout to one hero, a
 * seat request, a veiled notice never reach it, whatever is picked here;
 * the audience the emitter decided is the gate, and the channel is a
 * member everyone can see.
 */

type ApiError = { data?: { error?: string } };
const errText = (e: unknown, fallback: string) => (e as ApiError)?.data?.error ?? fallback;

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function HeraldSection({ campaign }: { campaign: Campaign }) {
  const channel = campaign.channel;
  const ping = usePingTableChannel(campaign.id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pinged, setPinged] = useState(false);

  return (
    <section className="panel-hall px-6 pb-6 pt-5" data-testid="herald-section">
      <div
        className="mb-3 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2
          className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
        >
          The Herald
        </h2>
        <span className="label-stamp text-[11px] text-gold-muted">
          {channel ? (channel.disabledAt ? "silenced" : "posting") : "no channel"}
        </span>
      </div>

      <p className="font-body m-0 mb-4 text-[13.5px] leading-relaxed text-cream-muted">
        A Discord channel the whole table reads. It is told only what everyone at the table may hear —
        a notice for the party, the next gathering, a handout to all — never what one player was told alone.
      </p>

      {channel ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="break-all font-mono text-[12.5px] text-[#e6d5af]" data-testid="herald-url">{channel.url}</span>
            {channel.disabledAt && <span className="label-stamp text-[9px] tracking-[1.5px] text-[#d68a72]">DISABLED</span>}
            {!channel.disabledAt && channel.failures > 0 && (
              <span className="label-stamp text-[9px] tracking-[1.5px] text-[#e0a458]">FAILING</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {channel.events.length === 0 ? (
              <span className="font-body text-[12px] italic text-[#9c855e]">everything the table hears</span>
            ) : (
              channel.events.map((e) => (
                <span
                  key={e}
                  className="label-stamp rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] tracking-[.5px]"
                  style={{ color: "#cdb582", background: "rgba(201,162,39,.10)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}
                >
                  {e}
                </span>
              ))
            )}
          </div>
          <div className="font-body text-[11.5px] text-[#9c855e]">
            {channel.lastDeliveredAt ? `last posted ${fmtWhen(channel.lastDeliveredAt)}` : "nothing posted yet"}
            {channel.disabledAt && channel.disabledReason ? ` · ${channel.disabledReason} — hang it again to retry` : ""}
            {pinged ? " · a test message is on its way" : ""}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              onClick={() => ping.mutate(undefined, { onSuccess: () => setPinged(true) })}
              disabled={ping.isPending || !!channel.disabledAt}
              className="btn-base btn-gold clip-octagon h-9 px-4 text-[11px] disabled:opacity-50"
            >
              Send a test
            </button>
            <button onClick={() => setEditing(true)} className="btn-base h-9 px-4 text-[11px]" style={{ color: "#cdb582", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}>
              Change
            </button>
            <button onClick={() => setRemoving(true)} className="btn-base h-9 px-4 text-[11px]" style={{ color: "#d68a72", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}>
              Take it down
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="btn-base btn-gold clip-octagon h-9 px-4 text-[11px]">
          Hang a channel
        </button>
      )}

      {editing && <ChannelModal campaign={campaign} onClose={() => setEditing(false)} />}
      {removing && <RemoveModal campaignId={campaign.id} onClose={() => setRemoving(false)} />}
    </section>
  );
}

function ChannelModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const set = useSetTableChannel(campaign.id);
  const [url, setUrl] = useState(campaign.channel?.url ?? "");
  const [picked, setPicked] = useState<Set<EventName>>(new Set(campaign.channel?.events ?? []));
  const ready = url.trim().length > 0 && !set.isPending;

  function toggle(name: EventName) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function submit() {
    if (!ready) return;
    set.mutate({ url: url.trim(), events: [...picked] }, { onSuccess: onClose });
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">The Herald</div>
      <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">
        {campaign.channel ? "Change the channel" : "Hang a channel"}
      </h3>
      <p className="font-body m-0 mb-3 text-center text-[13px] italic text-ink-body">
        In Discord: channel settings → Integrations → Webhooks → New Webhook, then copy its URL here.
      </p>

      <label className="mb-3 block">
        <span className="field-label">Discord webhook URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/…"
          className="input-parchment mt-1 w-full font-mono text-[13px]"
          name="herald-url"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>

      <span className="field-label">Which events</span>
      <p className="font-body m-0 mb-1.5 mt-0.5 text-[11.5px] italic text-ink-body">
        Pick none to post every one. Only what the whole table may hear is ever posted.
      </p>
      <div className="mb-4 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {TABLE_EVENTS.map((ev) => (
          <label key={ev.name} className="flex cursor-pointer items-baseline gap-2 font-body text-[12.5px] text-ink">
            <input type="checkbox" checked={picked.has(ev.name)} onChange={() => toggle(ev.name)} name={`herald-${ev.name}`} />
            <span className="font-mono text-[11.5px]">{ev.name}</span>
            <span className="text-[11px] italic text-ink-body">{ev.hint}</span>
          </label>
        ))}
      </div>

      {set.isError && <div className="mb-2 text-[11.5px] italic text-[#8b2520]">{errText(set.error, "The channel could not be hung.")}</div>}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Cancel</button>
        <button onClick={submit} disabled={!ready} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px] disabled:opacity-50">
          {campaign.channel ? "Save" : "Hang it"}
        </button>
      </div>
    </ParchmentModal>
  );
}

function RemoveModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const remove = useRemoveTableChannel(campaignId);
  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[420px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">The Herald</div>
      <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">Take the channel down?</h3>
      <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">Nothing more is posted there, and its delivery log goes with it.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Keep it</button>
        <button
          onClick={() => remove.mutate(undefined, { onSuccess: onClose })}
          disabled={remove.isPending}
          className="btn-base h-10 px-6 text-[12px] disabled:opacity-50"
          style={{ color: "#8b2520", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
        >
          Take it down
        </button>
      </div>
    </ParchmentModal>
  );
}
