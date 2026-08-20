import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useCampaigns,
  useCreateCampaign,
  useJoinCampaign,
  useRealms,
  useRenameRealm,
} from "../hooks";
import type { CampaignMembership } from "../api/client";
import RoleBadge from "./ui/RoleBadge";

/*
The ledger, and the ground each table stands on (#233).

A realm is only worth naming out loud once it holds more than one campaign.
Every table that existed before realms got one of its own, named after it, so
showing a heading for each would be a page of headings saying nothing — the
same trap the roster avoids by only banding heroes into parties once there is
more than one party. A table alone on its ground therefore reads exactly as it
always did, and a realm appears the moment it starts being a shared place.
*/

interface RealmGroup {
  realmId: string;
  realmName: string;
  items: CampaignMembership[];
}

function groupByRealm(memberships: CampaignMembership[]): RealmGroup[] {
  const by = new Map<string, RealmGroup>();
  for (const m of memberships) {
    const id = m.campaign.realmId;
    const group = by.get(id);
    if (group) group.items.push(m);
    else by.set(id, { realmId: id, realmName: m.campaign.realmName, items: [m] });
  }
  return [...by.values()];
}

function CampaignCard({ m, tilt }: { m: CampaignMembership; tilt: number }) {
  return (
    <li className="relative" style={{ transform: `rotate(${tilt}deg)` }}>
      <div className="nailhead absolute -top-[9px] left-1/2 z-[6] -translate-x-1/2" />
      <Link
        to={`/questboard/campaigns/${m.campaign.id}`}
        className="parchment block px-[22px] pb-5 pt-6 no-underline transition hover:-translate-y-0.5"
      >
        <div className="font-display mb-3 text-xl font-bold leading-tight text-ink">
          {m.campaign.name}
        </div>
        <RoleBadge role={m.role} />
      </Link>
    </li>
  );
}

const CARD_GRID =
  "m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-x-[26px] gap-y-[30px] p-0";

/** A shared realm's heading, with its name editable by whoever owns it. */
function RealmHeading({ group, mine }: { group: RealmGroup; mine: boolean }) {
  const rename = useRenameRealm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.realmName);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || name === group.realmName) return setEditing(false);
    rename.mutate({ realmId: group.realmId, name }, { onSuccess: () => setEditing(false) });
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mb-5 flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={120}
          aria-label="Name of the realm"
          className="input-parchment input-compact max-w-[280px] flex-1"
        />
        <button
          type="submit"
          disabled={rename.isPending || !draft.trim()}
          className="btn-base btn-ghost-gold h-8 px-3 text-[10px]"
        >
          {rename.isPending ? "Naming…" : "Name it"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(group.realmName);
            setEditing(false);
          }}
          className="btn-base btn-ghost-gold h-8 px-3 text-[10px]"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-3">
      <span className="label-stamp text-xs tracking-[2px] text-[#c89a5a]">
        {group.realmName}
      </span>
      <span className="font-accent text-[13px] italic text-[#9c855e]">
        {group.items.length} campaigns on this ground
      </span>
      {mine && (
        <button
          onClick={() => setEditing(true)}
          className="btn-base btn-ghost-gold ml-auto h-7 px-2.5 py-0 text-[10px]"
        >
          Rename the realm
        </button>
      )}
    </div>
  );
}

export default function CampaignsPage() {
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: realms } = useRealms();
  const createCampaign = useCreateCampaign();
  const joinCampaign = useJoinCampaign();
  const [name, setName] = useState("");
  const [realmId, setRealmId] = useState("");
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");

  const groups = useMemo(() => groupByRealm(campaigns ?? []), [campaigns]);
  // A realm with one campaign in it is a private container, not a place worth
  // announcing; the tables standing alone keep the plain ledger they had.
  const alone = groups.filter((g) => g.items.length === 1).flatMap((g) => g.items);
  const shared = groups.filter((g) => g.items.length > 1);
  const ownedRealms = new Set((realms ?? []).map((r) => r.id));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createCampaign.mutate(
      { name: trimmed, realmId: realmId || undefined },
      {
        onSuccess: () => {
          setName("");
          setRealmId("");
        },
      },
    );
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setJoinError("");
    joinCampaign.mutate(trimmed, {
      onSuccess: () => setCode(""),
      // A bad code gets the flavor line; a real refusal (e.g. banned) speaks
      // with the server's own words.
      onError: (err) => {
        const msg = (err as { error?: string })?.error;
        setJoinError(
          msg && !/not found/i.test(msg) ? msg : "No table answers to that code.",
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
            The hall ledger
          </div>
          <h2 className="font-heading m-0 text-[clamp(26px,3vw,34px)] font-semibold text-[#f3e6c8]">
            Your Campaigns
          </h2>
          {campaigns && campaigns.length > 0 && (
            <span className="label-stamp text-xs text-gold-muted">
              {campaigns.length} at the table
            </span>
          )}
        </div>

        {isLoading ? (
          <p className="font-accent text-base italic text-[#9c855e]">
            Fetching the ledgers…
          </p>
        ) : campaigns && campaigns.length > 0 ? (
          <div className="space-y-10">
            {alone.length > 0 && (
              <ul className={CARD_GRID}>
                {alone.map((m, i) => (
                  <CampaignCard key={m.campaign.id} m={m} tilt={((i % 3) - 1) * 0.8} />
                ))}
              </ul>
            )}
            {shared.map((g) => (
              <section
                key={g.realmId}
                className="pt-7"
                style={{ borderTop: "1px solid rgba(201,162,39,.18)" }}
              >
                <RealmHeading group={g} mine={ownedRealms.has(g.realmId)} />
                <ul className={CARD_GRID}>
                  {g.items.map((m, i) => (
                    <CampaignCard key={m.campaign.id} m={m} tilt={((i % 3) - 1) * 0.8} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <div className="font-display text-2xl text-[#cdb582]">
              No campaigns yet
            </div>
            <div className="font-accent mt-2 text-base italic text-[#9c855e]">
              — found a new table below, or join one with a code. —
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="parchment px-7 py-6">
          <h3 className="label-stamp m-0 mb-1.5 text-sm font-bold text-ink-strong">
            Found a New Campaign
          </h3>
          <p className="font-body m-0 mb-4 text-sm italic text-ink-body">
            You'll be seated as its Dungeon Master.
          </p>
          <form onSubmit={submit} className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Name of the campaign"
              className="input-parchment input-compact min-w-[160px] flex-1"
            />
            <button
              type="submit"
              disabled={createCampaign.isPending || !name.trim()}
              className="btn-base btn-wax clip-octagon h-10 px-5 text-xs"
            >
              {createCampaign.isPending ? "Founding…" : "Found"}
            </button>
            {/* Only worth asking once there is somewhere else to put it. A
                realm of its own is the default and always the first option. */}
            {(realms ?? []).length > 0 && (
              <label className="flex w-full flex-col gap-1.5">
                <span className="field-label">On what ground</span>
                <select
                  value={realmId}
                  onChange={(e) => setRealmId(e.target.value)}
                  className="input-parchment input-compact"
                >
                  <option value="">A realm of its own</option>
                  {(realms ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </form>
        </section>

        <section className="parchment px-7 py-6">
          <h3 className="label-stamp m-0 mb-1.5 text-sm font-bold text-ink-strong">
            Join a Campaign
          </h3>
          <p className="font-body m-0 mb-4 text-sm italic text-ink-body">
            Ask your Dungeon Master for the invite code.
          </p>
          <form onSubmit={join} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Invite code"
              className="input-parchment input-compact font-heading flex-1 uppercase tracking-[2px]"
            />
            <button
              type="submit"
              disabled={joinCampaign.isPending || !code.trim()}
              className="btn-base btn-wax clip-octagon h-10 px-5 text-xs"
            >
              {joinCampaign.isPending ? "Joining…" : "Join"}
            </button>
          </form>
          {joinError && (
            <p className="font-body mt-2 text-sm italic text-[#8b2520]">
              {joinError}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
