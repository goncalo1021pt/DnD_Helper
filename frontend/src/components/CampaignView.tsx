import { Link, useParams } from "react-router-dom";
import { useCampaigns } from "../hooks";

// Placeholder campaign home. Phase 1 fills this with the tavern quest board;
// it is already role-aware so DM-only tools can slot in.
export default function CampaignView() {
  const { id } = useParams();
  const { data: campaigns, isLoading } = useCampaigns();

  if (isLoading) return <p className="text-parchment/60">Loading…</p>;

  const membership = campaigns?.find((m) => m.campaign.id === id);
  if (!membership) {
    return (
      <div className="text-parchment/70">
        <p>Campaign not found.</p>
        <Link to="/" className="text-gold underline">
          Back to campaigns
        </Link>
      </div>
    );
  }

  const isDM = membership.role === "dm";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-3xl text-parchment">{membership.campaign.name}</h2>
        <span className="text-xs uppercase tracking-wide rounded-full px-3 py-1 bg-wood text-parchment">
          {isDM ? "Dungeon Master" : "Player"}
        </span>
      </div>

      <div className="rounded-xl bg-parchment/90 border-2 border-wood p-8 text-center text-ink/70">
        <p className="font-display text-2xl text-wood-dark mb-2">🗺 The Quest Board</p>
        <p>Coming in Phase 1 — quests, rewards, and self-claiming.</p>
        {isDM && (
          <p className="mt-4 text-sm text-ember">
            As DM you'll post and manage quests here.
          </p>
        )}
      </div>

      <Link to="/" className="text-gold underline">
        ← Back to campaigns
      </Link>
    </div>
  );
}
