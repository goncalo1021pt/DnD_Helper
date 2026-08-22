import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import type { CurrentUser } from "../api/client";
import { apiFetch } from "../lib/http";
import { initials, medallionFor } from "../lib/party";
import { useLiveAccount } from "../hooks";
import Crest from "./ui/Crest";
import SiteFooter from "./ui/SiteFooter";

/** A gentle, dismissible nudge for local accounts that haven't confirmed
 * their email yet. Offers to resend the link; recovery needs a verified
 * address, so we surface it — but never block. */
function VerifyBanner() {
  const [state, setState] = useState<"show" | "sent" | "hidden">("show");
  if (state === "hidden") return null;
  return (
    <div
      className="relative z-[6] mx-auto mt-1 flex w-full max-w-[1240px] flex-wrap items-center justify-center gap-2 px-5 py-2.5 text-center sm:px-11"
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
            apiFetch("/api/auth/resend-verification", { method: "POST" }).finally(() => setState("sent"));
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
  // What is waiting on this account: requests to answer, and words unread.
  // The account's own stream, mounted once for the whole signed-in app: a
  // request or a message arrives wherever the person happens to be looking,
  // and makes /me stale so the badge below follows it.
  useLiveAccount(!!user);
  // Carried by /me, which the shell already has. Two queries of its own here
  // would ride along on every page in the app for the sake of one number.
  const waiting = (user.waiting?.requests ?? 0) + (user.waiting?.unread ?? 0);
  return (
    <div className="bg-hearth font-body relative flex min-h-screen flex-col overflow-x-hidden text-cream">
      <div className="overlay-vignette fixed" />
      <div className="overlay-grain fixed" />

      {/* w-full is load-bearing: as a flex item, mx-auto would otherwise
          shrink this to its content width instead of spanning the container. */}
      <header className="relative z-[6] mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-5 px-5 py-6 sm:px-11">
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
          {/* Companions sits beside the campaigns rather than inside one:
              a friendship belongs to the account and outlives every table
              it sits at (#181). The count is what is waiting on YOU —
              requests to answer and words unread. */}
          <Link
            to="/questboard/companions"
            className="label-stamp relative text-[11px] font-semibold text-gold-muted no-underline transition hover:text-ember-bright"
          >
            Companions
            {waiting > 0 && (
              <span
                className="absolute -right-3.5 -top-2 rounded-full px-1.5 text-[9px] font-bold text-[#f0dfb8]"
                style={{ background: "rgba(139,37,32,.9)" }}
              >
                {waiting}
              </span>
            )}
          </Link>
          <Link
            to="/questboard/archives"
            className="label-stamp text-[11px] font-semibold text-gold-muted no-underline transition hover:text-ember-bright"
          >
            The Archives
          </Link>
          <Link
            to="/questboard/rules"
            className="label-stamp text-[11px] font-semibold text-gold-muted no-underline transition hover:text-ember-bright"
          >
            The Rules
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

      <main className="relative z-[5] mx-auto w-full max-w-[1240px] flex-1 px-3 pb-20 sm:px-11 pt-4">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}
