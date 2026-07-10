import { useState } from "react";
import { Link } from "react-router-dom";
import { useCampaigns, useCreateCampaign, useJoinCampaign } from "../hooks";
import RoleBadge from "./ui/RoleBadge";

export default function CampaignsPage() {
  const { data: campaigns, isLoading } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const joinCampaign = useJoinCampaign();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createCampaign.mutate(trimmed, { onSuccess: () => setName("") });
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setJoinError("");
    joinCampaign.mutate(trimmed, {
      onSuccess: () => setCode(""),
      onError: () => setJoinError("No table answers to that code."),
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
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-x-[26px] gap-y-[30px] p-0">
            {campaigns.map((m, i) => (
              <li
                key={m.campaign.id}
                className="relative"
                style={{ transform: `rotate(${((i % 3) - 1) * 0.8}deg)` }}
              >
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
            ))}
          </ul>
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
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Name of the campaign"
              className="input-parchment input-compact flex-1"
            />
            <button
              type="submit"
              disabled={createCampaign.isPending || !name.trim()}
              className="btn-base btn-wax clip-octagon h-10 px-5 text-xs"
            >
              {createCampaign.isPending ? "Founding…" : "Found"}
            </button>
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
