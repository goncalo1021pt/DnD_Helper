import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Friend, Message } from "../api/client";
import {
  useAcceptFriend,
  useAskFriend,
  useBlockUser,
  useDropFriend,
  useFriends,
  useReforgeFriendCode,
  useSendDirectMessage,
  useThread,
  useThreads,
  useUnblockUser,
} from "../hooks";
import { IconUsers } from "./ui/icons";

/*
Friends, and talking to them (#181).

Campaign chat already existed and is called the Chronicle; this is what it never
covered — knowing somebody outside a campaign, and saying something to one
person rather than to the room.

Discovery is a CODE you hand out, not a search. There is no box to type a name
into on purpose: a search over accounts is an enumeration door onto what is
meant to be a private tavern, and an account that arrived through Google has no
username to be found by anyway.
*/

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({ name, image, size = 34 }: { name: string; image?: string | null; size?: number }) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        className="flex-none rounded-full object-cover"
        style={{ boxShadow: "inset 0 0 0 1px rgba(201,162,39,.45)" }}
      />
    );
  }
  return (
    <span
      className="font-heading flex flex-none items-center justify-center rounded-full text-[12px] font-bold text-[#f0dfb8]"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(140deg,#4a3a26,#241a10)",
        boxShadow: "inset 0 0 0 1px rgba(201,162,39,.45)",
      }}
    >
      {initialsOf(name) || "?"}
    </span>
  );
}

/** One conversation, read down the page, with the composer under it. */
function Thread({ peer }: { peer: Friend | { userId: string; name: string } }) {
  const { data: messages, isLoading } = useThread(peer.userId);
  const send = useSendDirectMessage(peer.userId);
  const [draft, setDraft] = useState("");
  const foot = useRef<HTMLDivElement>(null);

  // A conversation is read from its end.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    send.mutate(body, { onSuccess: () => setDraft("") });
  }

  return (
    <div className="flex min-h-[420px] flex-col">
      <div
        className="mb-3 flex items-center gap-2.5 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <Avatar name={peer.name} />
        <span className="font-display text-[17px] font-bold text-cream">{peer.name}</span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 420 }}>
        {isLoading ? (
          <p className="font-accent text-[13px] italic text-[#9c855e]">Turning back the page…</p>
        ) : (messages ?? []).length === 0 ? (
          <p className="font-accent text-[13px] italic text-[#9c855e]">
            Nothing said yet. Say the first thing.
          </p>
        ) : (
          (messages ?? []).map((m: Message) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] rounded-[4px] px-3 py-2"
                style={{
                  background: m.mine ? "rgba(201,162,39,.13)" : "rgba(255,255,255,.05)",
                  boxShadow: `inset 0 0 0 1px ${m.mine ? "rgba(201,162,39,.3)" : "rgba(255,255,255,.08)"}`,
                }}
              >
                {!m.mine && (
                  <div className="label-stamp mb-0.5 text-[9px] tracking-[1px] text-gold-muted">
                    {m.authorName}
                  </div>
                )}
                <div className="font-body whitespace-pre-wrap break-words text-[13.5px] text-cream-soft">
                  {m.body}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={foot} />
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          aria-label={`Say something to ${peer.name}`}
          placeholder="Say something…"
          className="input-hall h-10 flex-1 text-[13px]"
        />
        <button
          type="submit"
          disabled={send.isPending || !draft.trim()}
          className="btn-base btn-gold clip-octagon h-10 px-4 text-[11px] disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default function CompanionsPage() {
  const { data: roll, isLoading } = useFriends();
  const { data: threads } = useThreads();
  const ask = useAskFriend();
  const accept = useAcceptFriend();
  const drop = useDropFriend();
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const reforge = useReforgeFriendCode();

  const [code, setCode] = useState("");
  const [askError, setAskError] = useState("");
  const [open, setOpen] = useState<{ userId: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const friends = roll?.friends ?? [];
  const mutual = useMemo(() => friends.filter((f) => f.state === "accepted"), [friends]);
  const invited = useMemo(() => friends.filter((f) => f.direction === "invited"), [friends]);
  const asked = useMemo(() => friends.filter((f) => f.direction === "asked"), [friends]);
  const unreadOf = (id: string) => threads?.find((t) => t.peerId === id)?.unread ?? 0;

  function submitCode(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setAskError("");
    ask.mutate(trimmed, {
      onSuccess: () => setCode(""),
      onError: (err) => {
        const msg = (err as { error?: string })?.error;
        // A code nobody holds and a code held by somebody who blocked you
        // answer alike, so the words have to cover both without saying which.
        setAskError(
          msg && !/not found/i.test(msg) ? msg : "No one answers to that code.",
        );
      },
    });
  }

  return (
    <div className="space-y-12">
      <section>
        <div
          className="mb-7 flex flex-wrap items-baseline gap-x-3.5 pb-3.5"
          style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
        >
          <div className="font-accent w-full text-base italic tracking-[.16em] text-[#c89a5a]">
            Beyond your own tables
          </div>
          <h2 className="font-heading m-0 text-[clamp(26px,3vw,34px)] font-semibold text-[#f3e6c8]">
            Companions
          </h2>
          {mutual.length > 0 && (
            <span className="label-stamp text-xs text-gold-muted">{mutual.length} known</span>
          )}
        </div>

        {open ? (
          <div className="panel-hall px-6 pb-6 pt-5">
            <button
              onClick={() => setOpen(null)}
              className="label-stamp mb-3 cursor-pointer border-none bg-transparent p-0 text-[10px] tracking-[2px] text-gold-muted transition hover:text-ember-bright"
            >
              ← all companions
            </button>
            <Thread peer={open} />
          </div>
        ) : isLoading ? (
          <p className="font-accent text-base italic text-[#9c855e]">Asking after them…</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr,1fr]">
            <div className="space-y-6">
              {invited.length > 0 && (
                <section className="panel-hall px-6 pb-5 pt-4">
                  <div className="label-stamp mb-3 text-[10px] tracking-[2px] text-gold-muted">
                    Waiting on you
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {invited.map((f) => (
                      <li key={f.userId} className="flex flex-wrap items-center gap-2.5">
                        <Avatar name={f.name} image={f.image} />
                        <span className="font-heading flex-1 text-[14px] font-bold text-cream">
                          {f.name}
                        </span>
                        <button
                          onClick={() => accept.mutate(f.userId)}
                          className="btn-base btn-gold h-8 px-3 text-[10px]"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => drop.mutate(f.userId)}
                          className="btn-base btn-ghost-gold h-8 px-3 text-[10px]"
                        >
                          Decline
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="panel-hall px-6 pb-5 pt-4">
                <div className="label-stamp mb-3 text-[10px] tracking-[2px] text-gold-muted">
                  Your companions
                </div>
                {mutual.length === 0 ? (
                  <div className="px-2 py-8 text-center">
                    <div className="mb-3 inline-flex text-[#7a5e34]">
                      <IconUsers size={34} strokeWidth={1.4} />
                    </div>
                    <div className="font-accent text-[15px] italic text-[#9c855e]">
                      — nobody yet. Hand somebody your code, or ask for theirs. —
                    </div>
                  </div>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {mutual.map((f) => (
                      <li key={f.userId} className="flex flex-wrap items-center gap-2.5">
                        <Avatar name={f.name} image={f.image} />
                        <span className="font-heading flex-1 text-[14px] font-bold text-cream">
                          {f.name}
                        </span>
                        {unreadOf(f.userId) > 0 && (
                          <span
                            className="label-stamp rounded-full px-2 py-0.5 text-[9px] tracking-[1px] text-[#f0dfb8]"
                            style={{ background: "rgba(139,37,32,.75)" }}
                          >
                            {unreadOf(f.userId)}
                          </span>
                        )}
                        <button
                          onClick={() => setOpen({ userId: f.userId, name: f.name })}
                          className="btn-base btn-gold h-8 px-3 text-[10px]"
                        >
                          Talk
                        </button>
                        <button
                          onClick={() => drop.mutate(f.userId)}
                          className="btn-base btn-ghost-gold h-8 px-3 text-[10px]"
                        >
                          Part ways
                        </button>
                        <button
                          onClick={() => block.mutate(f.userId)}
                          title="Stops it in both directions, and parts you"
                          className="btn-base btn-ghost-gold h-8 px-3 text-[10px]"
                        >
                          Block
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {(threads ?? []).length > 0 && (
                <section className="panel-hall px-6 pb-5 pt-4">
                  <div className="label-stamp mb-3 text-[10px] tracking-[2px] text-gold-muted">
                    Conversations
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {(threads ?? []).map((t) => (
                      <li key={t.peerId}>
                        <button
                          onClick={() => setOpen({ userId: t.peerId, name: t.peerName })}
                          className="flex w-full cursor-pointer items-center gap-2.5 rounded-[3px] border-none bg-transparent px-2 py-2 text-left transition hover:bg-[rgba(255,255,255,.04)]"
                        >
                          <Avatar name={t.peerName} image={t.peerImage} size={30} />
                          <span className="min-w-0 flex-1">
                            <span className="font-heading block text-[13.5px] font-bold text-cream">
                              {t.peerName}
                            </span>
                            <span className="font-body block truncate text-[12.5px] text-cream-muted">
                              {t.lastWasMine ? "you: " : ""}
                              {t.lastBody}
                            </span>
                          </span>
                          {t.unread > 0 && (
                            <span
                              className="label-stamp flex-none rounded-full px-2 py-0.5 text-[9px] tracking-[1px] text-[#f0dfb8]"
                              style={{ background: "rgba(139,37,32,.75)" }}
                            >
                              {t.unread}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="space-y-6">
              <section className="parchment px-7 py-6">
                <h3 className="label-stamp m-0 mb-1.5 text-sm font-bold text-ink-strong">
                  Your Sigil
                </h3>
                <p className="font-body m-0 mb-4 text-sm italic text-ink-body">
                  Hand this to somebody and they can ask for you. There is no
                  searching for people here, by design.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    className="font-heading rounded-[3px] px-3 py-2 text-[17px] font-bold tracking-[3px] text-ink-strong"
                    style={{ background: "rgba(60,35,15,.09)", boxShadow: "inset 0 0 0 1px rgba(60,35,15,.25)" }}
                  >
                    {roll?.friendCode ?? "········"}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(roll?.friendCode ?? "");
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    }}
                    className="btn-base btn-ghost-ink h-9 px-3 text-[11px]"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => reforge.mutate(undefined)}
                    disabled={reforge.isPending}
                    title="Retires the old code. Everyone you already know stays."
                    className="btn-base btn-ghost-ink h-9 px-3 text-[11px]"
                  >
                    Reforge
                  </button>
                </div>
              </section>

              <section className="parchment px-7 py-6">
                <h3 className="label-stamp m-0 mb-1.5 text-sm font-bold text-ink-strong">
                  Ask for Someone
                </h3>
                <p className="font-body m-0 mb-4 text-sm italic text-ink-body">
                  Type the code they gave you.
                </p>
                <form onSubmit={submitCode} className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    maxLength={32}
                    aria-label="Their friend code"
                    placeholder="Friend code"
                    className="input-parchment input-compact font-heading flex-1 uppercase tracking-[2px]"
                  />
                  <button
                    type="submit"
                    disabled={ask.isPending || !code.trim()}
                    className="btn-base btn-wax clip-octagon h-10 px-5 text-xs"
                  >
                    {ask.isPending ? "Asking…" : "Ask"}
                  </button>
                </form>
                {askError && (
                  <p className="font-body mt-2 text-sm italic text-[#8b2520]">{askError}</p>
                )}
                {asked.length > 0 && (
                  <div className="mt-4">
                    <div className="label-stamp mb-1.5 text-[10px] tracking-[1.5px] text-ink-label">
                      Asked, not yet answered
                    </div>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {asked.map((f) => (
                        <li key={f.userId} className="flex items-center gap-2">
                          <span className="font-body flex-1 text-[13px] text-ink-body">{f.name}</span>
                          <button
                            onClick={() => drop.mutate(f.userId)}
                            className="btn-base btn-ghost-ink h-7 px-2 text-[10px]"
                          >
                            Withdraw
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {(roll?.blocked ?? []).length > 0 && (
                <section className="parchment px-7 py-6">
                  <h3 className="label-stamp m-0 mb-1.5 text-sm font-bold text-ink-strong">
                    Blocked
                  </h3>
                  <p className="font-body m-0 mb-4 text-sm italic text-ink-body">
                    Nothing passes either way. Lifting it does not make you
                    companions again — that has to be asked for.
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {(roll?.blocked ?? []).map((b) => (
                      <li key={b.userId} className="flex items-center gap-2">
                        <span className="font-body flex-1 text-[13px] text-ink-body">{b.name}</span>
                        <button
                          onClick={() => unblock.mutate(b.userId)}
                          className="btn-base btn-ghost-ink h-7 px-2 text-[10px]"
                        >
                          Lift it
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
