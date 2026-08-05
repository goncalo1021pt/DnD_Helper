import { useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import type { Campaign, Role } from "../api/client";
import { useCampaigns, useLiveCampaign, useRegenerateInvite } from "../hooks";
import RoleBadge from "./ui/RoleBadge";
import { IconCopy, IconRefresh } from "./ui/icons";

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
    { to: "places", label: "Places" },
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

/* Invite-code plate: click to copy, with a transient confirmation. */
function InviteChip({ campaign }: { campaign: Campaign }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function copy() {
    navigator.clipboard?.writeText(campaign.inviteCode).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      onClick={copy}
      title="Copy invite code"
      className="chip-hall cursor-pointer border-none px-3.5 py-[9px] transition hover:brightness-125"
    >
      <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">
        Invite
      </span>
      <span className="font-heading text-sm font-bold tracking-[2px] text-ember-bright">
        {campaign.inviteCode}
      </span>
      <span className="text-gold-hair">
        <IconCopy strokeWidth={1.8} />
      </span>
      {copied && (
        <span className="label-stamp text-[10px] tracking-[1px] text-[#8fb15f]">
          Copied
        </span>
      )}
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
  const regenerate = useRegenerateInvite(id ?? "");

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
            <InviteChip campaign={campaign} />
            <button
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              title="Forge a new invite code (the old one stops working)"
              className="chip-hall cursor-pointer border-none p-[9px] text-gold-hair transition hover:brightness-125 disabled:opacity-55"
            >
              <IconRefresh strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      <SectionRail role={role} />

      <Outlet context={context} />
    </div>
  );
}
