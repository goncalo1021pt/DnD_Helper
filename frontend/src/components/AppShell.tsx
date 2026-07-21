import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import type { CurrentUser } from "../api/client";
import { initials, medallionFor } from "../lib/party";
import Crest from "./ui/Crest";

/** A gentle, dismissible nudge for local accounts that haven't confirmed
 * their email yet. Offers to resend the link; recovery needs a verified
 * address, so we surface it — but never block. */
function VerifyBanner() {
  const [state, setState] = useState<"show" | "sent" | "hidden">("show");
  if (state === "hidden") return null;
  return (
    <div
      className="relative z-[6] mx-auto mt-1 flex max-w-[1240px] flex-wrap items-center justify-center gap-2 px-5 py-2.5 text-center sm:px-11"
      style={{ background: "rgba(201,162,39,.12)", boxShadow: "inset 0 -1px 0 rgba(201,162,39,.25)" }}
    >
      <span className="font-body text-[13px] text-cream-soft">
        {state === "sent"
          ? "Sent — check your inbox for the confirmation link."
          : "Confirm your email to enable password recovery."}
      </span>
      {state === "show" && (
        <button
          onClick={() => {
            fetch("/api/auth/resend-verification", { method: "POST" }).finally(() => setState("sent"));
          }}
          className="label-stamp cursor-pointer border-none bg-transparent text-[11px] font-semibold tracking-[1px] text-ember-bright hover:text-cream"
        >
          Resend link
        </button>
      )}
      <button
        onClick={() => setState("hidden")}
        title="Dismiss"
        className="label-stamp cursor-pointer border-none bg-transparent text-[11px] tracking-[1px] text-gold-muted hover:text-cream"
      >
        Dismiss
      </button>
    </div>
  );
}

export default function AppShell({ user }: { user: CurrentUser["user"] }) {
  return (
    <div className="bg-hearth font-body relative min-h-screen overflow-x-hidden text-cream">
      <div className="overlay-vignette fixed" />
      <div className="overlay-grain fixed" />

      <header className="relative z-[6] mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-5 px-5 py-6 sm:px-11">
        <Link to="/" className="flex items-center gap-3.5 no-underline">
          <Crest
            size={46}
            className="text-[#e0a94e] drop-shadow-[0_2px_6px_rgba(0,0,0,.5)]"
          />
          <div className="leading-none">
            <div className="font-display text-[23px] font-black tracking-[.06em] text-[#f3e6c8]">
              Quest Board
            </div>
            <div className="font-accent mt-[3px] text-xs italic tracking-[.22em] text-[#a98a5a]">
              EST. BY THE TABLE
            </div>
          </div>
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            to="/questboard"
            className="label-stamp text-[11px] font-semibold text-gold-muted no-underline transition hover:text-ember-bright"
          >
            Campaigns
          </Link>
          <Link
            to="/questboard/archives"
            className="label-stamp text-[11px] font-semibold text-gold-muted no-underline transition hover:text-ember-bright"
          >
            The Archives
          </Link>
          <Link
            to="/questboard/profile"
            title="Your profile"
            className="no-underline transition hover:brightness-125"
          >
            {user.image ? (
              <img
                src={user.image}
                alt="Your profile"
                className="h-[34px] w-[34px] rounded-full object-cover"
                style={{ boxShadow: "inset 0 0 0 1.5px rgba(201,162,39,.55), 0 2px 5px rgba(0,0,0,.4)" }}
              />
            ) : (
              <span
                className="font-heading flex h-[34px] w-[34px] items-center justify-center rounded-full text-[12px] font-bold text-[#f3e6c8]"
                style={{
                  background: medallionFor(user.id),
                  boxShadow: "inset 0 0 0 1.5px rgba(201,162,39,.55), 0 2px 5px rgba(0,0,0,.4)",
                }}
              >
                {initials(user.name) || "?"}
              </span>
            )}
          </Link>
        </div>
      </header>

      {user.provider === "local" && !user.emailVerified && <VerifyBanner />}

      <main className="relative z-[5] mx-auto max-w-[1240px] px-3 pb-20 sm:px-11 pt-4">
        <Outlet />
      </main>
    </div>
  );
}
