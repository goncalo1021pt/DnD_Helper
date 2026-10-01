import { useState } from "react";
import { Link } from "react-router-dom";
import { useBefriend, useCharacters, useCurrentUser, useFriends, useMembers } from "../../hooks";
import { classLine } from "../../lib/classes";
import Face from "../dm/Face";
import ParchmentModal from "./ParchmentModal";

/**
 * A person's name is a door to who they are at this table (#302): their
 * face, whether they run it, the heroes they play here, and the two ways to
 * reach them — a word, or a friendship. The card is built entirely from what
 * a member already reads (the members list and the roster), so it opens no
 * new window onto anybody: there is no page for a stranger to land on.
 */
export default function Person({
  userId,
  name,
  campaignId,
  className,
}: {
  userId: string;
  name: string;
  campaignId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        data-person={userId}
        title={`Who is ${name}?`}
        className={`${className ?? ""} m-0 inline cursor-pointer border-none bg-transparent p-0 text-left underline decoration-dotted decoration-1 underline-offset-2`}
      >
        {name}
      </button>
      {open && <PersonCard userId={userId} name={name} campaignId={campaignId} onClose={() => setOpen(false)} />}
    </>
  );
}

function PersonCard({
  userId,
  name,
  campaignId,
  onClose,
}: {
  userId: string;
  name: string;
  campaignId: string;
  onClose: () => void;
}) {
  const { data: me } = useCurrentUser();
  const { data: members } = useMembers(campaignId);
  const { data: characters } = useCharacters(campaignId);
  const { data: roll } = useFriends();
  const befriend = useBefriend();

  const member = members?.find((m) => m.userId === userId);
  const heroes = (characters ?? []).filter((c) => c.ownerUserId === userId && !c.tableBorn);
  const friend = roll?.friends.find((f) => f.userId === userId);
  const itsMe = me?.user.id === userId;
  const shownName = member?.name ?? name;

  const standing = !member
    ? "No longer at this table"
    : member.isOwner
      ? "Dungeon Master · holds the table"
      : member.role === "dm"
        ? "Dungeon Master"
        : "Player";

  return (
    <ParchmentModal onClose={onClose}>
      <div className="mb-4 flex items-center gap-3.5" data-testid="person-card">
        <Face name={shownName} image={member?.image} id={userId} />
        <div className="min-w-0">
          <h3 className="font-display m-0 truncate text-[20px] font-black text-ink">{shownName}</h3>
          <div className="label-stamp text-[10px] tracking-[1.5px] text-ink-label">{standing}</div>
        </div>
      </div>

      {heroes.length > 0 && (
        <div className="mb-5">
          <div className="label-stamp mb-1.5 text-[10px] tracking-[1.5px] text-ink-label">Plays here</div>
          <ul className="m-0 grid list-none gap-1 p-0">
            {heroes.map((h) => (
              <li key={h.id} className="font-body text-[13.5px] text-ink-body">
                <Link
                  to={`/questboard/heroes/${h.id}`}
                  onClick={onClose}
                  className="font-heading font-bold text-ink no-underline hover:text-[#8b2520]"
                >
                  {h.name}
                </Link>
                <span className="text-ink-label"> · Lv {h.level} {classLine(h)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {itsMe ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-accent text-[14px] italic text-ink-label">This is you.</span>
          <Link
            to="/questboard/profile"
            onClick={onClose}
            className="btn-base btn-ghost-ink px-4 py-2 text-[11px] no-underline"
          >
            Your profile
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {friend?.state === "accepted" ? (
            <span className="label-stamp text-[10px] tracking-[1.5px] text-ink-label">Friends</span>
          ) : friend?.direction === "asked" ? (
            <span className="label-stamp text-[10px] tracking-[1.5px] text-ink-label">Asked — waiting on them</span>
          ) : (
            member && (
              <button
                onClick={() => befriend.mutate(userId)}
                disabled={befriend.isPending}
                className="btn-base btn-ghost-ink px-4 py-2 text-[11px] disabled:opacity-50"
              >
                {friend?.direction === "invited" ? "Accept their request" : "Ask to be friends"}
              </button>
            )
          )}
          <Link
            to={`/questboard/companions?with=${userId}&name=${encodeURIComponent(shownName)}`}
            onClick={onClose}
            className="btn-base btn-wax px-4 py-2 text-[11px] no-underline"
          >
            Send a word
          </Link>
        </div>
      )}
    </ParchmentModal>
  );
}
