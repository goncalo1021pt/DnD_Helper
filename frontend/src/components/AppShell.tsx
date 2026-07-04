import { Link, Outlet } from "react-router-dom";
import type { CurrentUser } from "../api/client";
import { useLogout } from "../hooks";
import Crest from "./ui/Crest";
import DiceTray from "./ui/DiceTray";
import GoldFrameButton from "./ui/GoldFrameButton";
import { IconLogOut } from "./ui/icons";

export default function AppShell({ user }: { user: CurrentUser["user"] }) {
  const logout = useLogout();

  return (
    <div className="bg-hearth font-body relative min-h-screen overflow-x-hidden text-cream">
      <div className="overlay-vignette fixed" />
      <div className="overlay-grain fixed" />

      <header className="relative z-[6] mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-5 px-11 py-6">
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
        <div className="flex items-center gap-4">
          <span className="label-stamp text-[11px] font-semibold text-gold-hair">
            {user.name}
          </span>
          <GoldFrameButton onClick={() => logout.mutate()}>
            <IconLogOut size={14} strokeWidth={1.9} />
            Sign out
          </GoldFrameButton>
        </div>
      </header>

      <main className="relative z-[5] mx-auto max-w-[1240px] px-11 pb-20 pt-4">
        <Outlet />
      </main>

      <DiceTray />
    </div>
  );
}
