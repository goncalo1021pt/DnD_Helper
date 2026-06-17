import { Link, useParams } from "react-router-dom";
import { useCampaigns } from "../hooks";
import QuestBoard from "./QuestBoard";

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

      <QuestBoard campaign={membership.campaign} role={membership.role} />

      <Link to="/" className="text-gold underline">
        ← Back to campaigns
      </Link>
    </div>
  );
}
