import { useMemo, useState } from "react";
import type { HomebrewBookRow, ImportReport } from "../api/client";
import {
  useCurrentUser,
  useHomebrewBooks,
  useImportPack,
  useLogout,
  useMyCharacters,
  useResetHomebrew,
} from "../hooks";
import { initials, medallionFor } from "../lib/party";
import { exportHomebrewPack, parsePackFile } from "../lib/pack";
import MyHeroesPage from "./MyHeroesPage";
import ResetHomebrewModal from "./ResetHomebrewModal";
import GoldFrameButton from "./ui/GoldFrameButton";
import ParchmentModal from "./ui/ParchmentModal";
import { IconBook, IconGear, IconLogOut, IconTrash } from "./ui/icons";

const PROVIDER_LABEL: Record<string, string> = {
  discord: "Discord",
  google: "Google",
  dev: "Dev Forge",
};

const KIND_PLURAL: Record<string, [string, string]> = {
  class: ["class", "classes"],
  subclass: ["subclass", "subclasses"],
  species: ["species", "species"],
  background: ["background", "backgrounds"],
  feat: ["feat", "feats"],
  spell: ["spell", "spells"],
  item: ["item", "items"],
  monster: ["monster", "monsters"],
};

function countLabel(kind: string, n: number): string {
  const [one, many] = KIND_PLURAL[kind] ?? [kind, `${kind}s`];
  return `${n} ${n === 1 ? one : many}`;
}

/** One shelf in the library: an imported book, or the hand-scribed pile. */
type Shelf = { book: string | null; total: number; kinds: HomebrewBookRow[] };

function LibraryCard({
  shelf,
  onRemove,
}: {
  shelf: Shelf;
  onRemove: (book: string, total: number) => void;
}) {
  return (
    <div className="parchment flex flex-col px-[18px] pb-3.5 pt-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold leading-tight text-ink">
            {shelf.book ?? "My own creations"}
          </div>
          <div className="label-stamp mt-1 text-[8.5px] leading-relaxed tracking-[1px] text-ink-label">
            {shelf.kinds.map((r) => countLabel(r.kind, r.total)).join(" · ")}
          </div>
        </div>
        <span
          className="font-heading flex-none rounded-[3px] px-2 py-0.5 text-[11px] font-bold text-ink"
          style={{ background: "rgba(90,60,20,.12)" }}
        >
          {shelf.total}
        </span>
      </div>
      {shelf.book !== null && (
        <div className="mt-2.5 flex justify-end border-t pt-2" style={{ borderColor: "rgba(90,60,20,.2)" }}>
          <button
            onClick={() => onRemove(shelf.book!, shelf.total)}
            className="btn-base btn-ghost-red px-3 py-1.5 text-[10px]"
          >
            <IconTrash size={12} strokeWidth={1.8} />
            Remove this book
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Profile: who you are at this table, your heroes, and your library —
 * imported books (removable one at a time), exports, and the homebrew reset.
 */
export default function ProfilePage() {
  const { data: me } = useCurrentUser();
  const { data: heroes } = useMyCharacters();
  const { data: books } = useHomebrewBooks();
  const importPack = useImportPack();
  const reset = useResetHomebrew();
  const logout = useLogout();

  const [packReport, setPackReport] = useState<ImportReport | null>(null);
  const [packError, setPackError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [removing, setRemoving] = useState<{ book: string; total: number } | null>(null);
  const [removed, setRemoved] = useState<number | null>(null);

  const user = me?.user;
  const memberships = me?.campaigns ?? [];
  const dmOf = memberships.filter((m) => m.role === "dm").length;
  const playingIn = memberships.filter((m) => m.role !== "dm").length;

  // Fold the flat (book, kind) rows into shelves, imported books first.
  const shelves = useMemo((): Shelf[] => {
    const byBook = new Map<string | null, HomebrewBookRow[]>();
    for (const r of books?.rows ?? []) {
      const key = r.book ?? null;
      byBook.set(key, [...(byBook.get(key) ?? []), r]);
    }
    return [...byBook.entries()]
      .map(([book, kinds]) => ({
        book,
        kinds,
        total: kinds.reduce((n, r) => n + r.total, 0),
      }))
      .sort((a, b) => {
        if (a.book === null) return 1;
        if (b.book === null) return -1;
        return a.book.localeCompare(b.book);
      });
  }, [books]);
  const homebrewTotal = shelves.reduce((n, s) => n + s.total, 0);

  async function onPackFile(file: File) {
    setPackError("");
    const parsed = await parsePackFile(file);
    if ("error" in parsed) {
      setPackError(parsed.error);
      return;
    }
    importPack.mutate(parsed.entries, {
      onSuccess: (report) => setPackReport(report),
      onError: (e) =>
        setPackError((e as { error?: string } | null)?.error ?? "The crate would not open."),
    });
  }

  function doRemoveBook() {
    if (!removing) return;
    reset.mutate(
      { book: removing.book },
      { onSuccess: (r) => setRemoved(r?.deleted ?? 0) },
    );
  }

  const memberSince = user
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : "";

  const heroCount = heroes?.length ?? 0;
  const stats: Array<[number, string]> = [
    [dmOf, dmOf === 1 ? "table as DM" : "tables as DM"],
    [playingIn, playingIn === 1 ? "table as player" : "tables as player"],
    [heroCount, heroCount === 1 ? "hero forged" : "heroes forged"],
    [homebrewTotal, homebrewTotal === 1 ? "homebrew entry" : "homebrew entries"],
  ];

  return (
    <div className="flex flex-col gap-7">
      {/* ── identity ── */}
      <div className="panel-hall px-5 py-7 sm:px-[30px]">
        <div className="flex flex-wrap items-center gap-5">
          {user?.image ? (
            <img
              src={user.image}
              alt=""
              className="h-[76px] w-[76px] flex-none rounded-[4px] object-cover"
              style={{ boxShadow: "inset 0 0 0 2px rgba(201,162,39,.5), 0 3px 8px rgba(0,0,0,.4)" }}
            />
          ) : (
            <div
              className="font-heading flex h-[76px] w-[76px] flex-none items-center justify-center rounded-[4px] text-[26px] font-bold text-[#f3e6c8]"
              style={{
                background: medallionFor(user?.id ?? "?"),
                boxShadow: "inset 0 0 0 2px rgba(201,162,39,.5), 0 3px 8px rgba(0,0,0,.4)",
              }}
            >
              {initials(user?.name ?? "") || "?"}
            </div>
          )}
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2
                className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
                style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
              >
                {user?.name}
              </h2>
              <span
                className="label-stamp rounded-[2px] px-2 py-1 text-[9px] font-semibold tracking-[1.5px] text-gold-muted"
                style={{
                  background: "rgba(16,9,5,.35)",
                  boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)",
                }}
              >
                via {PROVIDER_LABEL[user?.provider ?? ""] ?? user?.provider}
              </span>
            </div>
            <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
              {user?.email ? `${user.email} · ` : ""}at the table since {memberSince}
            </div>
          </div>
          <GoldFrameButton onClick={() => logout.mutate()}>
            <IconLogOut size={14} strokeWidth={1.9} />
            Sign out
          </GoldFrameButton>
        </div>

        <div
          className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t pt-4"
          style={{ borderColor: "rgba(201,162,39,.25)" }}
        >
          {stats.map(([n, label]) => (
            <div key={label}>
              <span className="font-heading text-xl font-bold text-[#e0a94e]">{n}</span>
              <span className="label-stamp ml-2 text-[10px] tracking-[1.5px] text-gold-muted">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── heroes (the whole roster, moved in from the nav) ── */}
      <MyHeroesPage />

      {/* ── library ── */}
      <div className="panel-hall px-5 pb-9 pt-8 sm:px-[30px]">
        <div
          className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-3.5"
          style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
        >
          <div className="flex flex-wrap items-baseline gap-3.5">
            <h2
              className="font-display m-0 text-[clamp(22px,3vw,28px)] font-black text-[#e7d3a6]"
              style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
            >
              My Library
            </h2>
            {homebrewTotal > 0 && (
              <span className="label-stamp text-xs text-gold-muted">
                {homebrewTotal} entries beyond the SRD
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="label-stamp cursor-pointer text-[11px] font-semibold text-gold-muted transition hover:text-ember-bright">
              Import a pack
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPackFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={exportHomebrewPack}
              className="label-stamp cursor-pointer border-none bg-transparent text-[11px] font-semibold text-gold-muted transition hover:text-ember-bright"
            >
              Export my homebrew
            </button>
            <button
              onClick={() => setResetting(true)}
              className="label-stamp cursor-pointer border-none bg-transparent text-[11px] font-semibold text-[#b5654e] transition hover:text-[#d98066]"
            >
              Reset my homebrew
            </button>
          </div>
        </div>

        {packError && (
          <div className="font-body mb-4 text-sm italic text-[#c96a5a]">{packError}</div>
        )}
        {importPack.isPending && (
          <div className="font-accent mb-4 text-sm italic text-cream-muted">
            Unpacking the crate…
          </div>
        )}

        {shelves.length === 0 ? (
          <div className="px-5 py-[50px] text-center">
            <div className="mb-3 inline-flex text-[#7a5e34]">
              <IconBook size={40} strokeWidth={1.4} />
            </div>
            <div className="font-display text-xl text-[#cdb582]">
              Only the SRD so far
            </div>
            <div className="font-accent mt-2 text-[15px] italic text-[#9c855e]">
              — import a pack or scribe your own in the Archives. —
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(270px,100%),1fr))] gap-4">
            {shelves.map((s) => (
              <LibraryCard
                key={s.book ?? "(own)"}
                shelf={s}
                onRemove={(book, total) => {
                  setRemoved(null);
                  setRemoving({ book, total });
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── settings stub ── */}
      <div className="panel-hall px-5 py-6 sm:px-[30px]">
        <div className="flex items-center gap-3">
          <span className="text-[#7a5e34]">
            <IconGear size={22} strokeWidth={1.6} />
          </span>
          <div>
            <span className="font-display text-lg font-bold text-[#cdb582]">Settings</span>
            <span className="font-accent ml-3 text-[13px] italic text-[#9c855e]">
              — coming in a future update. —
            </span>
          </div>
        </div>
      </div>

      {resetting && <ResetHomebrewModal onClose={() => setResetting(false)} />}

      {removing && (
        <ParchmentModal
          onClose={() => setRemoving(null)}
          maxWidth="max-w-[480px]"
        >
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            My Library
          </div>
          <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
            Remove the Book
          </h3>
          {removed !== null ? (
            <>
              <p className="font-body m-0 mb-5 text-center text-[13.5px] italic text-ink-body">
                {removed} {removed === 1 ? "entry" : "entries"} from{" "}
                <b>{removing.book}</b> struck from your library.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => setRemoving(null)}
                  className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className="mb-4 rounded-[4px] px-3.5 py-3"
                style={{
                  background: "rgba(139,37,32,.08)",
                  border: "1px solid rgba(139,37,32,.25)",
                }}
              >
                <p className="font-body m-0 text-[13px] text-ink-body">
                  This strikes all <b>{removing.total}</b>{" "}
                  {removing.total === 1 ? "entry" : "entries"} from{" "}
                  <b>{removing.book}</b>. Characters using them degrade the
                  same way a reset would — spells vanish, items become plain
                  text, class and species links clear. Re-importing the pack
                  restores the entries, but not those links.
                </p>
              </div>
              {reset.isError && (
                <div className="font-body mb-3 text-sm italic text-[#8b2520]">
                  The removal failed — nothing was struck.
                </div>
              )}
              <div className="flex items-center justify-end gap-4">
                <button
                  onClick={() => setRemoving(null)}
                  className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={doRemoveBook}
                  disabled={reset.isPending}
                  className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "#8b2520", color: "#f3e6c8" }}
                >
                  {reset.isPending ? "Removing…" : "Remove the book"}
                </button>
              </div>
            </>
          )}
        </ParchmentModal>
      )}

      {packReport && (
        <ParchmentModal onClose={() => setPackReport(null)} maxWidth="max-w-[520px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            My Library
          </div>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
            Pack Unpacked
          </h3>
          <p className="font-body m-0 mb-4 text-center text-[13.5px] italic text-ink-body">
            {packReport.created} scribed anew · {packReport.updated} updated
            {packReport.failed > 0 && ` · ${packReport.failed} refused`}
          </p>
          {packReport.failed > 0 && (
            <div className="mb-4 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
              {packReport.results
                .filter((r) => r.status === "failed")
                .map((r, i) => (
                  <div key={i} className="text-[12.5px]">
                    <span className="font-heading font-bold">{r.name || "(unnamed)"}</span>
                    <span className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-ink-label">
                      {r.kind}
                    </span>
                    <span className="text-[#8b2520]"> — {r.error}</span>
                  </div>
                ))}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={() => setPackReport(null)}
              className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]"
            >
              Done
            </button>
          </div>
        </ParchmentModal>
      )}
    </div>
  );
}
