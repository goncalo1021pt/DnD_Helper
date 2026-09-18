import { useState } from "react";
import type { ApiToken, ApiTokenCreated, CampaignMembership, TokenScope } from "../api/client";
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from "../hooks";
import ParchmentModal from "./ui/ParchmentModal";

/*
 * API tokens (#294) — the section of the profile's Settings where a person
 * mints the keys a script or an assistant will use to act as them.
 *
 * A token is minted with one rung per domain (the scope vocabulary of #313):
 * nothing, read, or a higher rung that implies read. Optionally it is tied to
 * one table, and by default it expires in 90 days. The secret is shown once,
 * here, and never again — the server keeps only its hash.
 */

type Rung = { scope: TokenScope | null; label: string; hint: string };
type Domain = { key: "rules" | "heroes" | "campaigns" | "account" | "webhooks"; label: string; rungs: Rung[] };

const DOMAINS: Domain[] = [
  {
    key: "rules",
    label: "Rules",
    rungs: [
      { scope: null, label: "None", hint: "" },
      { scope: "rules:read", label: "Read", hint: "the codex — classes, spells, items, monsters, your homebrew" },
      { scope: "rules:write", label: "Write", hint: "author and import homebrew as you" },
    ],
  },
  {
    key: "heroes",
    label: "Heroes",
    rungs: [
      { scope: null, label: "None", hint: "" },
      { scope: "heroes:read", label: "Read", hint: "your heroes' sheets, inventory and spells" },
      { scope: "heroes:write", label: "Write", hint: "forge, level, rest and equip them" },
    ],
  },
  {
    key: "campaigns",
    label: "Campaigns",
    rungs: [
      { scope: null, label: "None", hint: "" },
      { scope: "campaigns:read", label: "Read", hint: "the board, atlas, chronicle and roster of the tables you sit at" },
      { scope: "campaigns:play", label: "Play", hint: "act as a player — claim quests, buy, roll, write in the chronicle" },
      { scope: "campaigns:run", label: "Run", hint: "run a table as its DM — quests, fog, encounters, the Folk" },
      { scope: "campaigns:own", label: "Own", hint: "disband, strike maps and places, hand tables over" },
    ],
  },
  {
    key: "account",
    label: "Account",
    rungs: [
      { scope: null, label: "None", hint: "" },
      { scope: "account:read", label: "Read", hint: "who you are, your friends and messages" },
      { scope: "account:write", label: "Write", hint: "your profile, friendships and messages" },
    ],
  },
  {
    key: "webhooks",
    label: "Webhooks",
    rungs: [
      { scope: null, label: "None", hint: "" },
      { scope: "webhooks:read", label: "Read", hint: "your webhooks and their delivery logs" },
      { scope: "webhooks:write", label: "Write", hint: "register, ping and remove webhooks — a hook made by this token hears only what its other scopes can read" },
    ],
  },
];

const EXPIRY = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Never" },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

type ApiError = { data?: { error?: string } };
const errText = (e: unknown, fallback: string) => (e as ApiError)?.data?.error ?? fallback;

export default function ApiTokensSettings({ campaigns }: { campaigns: CampaignMembership[] }) {
  const { data: tokens = [], isPending } = useApiTokens();
  const [minting, setMinting] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-body text-[13px] text-[#c9b183]">
          Let a script or an assistant read the codex and your heroes as you, with only the doors you hand it.
        </span>
        <button onClick={() => setMinting(true)} className="btn-base btn-gold clip-octagon ml-auto h-9 px-4 text-[12px]">
          New token
        </button>
      </div>

      {isPending ? null : tokens.length === 0 ? (
        <p className="font-body m-0 mt-3 text-[13px] italic text-[#9c855e]">No tokens yet.</p>
      ) : (
        <ul className="m-0 mt-3 list-none p-0" data-testid="token-list">
          {tokens.map((t) => (
            <TokenRow key={t.id} token={t} onRevoke={() => setRevoking(t)} />
          ))}
        </ul>
      )}

      {minting && <MintModal campaigns={campaigns} onClose={() => setMinting(false)} />}
      {revoking && <RevokeModal token={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}

function TokenRow({ token, onRevoke }: { token: ApiToken; onRevoke: () => void }) {
  const expired = !!token.expiresAt && new Date(token.expiresAt).getTime() < Date.now();
  // Refused for going over its ceiling within the last day (#314): the script
  // holding it is looping, and this is where its owner finds out.
  const throttled = !!token.throttledAt && Date.now() - new Date(token.throttledAt).getTime() < 24 * 60 * 60 * 1000;
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5"
      style={{ borderTop: "1px solid rgba(201,162,39,.14)" }}
      data-testid="token-row"
    >
      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-body text-[14px] font-semibold text-[#e6d5af]">{token.name}</span>
          <span className="font-mono text-[11.5px] tracking-[.5px] text-[#9c855e]">{token.prefix}…</span>
          {expired && (
            <span className="label-stamp text-[9px] tracking-[1.5px] text-[#d68a72]">EXPIRED</span>
          )}
          {throttled && (
            <span className="label-stamp text-[9px] tracking-[1.5px] text-[#e0a458]" title="Refused for going over its rate limit — the script holding it is looping">
              HIT ITS CEILING
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {token.scopes.map((s) => (
            <span
              key={s}
              className="label-stamp rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] tracking-[.5px]"
              style={{ color: "#cdb582", background: "rgba(201,162,39,.10)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}
            >
              {s}
            </span>
          ))}
          <span className="font-body text-[12px] italic text-[#9c855e]">
            {token.campaignName ? `at ${token.campaignName} only` : "at every table you sit at"}
          </span>
        </div>
        <div className="font-body mt-0.5 text-[11.5px] text-[#9c855e]">
          Created {fmtDate(token.createdAt)}
          {" · "}
          {token.lastUsedAt ? `last used ${fmtDate(token.lastUsedAt)}` : "never used"}
          {" · "}
          {token.expiresAt ? `${expired ? "expired" : "expires"} ${fmtDate(token.expiresAt)}` : "never expires"}
          {token.throttledAt ? ` · hit its ceiling ${fmtWhen(token.throttledAt)}` : ""}
        </div>
      </div>
      <button
        onClick={onRevoke}
        className="btn-base h-8 px-3 text-[11px]"
        style={{ color: "#d68a72", background: "rgba(139,37,32,.14)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
      >
        Revoke
      </button>
    </li>
  );
}

function MintModal({ campaigns, onClose }: { campaigns: CampaignMembership[]; onClose: () => void }) {
  const create = useCreateApiToken();
  const [name, setName] = useState("");
  const [rungs, setRungs] = useState<Record<Domain["key"], TokenScope | null>>({
    rules: "rules:read",
    heroes: "heroes:read",
    campaigns: null,
    account: null,
    webhooks: null,
  });
  const [campaignId, setCampaignId] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const scopes = DOMAINS.map((d) => rungs[d.key]).filter((s): s is TokenScope => s !== null);
  const ready = name.trim().length > 0 && scopes.length > 0 && !create.isPending;

  function submit() {
    if (!ready) return;
    create.mutate(
      { name: name.trim(), scopes, campaignId: campaignId || null, expiresInDays },
      { onSuccess: setCreated },
    );
  }

  function copy() {
    if (created) {
      navigator.clipboard?.writeText(created.secret).then(() => setCopied(true)).catch(() => {});
    }
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[520px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">API token</div>

      {created ? (
        <>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">Copy it now</h3>
          <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
            This is the only time <strong>{created.token.name}</strong> is shown. We keep a hash, not the secret — lose it and you mint another.
          </p>
          <div
            className="mb-4 break-all rounded-[4px] px-4 py-3 text-center font-mono text-[13px] tracking-[.5px] text-ink"
            style={{ background: "rgba(60,40,15,.06)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.2)" }}
            data-testid="token-secret"
          >
            {created.secret}
          </div>
          <p className="font-body m-0 mb-4 text-[12px] text-ink-body">
            Send it as <code className="font-mono">Authorization: Bearer {created.token.prefix}…</code> on every request.
          </p>
          <div className="flex items-center justify-between gap-3">
            <button onClick={copy} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#4a3a24", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.4)" }}>
              {copied ? "Copied ✓" : "Copy token"}
            </button>
            <button onClick={onClose} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]">I've saved it</button>
          </div>
        </>
      ) : (
        <>
          <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">Mint a token</h3>

          <label className="mb-3 block">
            <span className="field-label">What is it for?</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder="the Discord bot, my backup script…"
              className="input-parchment mt-1 w-full"
              name="token-name"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>

          <span className="field-label">What may it touch?</span>
          <div className="mb-3 mt-1 flex flex-col gap-2">
            {DOMAINS.map((d) => {
              const picked = d.rungs.find((r) => r.scope === rungs[d.key]) ?? d.rungs[0];
              return (
                <div key={d.key} className="rounded-[4px] px-3 py-2" style={{ background: "rgba(60,40,15,.05)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.15)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-body w-[84px] text-[13px] font-semibold text-ink">{d.label}</span>
                    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${d.label} access`}>
                      {d.rungs.map((r) => {
                        const on = r.scope === rungs[d.key];
                        return (
                          <button
                            key={r.label}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setRungs({ ...rungs, [d.key]: r.scope })}
                            className="btn-base h-7 px-2.5 text-[11px]"
                            style={
                              on
                                ? { color: "#2e2114", background: "rgba(201,162,39,.28)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.55)" }
                                : { color: "#6b5836", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.25)" }
                            }
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {picked.hint && <div className="font-body mt-1 text-[11.5px] italic text-ink-body">{picked.hint}</div>}
                </div>
              );
            })}
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Which table?</span>
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="input-parchment mt-1 w-full" name="token-campaign">
                <option value="">Every table I sit at</option>
                {campaigns.map((m) => (
                  <option key={m.campaign.id} value={m.campaign.id}>
                    {m.campaign.name} only
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Expires in</span>
              <select value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} className="input-parchment mt-1 w-full" name="token-expiry">
                {EXPIRY.map((o) => (
                  <option key={o.days} value={o.days}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {create.isError && <div className="mb-2 text-[11.5px] italic text-[#8b2520]">{errText(create.error, "That token could not be minted.")}</div>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Cancel</button>
            <button onClick={submit} disabled={!ready} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px] disabled:opacity-50">
              Create token
            </button>
          </div>
        </>
      )}
    </ParchmentModal>
  );
}

function RevokeModal({ token, onClose }: { token: ApiToken; onClose: () => void }) {
  const revoke = useRevokeApiToken();
  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[400px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">API token</div>
      <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">Revoke {token.name}?</h3>
      <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
        Whatever holds it is refused from the next request on. This cannot be undone — mint a new one instead.
      </p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Keep it</button>
        <button
          onClick={() => revoke.mutate(token.id, { onSuccess: onClose })}
          disabled={revoke.isPending}
          className="btn-base h-10 px-6 text-[12px] disabled:opacity-50"
          style={{ color: "#8b2520", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
        >
          Revoke
        </button>
      </div>
    </ParchmentModal>
  );
}
