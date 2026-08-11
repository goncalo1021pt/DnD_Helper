import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import type { Campaign, Role } from "../api/client";
import { useCampaigns, useLiveCampaign } from "../hooks";
import InviteModal from "./InviteModal";
import RoleBadge from "./ui/RoleBadge";
import { IconKey } from "./ui/icons";

/** Context handed to the campaign pages (dashboard, board, party). */
export interface CampaignContext {
  campaign: Campaign;
  role: Role;
}

/*
 * #178: the section rail — every room reachable from every room, so a
 * mid-session hop (Encounters ↔ Party ↔ Bazaar) stops costing a round-trip
 * through the hall. One strip, shared words for DM and players.
 */
function SectionRail({ role }: { role: Role }) {
  const sections: { to: string; label: string; end?: boolean }[] = [
    { to: ".", label: "The Hall", end: true },
    { to: "board", label: "Board" },
    { to: "party", label: "Party" },
    { to: "trees", label: "Trees" },
    { to: "encounters", label: "Encounters" },
    { to: "map", label: "Map" },
    { to: "world", label: "World" },
    { to: "vendors", label: "Bazaar" },
    { to: "bestiary", label: "Bestiary" },
    { to: "codex", label: "Codex" },
    { to: "chronicle", label: "Chronicle" },
    ...(role === "dm"
      ? [
          { to: "den", label: "The Den" },
          { to: "dm", label: "DM Menu" },
        ]
      : [{ to: "player", label: "Player Menu" }]),
  ];

  return (
    <nav
      className="mb-[26px] flex items-center gap-x-1 overflow-x-auto whitespace-nowrap py-1"
      style={{
        borderTop: "1px solid rgba(201,162,39,.18)",
        borderBottom: "1px solid rgba(201,162,39,.18)",
      }}
    >
      {sections.map((s) => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.end}
          className={({ isActive }) =>
            `label-stamp px-2.5 py-1.5 text-[10px] tracking-[1.5px] no-underline transition ${
              isActive
                ? "text-ember-bright"
                : "text-gold-muted hover:text-cream"
            }`
          }
          style={({ isActive }) =>
            isActive ? { boxShadow: "inset 0 -2px 0 rgba(201,162,39,.55)" } : undefined
          }
        >
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}

/* The door to the invite (#207) — a button, never the code itself. What sits
   behind it, including forging a new one, lives in InviteModal. */
function InviteButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="The invite code"
      className="chip-hall cursor-pointer border-none px-3.5 py-[9px] transition hover:brightness-125"
    >
      <span className="text-gold-hair">
        <IconKey strokeWidth={1.8} />
      </span>
      <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">
        Invite
      </span>
    </button>
  );
}

/**
 * Campaign layout: header (name, role, invite) over the current page —
 * the dashboard hub at the index route, or a solo page (board, party).
 */
export default function CampaignView() {
  const { id } = useParams();
  const location = useLocation();
  const { data: campaigns, isLoading } = useCampaigns();
  // One stream per campaign, opened here because every tab lives under this
  // route — the tracker, the chronicle, the board (#109). The 8-second poll
  // underneath stays as the fallback.
  useLiveCampaign(id);
  const [inviting, setInviting] = useState(false);

  if (isLoading) {
    return (
      <p className="font-accent text-base italic text-[#9c855e]">
        Finding your table…
      </p>
    );
  }

  const membership = campaigns?.find((m) => m.campaign.id === id);
  if (!membership) {
    return (
      <div className="text-cream-soft">
        <p>This table is not yours to sit at — or it never was.</p>
        <Link
          to="/questboard"
          className="label-stamp text-xs text-ember-bright underline"
        >
          ← Back to your campaigns
        </Link>
      </div>
    );
  }

  const { campaign, role } = membership;
  const context: CampaignContext = { campaign, role };

  // On the hub, back means the campaign list; on a solo page, back means the hub.
  const onDashboard = location.pathname.replace(/\/$/, "").endsWith(campaign.id);

  return (
    <div>
      <Link
        to={onDashboard ? "/questboard" : "."}
        className="label-stamp text-[11px] text-gold-muted no-underline transition hover:text-ember-bright"
      >
        {onDashboard ? "← All campaigns" : "← The campaign hall"}
      </Link>

      {/* campaign toolbar */}
      <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 flex-wrap items-center gap-[18px]">
          <div className="min-w-0">
            <div className="font-accent text-sm italic tracking-[.16em] text-[#c89a5a]">
              Campaign
            </div>
            <div className="font-display truncate text-[clamp(17px,2.2vw,24px)] font-bold leading-[1.15] text-cream">
              {campaign.name}
            </div>
          </div>
          <RoleBadge role={role} />
        </div>

        {role === "dm" && (
          <div className="flex flex-wrap items-center gap-3.5">
            <InviteButton onOpen={() => setInviting(true)} />
          </div>
        )}
      </div>

      {inviting && <InviteModal campaign={campaign} onClose={() => setInviting(false)} />}

      <SectionRail role={role} />

      <Outlet context={context} />
    </div>
  );
}
