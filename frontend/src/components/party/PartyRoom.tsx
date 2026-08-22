import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Message } from "../../api/client";
import { usePartyMessages, useSendPartyMessage } from "../../hooks";

/*
A party's own room, for a table that has split (#181, #232).

The Chronicle is the whole table's; this is narrower. Its door is the DM and
whoever rides with the party right now — and riding elsewhere later takes
nothing already said out of it, because a message is a thing that happened
rather than a thing the roster owns.
*/
export function PartyRoom({ partyId, partyName }: { partyId: string; partyName: string }) {
  const { data: messages, isLoading } = usePartyMessages(partyId);
  const send = useSendPartyMessage(partyId);
  const [draft, setDraft] = useState("");
  const foot = useRef<HTMLDivElement>(null);

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
    <div className="mt-4 pt-3" style={{ borderTop: "1px solid rgba(201,162,39,.18)" }}>
      <div className="label-stamp mb-2 text-[10px] tracking-[1.5px] text-gold-muted">
        {partyName} — around the fire
      </div>
      <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 240 }}>
        {isLoading ? (
          <p className="font-accent m-0 text-[12.5px] italic text-[#9c855e]">Listening in…</p>
        ) : (messages ?? []).length === 0 ? (
          <p className="font-accent m-0 text-[12.5px] italic text-[#9c855e]">
            Nobody has said anything here yet.
          </p>
        ) : (
          (messages ?? []).map((m: Message) => (
            <div key={m.id} className="flex flex-wrap items-baseline gap-x-2">
              <span
                className="label-stamp flex-none text-[9px] tracking-[1px]"
                style={{ color: m.mine ? "#e0c890" : "#9c855e" }}
              >
                {m.mine ? "you" : m.authorName}
              </span>
              <span className="font-body min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] text-cream-soft">
                {m.body}
              </span>
            </div>
          ))
        )}
        <div ref={foot} />
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          aria-label={`Say something to ${partyName}`}
          placeholder="Say something to the party…"
          className="input-hall h-8 flex-1 text-[12px]"
        />
        <button
          type="submit"
          disabled={send.isPending || !draft.trim()}
          className="btn-base btn-ghost-gold h-8 px-3 text-[10px] disabled:opacity-40"
        >
          Say it
        </button>
      </form>
    </div>
  );
}
