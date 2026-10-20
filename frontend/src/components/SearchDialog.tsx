import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SearchHit, SearchKind } from "../api/client";
import { SEARCH_MIN, useCampaignSearch } from "../hooks";
import { openReader } from "./ui/Reader";
import { IconSearch, IconX } from "./ui/icons";

/*
One box over the table (#321).

Whatever the server answers is already what this viewer may read — it composes
the answer from the same doors the screens use — so this only asks, lists and
opens. Opening means going to the thing: a place's page, a map, a person or a
notice flashed where it stands, a handout in its lightbox, a rules entry in the
shared reader.
*/

const GROUP: Record<SearchKind, string> = {
  place: "Places",
  person: "People",
  quest: "Quests",
  handout: "Handouts",
  map: "Maps",
  chronicle: "Chronicle",
  bestiary: "Bestiary",
  monster: "Monsters",
  spell: "Spells",
  item: "Items",
  feat: "Feats",
  rule: "Rules",
  class: "Classes",
  subclass: "Subclasses",
  species: "Species",
  background: "Backgrounds",
};

const RULES_KINDS = new Set<SearchKind>([
  "monster", "spell", "item", "feat", "rule", "class", "subclass", "species", "background",
]);

export default function SearchDialog({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);

  // Ask once the typing pauses, not on every key.
  useEffect(() => {
    const t = window.setTimeout(() => setAsked(text), 220);
    return () => window.clearTimeout(t);
  }, [text]);

  const { data, isFetching, isError } = useCampaignSearch(campaignId, asked);
  const tooShort = text.trim().length < SEARCH_MIN;
  const hits = useMemo(() => (tooShort ? [] : (data?.hits ?? [])), [data, tooShort]);
  useEffect(() => setActive(0), [data]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-hit-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  async function open(hit: SearchHit) {
    const base = `/questboard/campaigns/${campaignId}`;
    if (RULES_KINDS.has(hit.kind)) {
      // The same key useRulesEntry reads, so a hover card later is warm.
      const entry = await qc
        .fetchQuery({
          queryKey: ["rules-entry", hit.id],
          staleTime: 5 * 60_000,
          queryFn: async () => {
            const { data, error } = await api.GET("/rules/content/{contentId}", {
              params: { path: { contentId: hit.id } },
            });
            if (error) throw error;
            return data;
          },
        })
        .catch(() => undefined);
      onClose();
      if (entry) openReader(entry);
      return;
    }
    onClose();
    switch (hit.kind) {
      case "place":
        return navigate(`${base}/world/${hit.id}`);
      case "map":
        return navigate(`${base}/map/${hit.id}`);
      case "person":
        return navigate(`${base}/npcs?focus=${hit.id}`);
      case "quest":
        return navigate(`${base}/board?focus=${hit.id}`);
      case "chronicle":
        return navigate(`${base}/chronicle?focus=${hit.id}`);
      case "handout":
        return navigate(`${base}/chronicle?handout=${hit.id}`);
      case "bestiary":
        return navigate(`${base}/bestiary?open=${hit.id}`);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      void open(hits[active]);
    }
  }

  // Hits arrive grouped by kind; a heading goes above the first of each.
  let index = -1;
  const counts = data?.counts ?? {};

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[10vh]"
      style={{ background: "rgba(12,7,3,.72)", backdropFilter: "blur(2px)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search this table"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        className="parchment anim-rise-fast flex max-h-[78svh] w-full max-w-[620px] flex-col"
        style={{ boxShadow: "0 30px 70px rgba(0,0,0,.7), inset 0 0 40px rgba(150,110,60,.12)" }}
      >
        <div className="flex items-center gap-2.5 border-b px-5 py-3.5" style={{ borderColor: "rgba(90,60,20,.25)" }}>
          <span className="text-ink-label">
            <IconSearch size={18} strokeWidth={2} />
          </span>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={100}
            aria-label="Search"
            placeholder="Search places, people, quests, spells…"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="search-results"
            aria-activedescendant={hits.length ? `search-hit-${active}` : undefined}
            className="font-body min-w-0 flex-1 border-none bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-faded"
          />
          {isFetching && !tooShort && (
            <span className="font-accent text-[12px] italic text-ink-label">looking…</span>
          )}
          <button
            onClick={onClose}
            title="Close"
            className="inline-flex cursor-pointer border-none bg-transparent p-1 text-ink-faded hover:text-ink"
          >
            <IconX size={18} strokeWidth={2} />
          </button>
        </div>

        <div ref={listRef} id="search-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {tooShort ? (
            <p className="font-accent m-0 px-3 py-6 text-center text-[14px] italic text-ink-label">
              Type a name, or a word you remember. Press / anywhere at the table to search.
            </p>
          ) : isError ? (
            <p className="font-body m-0 px-3 py-6 text-center text-[14px] italic text-[#8b2520]">
              The search could not be asked. Try again.
            </p>
          ) : data && hits.length === 0 && !isFetching ? (
            <p className="font-accent m-0 px-3 py-6 text-center text-[14px] italic text-ink-label">
              Nothing at this table answers to “{data.query}”.
            </p>
          ) : (
            hits.map((h, i) => {
              index = i;
              const first = i === 0 || hits[i - 1].kind !== h.kind;
              const last = i === hits.length - 1 || hits[i + 1].kind !== h.kind;
              const shown = hits.filter((x) => x.kind === h.kind).length;
              const more = (counts[h.kind] ?? shown) - shown;
              return (
                <div key={`${h.kind}:${h.id}`}>
                  {first && (
                    <div className="label-stamp px-3 pb-1 pt-3 text-[10px] tracking-[2px] text-ink-label">
                      {GROUP[h.kind]}
                    </div>
                  )}
                  <button
                    id={`search-hit-${i}`}
                    data-hit-index={i}
                    role="option"
                    aria-selected={active === i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void open(h)}
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[3px] border-none bg-transparent px-3 py-2 text-left"
                    style={{ background: active === i ? "rgba(139,37,32,.1)" : undefined }}
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="font-heading min-w-0 truncate text-[14.5px] font-bold text-ink">
                        {h.title}
                      </span>
                      {h.subtitle && (
                        <span className="font-body min-w-0 truncate text-[12.5px] italic text-ink-label">
                          {h.subtitle}
                        </span>
                      )}
                    </span>
                    {h.snippet && (
                      <span className="font-body line-clamp-2 text-[13px] text-ink-body">{h.snippet}</span>
                    )}
                  </button>
                  {last && more > 0 && (
                    <div className="font-accent px-3 pb-1 text-[12px] italic text-ink-label">
                      and {more} more — say a little more to find them
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {index >= 0 && (
          <div
            className="font-body hidden border-t px-5 py-2 text-[12px] text-ink-label sm:block"
            style={{ borderColor: "rgba(90,60,20,.25)" }}
          >
            ↑ ↓ to move · Enter to open · Esc to close
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
