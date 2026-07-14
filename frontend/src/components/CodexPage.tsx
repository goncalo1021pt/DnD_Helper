import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { CodexEntry, RulesContent, RulesKind } from "../api/client";
import {
  useClearCodexStatus,
  useCodex,
  useRules,
  useSetCodexStatus,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";

/**
 * The Codex: what exists in this campaign's world. SRD is legal unless the
 * DM bans it (empty-world campaigns welcome); homebrew enters only when its
 * author proposes it and the DM admits it.
 */

const KINDS: Array<[RulesKind, string]> = [
  ["class", "Classes"],
  ["subclass", "Subclasses"],
  ["species", "Species"],
  ["background", "Backgrounds"],
  ["feat", "Feats"],
  ["spell", "Spells"],
  ["item", "Items"],
];

function StatusChip({ text, tone }: { text: string; tone: "ok" | "no" | "wait" }) {
  const colors = {
    ok: { c: "#8fb15f", bg: "rgba(143,177,95,.12)" },
    no: { c: "#c96a5a", bg: "rgba(139,37,32,.18)" },
    wait: { c: "#d0a75a", bg: "rgba(201,162,39,.12)" },
  }[tone];
  return (
    <span
      className="label-stamp rounded-[2px] px-2 py-1 text-[8.5px] tracking-[1.5px]"
      style={{ color: colors.c, background: colors.bg, boxShadow: `inset 0 0 0 1px ${colors.c}44` }}
    >
      {text}
    </span>
  );
}

export default function CodexPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const [kind, setKind] = useState<RulesKind>("class");
  const [search, setSearch] = useState("");
  const { data: rules } = useRules(kind);
  const { data: codex, isLoading } = useCodex(campaign.id);
  const setStatus = useSetCodexStatus(campaign.id);
  const clearStatus = useClearCodexStatus(campaign.id);

  const byContent = useMemo(() => {
    const m = new Map<string, CodexEntry>();
    for (const e of codex ?? []) m.set(e.content.id, e);
    return m;
  }, [codex]);

  const proposals = (codex ?? []).filter(
    (e) => e.status === "proposed" && e.content.kind === kind,
  );
  const q = search.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);
  const srdEntries = (rules ?? []).filter(
    (r) => r.source === "srd" && matches(r.name),
  );
  const enabledHomebrew = (codex ?? []).filter(
    (e) => e.status === "enabled" && e.content.kind === kind && matches(e.content.name),
  );
  // The DM's own shelf, not yet ruled on — one click from joining the world.
  const myShelf = (rules ?? []).filter(
    (r) => r.source === "homebrew" && r.mine && !byContent.has(r.id),
  );
  const bannedCount = srdEntries.filter(
    (r) => byContent.get(r.id)?.status === "banned",
  ).length;

  function banAllSrd(ban: boolean) {
    for (const r of srdEntries) {
      const banned = byContent.get(r.id)?.status === "banned";
      if (ban && !banned) setStatus.mutate({ contentId: r.id, status: "banned" });
      if (!ban && banned) clearStatus.mutate(r.id);
    }
  }

  const rowShell =
    "parchment flex flex-wrap items-center gap-3 px-4 py-3";

  function contentLine(c: RulesContent) {
    return (
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] font-bold leading-tight text-ink">
          {c.name}
          <span className="label-stamp ml-2 text-[8.5px] tracking-[1px] text-ink-label">
            {c.source === "srd" ? "SRD 5.2" : `Homebrew · ${c.creatorName ?? "unknown"}`}
          </span>
        </div>
        {c.summary && (
          <p className="font-body m-0 mt-0.5 truncate text-[12.5px] italic text-ink-body">
            {c.summary}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div>
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Codex
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {isDM
              ? "What exists in your world — ban SRD entries, admit homebrew."
              : "What the DM has ruled legal at this table."}
          </div>
        </div>
      </div>

      {/* kind tabs */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              setSearch("");
            }}
            className={`label-stamp cursor-pointer rounded-[2px] border-none px-3 py-2 text-[10px] font-semibold tracking-[1.5px] ${
              k === kind ? "text-ember-bright" : "text-gold-muted hover:text-gold-hair"
            }`}
            style={{
              background: k === kind ? "rgba(201,162,39,.12)" : "rgba(16,9,5,.35)",
              boxShadow: `inset 0 0 0 1px rgba(201,162,39,${k === kind ? ".45" : ".2"})`,
            }}
          >
            {label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search this shelf…"
          className="input-hall ml-auto h-9 w-full text-[13px] sm:w-52"
        />
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Consulting the codex…
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {/* proposals */}
          {proposals.length > 0 && (
            <section>
              <div className="label-stamp mb-2.5 text-[10px] tracking-[2.5px] text-gold-muted">
                Waiting at the door
              </div>
              <div className="flex flex-col gap-2.5">
                {proposals.map((e) => (
                  <div key={e.content.id} className={rowShell}>
                    {contentLine(e.content)}
                    <span className="font-accent text-[12px] italic text-ink-body">
                      offered by {e.proposerName ?? "a member"}
                    </span>
                    {isDM ? (
                      <div className="flex flex-none gap-2">
                        <button
                          onClick={() => setStatus.mutate({ contentId: e.content.id, status: "enabled" })}
                          className="btn-base btn-gold clip-octagon h-9 px-4 text-[11px]"
                        >
                          Admit
                        </button>
                        <button
                          onClick={() => clearStatus.mutate(e.content.id)}
                          className="btn-base btn-ghost-red px-3 py-2 text-[11px]"
                        >
                          Turn away
                        </button>
                      </div>
                    ) : (
                      <StatusChip text="awaiting the DM" tone="wait" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* homebrew in the world */}
          <section>
            <div className="label-stamp mb-2.5 text-[10px] tracking-[2.5px] text-gold-muted">
              Homebrew admitted to this world
            </div>
            {enabledHomebrew.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {enabledHomebrew.map((e) => (
                  <div key={e.content.id} className={rowShell}>
                    {contentLine(e.content)}
                    <StatusChip text="in the world" tone="ok" />
                    {isDM && (
                      <button
                        onClick={() => clearStatus.mutate(e.content.id)}
                        className="btn-base btn-ghost-red px-3 py-2 text-[11px]"
                      >
                        Cast out
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="font-accent px-1 py-2 text-[14px] italic text-cream-muted">
                None yet — homebrew arrives when a member offers it and the DM admits it.
              </div>
            )}
            {isDM && myShelf.length > 0 && (
              <div className="mt-3">
                <div className="label-stamp mb-2 text-[9px] tracking-[2px] text-ink-label">
                  From your shelf
                </div>
                <div className="flex flex-wrap gap-2">
                  {myShelf.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setStatus.mutate({ contentId: r.id, status: "enabled" })}
                      className="btn-base btn-ghost-ink px-3 py-2 text-[11px]"
                      title={`Admit ${r.name} to this world`}
                    >
                      + {r.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* SRD */}
          <section>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="label-stamp text-[10px] tracking-[2.5px] text-gold-muted">
                SRD 5.2 — legal unless banned
                {bannedCount > 0 && ` (${bannedCount} banned)`}
              </div>
              {isDM && srdEntries.length > 0 && !q && (
                <button
                  onClick={() => banAllSrd(bannedCount < srdEntries.length)}
                  className="label-stamp cursor-pointer border-none bg-transparent text-[10px] font-semibold text-gold-muted hover:text-ember-bright"
                >
                  {bannedCount < srdEntries.length
                    ? `Ban all SRD ${KINDS.find(([k]) => k === kind)?.[1].toLowerCase()}`
                    : "Restore all"}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              {srdEntries.map((r) => {
                const banned = byContent.get(r.id)?.status === "banned";
                return (
                  <div key={r.id} className={rowShell} style={banned ? { opacity: 0.55 } : undefined}>
                    {contentLine(r)}
                    <StatusChip text={banned ? "banned" : "legal"} tone={banned ? "no" : "ok"} />
                    {isDM && (
                      <button
                        onClick={() =>
                          banned
                            ? clearStatus.mutate(r.id)
                            : setStatus.mutate({ contentId: r.id, status: "banned" })
                        }
                        className={`btn-base px-3 py-2 text-[11px] ${banned ? "btn-ghost-ink" : "btn-ghost-red"}`}
                      >
                        {banned ? "Restore" : "Ban"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
