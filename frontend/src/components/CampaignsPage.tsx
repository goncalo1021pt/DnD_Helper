import { useState } from "react";
import { Link } from "react-router-dom";
import { useCampaigns, useCreateCampaign } from "../hooks";

export default function CampaignsPage() {
  const { data: campaigns, isLoading } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const [name, setName] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createCampaign.mutate(trimmed, { onSuccess: () => setName("") });
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display text-3xl text-parchment mb-4">Your Campaigns</h2>
        {isLoading ? (
          <p className="text-parchment/60">Loading…</p>
        ) : campaigns && campaigns.length > 0 ? (
          <ul className="grid sm:grid-cols-2 gap-4">
            {campaigns.map((m) => (
              <li key={m.campaign.id}>
                <Link
                  to={`/campaigns/${m.campaign.id}`}
                  className="block rounded-xl bg-parchment border-2 border-wood p-5 shadow-lg hover:-translate-y-0.5 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xl text-wood-dark">
                      {m.campaign.name}
                    </span>
                    <span className="text-xs uppercase tracking-wide rounded-full px-2 py-1 bg-wood text-parchment">
                      {m.role === "dm" ? "Dungeon Master" : "Player"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-parchment/60">No campaigns yet. Create your first below.</p>
        )}
      </section>

      <section className="rounded-xl bg-wood/60 border border-gold/30 p-5">
        <h3 className="font-display text-xl text-parchment mb-3">New Campaign</h3>
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Campaign name"
            className="flex-1 rounded-lg border border-ink/20 px-3 py-2 bg-parchment"
          />
          <button
            type="submit"
            disabled={createCampaign.isPending}
            className="rounded-lg bg-ember text-white px-5 py-2 font-semibold hover:opacity-90 disabled:opacity-50 transition"
          >
            {createCampaign.isPending ? "Creating…" : "Create"}
          </button>
        </form>
        <p className="text-xs text-parchment/50 mt-2">
          You'll become the Dungeon Master of campaigns you create.
        </p>
      </section>
    </div>
  );
}
