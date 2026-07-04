import { useRef, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import type { Campaign, Role } from "../api/client";
import { useCampaigns, useRegenerateInvite } from "../hooks";
import RoleBadge from "./ui/RoleBadge";
import { IconCopy, IconRefresh } from "./ui/icons";

/** Context handed to the campaign tabs (quest board, party roster). */
export interface CampaignContext {
  campaign: Campaign;
  role: Role;
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

function Tab({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `label-stamp -mb-px border-b-2 px-1 pb-2.5 text-xs font-semibold no-underline transition ${
          isActive
            ? "border-[#e0a94e] text-ember-bright"
            : "border-transparent text-gold-muted hover:text-gold-hair"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export default function CampaignView() {
  const { id } = useParams();
  const { data: campaigns, isLoading } = useCampaigns();
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

  return (
    <div>
      <Link
        to="/questboard"
        className="label-stamp text-[11px] text-gold-muted no-underline transition hover:text-ember-bright"
      >
        ← All campaigns
      </Link>

      {/* campaign toolbar */}
      <div className="mb-5 mt-3 flex flex-wrap items-center justify-between gap-5">
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

      {/* tabs */}
      <div
        className="mb-[26px] flex gap-7"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <Tab to="." end>
          The Board
        </Tab>
        <Tab to="party">The Party</Tab>
      </div>

      <Outlet context={context} />
    </div>
  );
}
