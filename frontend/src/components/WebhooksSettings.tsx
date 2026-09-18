import { useState } from "react";
import type { CampaignMembership, EventName, Webhook, WebhookCreated, WebhookDelivery } from "../api/client";
import { useCreateWebhook, useDeleteWebhook, useEnableWebhook, usePingWebhook, useWebhookDeliveries, useWebhooks } from "../hooks";
import ParchmentModal from "./ui/ParchmentModal";

/*
 * Webhooks (#295) — the section of the profile's Settings where a person
 * registers a URL to be told at when chosen events happen. It hears only
 * what they could see in the app; the secret is shown once.
 */

const EVENTS: { name: EventName; hint: string }[] = [
  { name: "quest.posted", hint: "a notice reaches the board for you" },
  { name: "quest.claimed", hint: "somebody takes one up" },
  { name: "quest.completed", hint: "the DM marks one done" },
  { name: "handout.given", hint: "a prop is handed to you" },
  { name: "session.scheduled", hint: "the next gathering is set" },
  { name: "session.moved", hint: "the next gathering changes date" },
  { name: "hero.levelled", hint: "a hero rises a level" },
  { name: "hero.xp_awarded", hint: "XP is granted or docked" },
  { name: "encounter.started", hint: "a fight goes live" },
  { name: "encounter.ended", hint: "a fight stands down" },
  { name: "chronicle.written", hint: "somebody writes in the chronicle" },
  { name: "member.joined", hint: "somebody walks in with the invite code" },
  { name: "seat.requested", hint: "a player asks you, the DM, for a seat" },
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

type ApiError = { data?: { error?: string } };
const errText = (e: unknown, fallback: string) => (e as ApiError)?.data?.error ?? fallback;

const hallDanger = { color: "#d68a72", background: "rgba(139,37,32,.14)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" };
const hallGhost = { color: "#cdb582", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" };

export default function WebhooksSettings({ campaigns }: { campaigns: CampaignMembership[] }) {
  const { data: hooks = [], isPending } = useWebhooks();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Webhook | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-body text-[13px] text-[#c9b183]">
          Have a URL of yours told when things happen at your tables. It hears only what you can see here.
        </span>
        <button onClick={() => setAdding(true)} className="btn-base btn-gold clip-octagon ml-auto h-9 px-4 text-[12px]">
          New webhook
        </button>
      </div>

      {isPending ? null : hooks.length === 0 ? (
        <p className="font-body m-0 mt-3 text-[13px] italic text-[#9c855e]">No webhooks yet.</p>
      ) : (
        <ul className="m-0 mt-3 list-none p-0" data-testid="webhook-list">
          {hooks.map((h) => (
            <WebhookRow key={h.id} hook={h} onRemove={() => setRemoving(h)} />
          ))}
        </ul>
      )}

      {adding && <AddModal campaigns={campaigns} onClose={() => setAdding(false)} />}
      {removing && <RemoveModal hook={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function WebhookRow({ hook, onRemove }: { hook: Webhook; onRemove: () => void }) {
  const ping = usePingWebhook();
  const enable = useEnableWebhook();
  const [showLog, setShowLog] = useState(false);
  const disabled = !!hook.disabledAt;

  return (
    <li className="py-2.5" style={{ borderTop: "1px solid rgba(201,162,39,.14)" }} data-testid="webhook-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="break-all font-mono text-[12.5px] text-[#e6d5af]">{hook.url}</span>
            {disabled && <span className="label-stamp text-[9px] tracking-[1.5px] text-[#d68a72]">DISABLED</span>}
            {!disabled && hook.failures > 0 && (
              <span className="label-stamp text-[9px] tracking-[1.5px] text-[#e0a458]">FAILING</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {hook.events.length === 0 ? (
              <span className="font-body text-[12px] italic text-[#9c855e]">every event</span>
            ) : (
              hook.events.map((e) => (
                <span
                  key={e}
                  className="label-stamp rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] tracking-[.5px]"
                  style={{ color: "#cdb582", background: "rgba(201,162,39,.10)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}
                >
                  {e}
                </span>
              ))
            )}
            <span className="font-body text-[12px] italic text-[#9c855e]">
              {hook.campaignName ? `at ${hook.campaignName} only` : "at every table you sit at"}
              {hook.scopes ? " · made by a token, capped to its scopes" : ""}
            </span>
          </div>
          <div className="font-body mt-0.5 text-[11.5px] text-[#9c855e]">
            {hook.lastDeliveredAt ? `last delivered ${fmtWhen(hook.lastDeliveredAt)}` : "nothing delivered yet"}
            {disabled && hook.disabledReason ? ` · ${hook.disabledReason}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {disabled ? (
            <button
              onClick={() => enable.mutate(hook.id)}
              disabled={enable.isPending}
              className="btn-base btn-gold clip-octagon h-8 px-3 text-[11px] disabled:opacity-50"
            >
              Re-enable
            </button>
          ) : (
            <button onClick={() => { ping.mutate(hook.id); setShowLog(true); }} disabled={ping.isPending} className="btn-base h-8 px-3 text-[11px] disabled:opacity-50" style={hallGhost}>
              Ping
            </button>
          )}
          <button onClick={() => setShowLog((v) => !v)} className="btn-base h-8 px-3 text-[11px]" style={hallGhost} aria-expanded={showLog}>
            {showLog ? "Hide log" : "Deliveries"}
          </button>
          <button onClick={onRemove} className="btn-base h-8 px-3 text-[11px]" style={hallDanger}>
            Remove
          </button>
        </div>
      </div>
      {showLog && <DeliveryLog webhookId={hook.id} />}
    </li>
  );
}

function DeliveryLog({ webhookId }: { webhookId: string }) {
  const { data: deliveries = [], isPending } = useWebhookDeliveries(webhookId);
  return (
    <div className="mt-2 rounded-[3px] px-3 py-2" style={{ background: "rgba(16,9,5,.45)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.18)" }} data-testid="delivery-log">
      {isPending ? null : deliveries.length === 0 ? (
        <span className="font-body text-[12px] italic text-[#9c855e]">Nothing sent yet — press Ping.</span>
      ) : (
        <ul className="m-0 list-none p-0">
          {deliveries.map((d) => (
            <DeliveryLine key={d.id} d={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DeliveryLine({ d }: { d: WebhookDelivery }) {
  const state = d.deliveredAt
    ? { text: `delivered ${fmtWhen(d.deliveredAt)}`, color: "#7ea63f" }
    : d.deadAt
      ? { text: `gave up ${fmtWhen(d.deadAt)}`, color: "#d68a72" }
      : d.attempts === 0
        ? { text: "queued", color: "#9c855e" }
        : { text: `retrying${d.nextAttemptAt ? ` at ${fmtWhen(d.nextAttemptAt)}` : ""}`, color: "#e0a458" };
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 py-0.5 font-body text-[12px] text-[#c9b183]">
      <span className="font-mono text-[11px] text-[#e6d5af]">{d.name}</span>
      <span style={{ color: state.color }}>{state.text}</span>
      <span className="text-[#9c855e]">
        {d.attempts > 0 ? `${d.attempts} ${d.attempts === 1 ? "attempt" : "attempts"}` : ""}
        {d.lastStatus ? ` · ${d.lastStatus}` : ""}
        {d.lastError ? ` · ${d.lastError}` : ""}
      </span>
    </li>
  );
}

function AddModal({ campaigns, onClose }: { campaigns: CampaignMembership[]; onClose: () => void }) {
  const create = useCreateWebhook();
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<Set<EventName>>(new Set());
  const [campaignId, setCampaignId] = useState("");
  const [created, setCreated] = useState<WebhookCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const ready = url.trim().length > 0 && !create.isPending;

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
    create.mutate(
      { url: url.trim(), events: [...picked], campaignId: campaignId || null },
      { onSuccess: setCreated },
    );
  }

  function copy() {
    if (created) {
      navigator.clipboard?.writeText(created.secret).then(() => setCopied(true)).catch(() => {});
    }
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">Webhook</div>

      {created ? (
        <>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">Copy the secret now</h3>
          <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
            Every delivery is signed with it, and this is the only time it is shown. Lose it and you register the URL again.
          </p>
          <div
            className="mb-4 break-all rounded-[4px] px-4 py-3 text-center font-mono text-[13px] tracking-[.5px] text-ink"
            style={{ background: "rgba(60,40,15,.06)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.2)" }}
            data-testid="webhook-secret"
          >
            {created.secret}
          </div>
          <p className="font-body m-0 mb-4 text-[12px] text-ink-body">
            Check <code className="font-mono">X-QuestBoard-Signature</code> against an HMAC-SHA256 of <code className="font-mono">timestamp.body</code> under it. The API guide has a snippet.
          </p>
          <div className="flex items-center justify-between gap-3">
            <button onClick={copy} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#4a3a24", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.4)" }}>
              {copied ? "Copied ✓" : "Copy secret"}
            </button>
            <button onClick={onClose} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]">I've saved it</button>
          </div>
        </>
      ) : (
        <>
          <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">Register a webhook</h3>

          <label className="mb-3 block">
            <span className="field-label">Where to send it</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/questboard"
              className="input-parchment mt-1 w-full font-mono text-[13px]"
              name="webhook-url"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>

          <span className="field-label">Which events</span>
          <p className="font-body m-0 mb-1.5 mt-0.5 text-[11.5px] italic text-ink-body">Pick none to hear every one. You only ever hear what you could see here.</p>
          <div className="mb-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {EVENTS.map((ev) => (
              <label key={ev.name} className="flex cursor-pointer items-baseline gap-2 font-body text-[12.5px] text-ink">
                <input type="checkbox" checked={picked.has(ev.name)} onChange={() => toggle(ev.name)} name={`event-${ev.name}`} />
                <span className="font-mono text-[11.5px]">{ev.name}</span>
                <span className="text-[11px] italic text-ink-body">{ev.hint}</span>
              </label>
            ))}
          </div>

          <label className="mb-4 block">
            <span className="field-label">Which table?</span>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="input-parchment mt-1 w-full" name="webhook-campaign">
              <option value="">Every table I sit at</option>
              {campaigns.map((m) => (
                <option key={m.campaign.id} value={m.campaign.id}>
                  {m.campaign.name} only
                </option>
              ))}
            </select>
          </label>

          {create.isError && <div className="mb-2 text-[11.5px] italic text-[#8b2520]">{errText(create.error, "That webhook could not be registered.")}</div>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Cancel</button>
            <button onClick={submit} disabled={!ready} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px] disabled:opacity-50">
              Register
            </button>
          </div>
        </>
      )}
    </ParchmentModal>
  );
}

function RemoveModal({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const remove = useDeleteWebhook();
  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[420px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">Webhook</div>
      <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">Remove this webhook?</h3>
      <p className="font-body m-0 mb-4 break-all text-center text-[13px] italic text-ink-body">{hook.url}</p>
      <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">Nothing more is sent there, and its delivery log goes with it.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Keep it</button>
        <button
          onClick={() => remove.mutate(hook.id, { onSuccess: onClose })}
          disabled={remove.isPending}
          className="btn-base h-10 px-6 text-[12px] disabled:opacity-50"
          style={{ color: "#8b2520", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
        >
          Remove
        </button>
      </div>
    </ParchmentModal>
  );
}
