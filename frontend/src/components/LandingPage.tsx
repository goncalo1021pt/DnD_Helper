import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthConfig, type AuthConfig } from "../hooks";
import type { CurrentUser } from "../api/client";
import Crest from "./ui/Crest";
import Embers from "./ui/Embers";
import GoldFrameButton from "./ui/GoldFrameButton";
import ParchmentModal from "./ui/ParchmentModal";
import { IconCoins, IconHome, IconScroll, IconUsers } from "./ui/icons";

/* Full-page redirect to the backend OAuth flow. */
function providerLogin(provider: string) {
  window.location.href = `/api/auth/${provider}/login`;
}

/* OAuth (+ dev door) modal, driven by what the backend actually offers. */
function LoginModal({
  config,
  onClose,
}: {
  config: AuthConfig | undefined;
  onClose: () => void;
}) {
  const [devName, setDevName] = useState("");
  const providers = config?.providers ?? [];
  const devLogin = config?.devLogin ?? false;

  function enterDev(e: FormEvent) {
    e.preventDefault();
    window.location.href = `/api/auth/dev/login?name=${encodeURIComponent(devName.trim() || "Dev User")}`;
  }

  return (
    <ParchmentModal onClose={onClose}>
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        Cross the Threshold
      </div>
      <h3 className="font-display m-0 mb-1.5 text-center text-[28px] font-black text-ink">
        Enter the Tavern
      </h3>
      <p className="font-body m-0 mb-6 text-center text-[14.5px] italic leading-relaxed text-ink-body">
        No keys, no passwords. Show the doorman a token you already carry.
      </p>

      <div className="flex flex-col gap-3">
        {providers.map((p) =>
          p === "discord" ? (
            <button
              key={p}
              onClick={() => providerLogin(p)}
              className="btn-base btn-discord w-full px-[18px] py-[15px] text-sm"
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="#f0eafc" aria-hidden="true">
                <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Sign in with Discord
            </button>
          ) : p === "google" ? (
            <button
              key={p}
              onClick={() => providerLogin(p)}
              className="btn-base btn-google w-full px-[18px] py-[15px] text-sm"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-2 3.2-4.9 3.2-7.9" />
                <path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.2-1.9-6-4.4H2.3v2.9A11 11 0 0 0 12 23" />
                <path fill="#FBBC05" d="M6 14.2a6.6 6.6 0 0 1 0-4.2V7.1H2.3a11 11 0 0 0 0 9.9z" />
                <path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.1L6 10c.8-2.5 3.2-4.4 6-4.4" />
              </svg>
              Sign in with Google
            </button>
          ) : (
            <button
              key={p}
              onClick={() => providerLogin(p)}
              className="btn-base btn-ghost-ink w-full px-[18px] py-[15px] text-sm"
            >
              Sign in with {p}
            </button>
          ),
        )}

        {config && providers.length === 0 && !devLogin && (
          <p className="font-body m-0 text-center text-[14.5px] italic text-ink-body">
            The doorman knows no tokens yet — no login methods are configured.
          </p>
        )}
      </div>

      {devLogin && (
        <>
          {providers.length > 0 && (
            <div className="my-5 flex items-center gap-3.5">
              <span className="h-px flex-1 bg-[rgba(120,80,30,.3)]" />
              <span className="font-accent text-[13px] italic text-ink-faded">
                or
              </span>
              <span className="h-px flex-1 bg-[rgba(120,80,30,.3)]" />
            </div>
          )}
          <form onSubmit={enterDev} className="mt-2 flex flex-col gap-1.5">
            <span className="field-label">The dev door — name your hero</span>
            <div className="flex gap-2">
              <input
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
                placeholder="Brave adventurer"
                className="input-parchment flex-1"
              />
              <button
                type="submit"
                className="btn-base btn-wax clip-octagon h-[46px] px-6 text-[13px]"
              >
                Enter
              </button>
            </div>
          </form>
        </>
      )}

      <div className="font-body mt-5 text-center text-[12.5px] text-ink-faded">
        By entering you agree to keep the hearth warm and the dice honest.
      </div>
    </ParchmentModal>
  );
}

const FEATURES = [
  {
    icon: <IconScroll size={26} />,
    title: "A Living Board",
    body: "Quest notices nailed up like a real tavern wall. Players read, claim, and report back.",
  },
  {
    icon: <IconCoins size={26} />,
    title: "Spoils Tracked",
    body: "Gold, loot, XP and reputation tagged to every quest. No more lost ledgers.",
  },
  {
    icon: <IconUsers size={26} />,
    title: "Share a Code",
    body: "Hand your table one invite code and the whole party walks through the door.",
  },
];

const PARTY_CRESTS = [
  { initials: "T", bg: "linear-gradient(140deg,#6b3f2a,#3a2113)" },
  { initials: "L", bg: "linear-gradient(140deg,#5a3a63,#2f1e36)" },
  { initials: "G", bg: "linear-gradient(140deg,#3f5530,#22301a)" },
  { initials: "S", bg: "linear-gradient(140deg,#2f4a55,#16282f)" },
];

export default function LandingPage({ me }: { me: CurrentUser | null }) {
  const { data: config } = useAuthConfig();
  const [loginOpen, setLoginOpen] = useState(false);
  const navigate = useNavigate();

  // Logged in: the doors are open. Logged out: knock first.
  const enter = me ? () => navigate("/questboard") : () => setLoginOpen(true);

  return (
    <div className="bg-hearth font-body relative min-h-screen overflow-hidden text-cream">
      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <Embers />

      {/* header */}
      <header className="relative z-[6] mx-auto flex max-w-[1240px] items-center justify-between px-6 py-6 sm:px-11">
        <div className="flex items-center gap-3.5">
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
        </div>
        <div className="flex items-center gap-4">
          {me && (
            <span className="label-stamp hidden text-[11px] text-gold-hair sm:inline">
              {me.user.name}
            </span>
          )}
          <GoldFrameButton onClick={enter}>
            {me ? (
              <>
                <span className="sm:hidden">Enter</span>
                <span className="hidden sm:inline">Enter the Tavern</span>
              </>
            ) : (
              "Log In"
            )}
          </GoldFrameButton>
        </div>
      </header>

      {/* hero */}
      <main className="relative z-[5] mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-16 px-6 pb-[70px] pt-12 sm:px-11 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,.92fr)]">
        {/* left: copy */}
        <div className="anim-rise">
          <div className="font-accent mb-[26px] inline-flex items-center gap-[11px] text-base italic tracking-[.16em] text-[#c89a5a]">
            <span
              className="h-px w-[34px]"
              style={{ background: "linear-gradient(90deg,transparent,#9a6a2a)" }}
            />
            A hearth for every table
            <span
              className="h-px w-[34px]"
              style={{ background: "linear-gradient(90deg,#9a6a2a,transparent)" }}
            />
          </div>
          <h1
            className="font-heading m-0 mb-[22px] text-[clamp(38px,4.6vw,58px)] font-bold leading-[1.06] text-[#f5e9cd]"
            style={{ textShadow: "0 2px 30px rgba(0,0,0,.55)" }}
          >
            Gather your party
            <br />
            by the <span className="text-[#ecc673]">firelight.</span>
          </h1>
          <p className="m-0 mb-[38px] max-w-[452px] text-[19px] leading-[1.62] text-[#cdba93]">
            Quest Board is the tavern for your table — your campaign, your
            companions and the next session, all kept warm by the hearth
            between nights of adventure.
          </p>

          <div className="flex flex-wrap items-center gap-[18px]">
            <button
              onClick={enter}
              className="btn-base btn-gold clip-octagon h-14 px-8 text-base"
            >
              <IconHome size={17} strokeWidth={1.8} />
              Enter the Tavern
            </button>
          </div>
          {!me && (
            <div className="label-stamp mt-3.5 text-[11px] tracking-[1.5px] text-[#8f7a55]">
              No password to forge — sign in with Discord or Google
            </div>
          )}

          <div className="mt-[42px] flex items-center gap-[13px]">
            <div className="flex">
              {PARTY_CRESTS.map((c) => (
                <div
                  key={c.initials}
                  className="font-heading -ml-[9px] flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#1c120a] text-xs text-[#f3e6c8] first:ml-0"
                  style={{ background: c.bg }}
                >
                  {c.initials}
                </div>
              ))}
            </div>
            <span className="text-[15px] text-[#a8967a]">
              Free for you and your whole party.
            </span>
          </div>
        </div>

        {/* right: heraldic title-emblem panel */}
        <div className="anim-rise-slow relative">
          {/* iron lantern */}
          <div className="absolute inset-x-0 top-[-6px] z-[3] flex justify-center">
            <div className="anim-sway flex flex-col items-center">
              <div className="h-[26px] w-[2px] bg-[#5a3c20]" />
              <div
                className="flex h-10 w-[34px] items-center justify-center rounded-[5px_5px_7px_7px] border-2 border-[#2a1c0e]"
                style={{
                  background:
                    "linear-gradient(180deg,rgba(60,40,20,.5),rgba(20,12,6,.6))",
                  boxShadow: "0 0 26px rgba(245,170,70,.55)",
                }}
              >
                <div
                  className="anim-flame h-[13px] w-[9px]"
                  style={{
                    borderRadius: "50% 50% 46% 46%",
                    background:
                      "radial-gradient(circle at 50% 70%,#fff3c0,#f59a30 70%,#d9701f)",
                    boxShadow: "0 0 16px rgba(245,160,60,.9)",
                  }}
                />
              </div>
            </div>
          </div>

          {/* flickering glow behind the panel */}
          <div
            className="anim-flicker pointer-events-none absolute -inset-[26px]"
            style={{
              background:
                "radial-gradient(58% 52% at 50% 32%, rgba(245,165,70,.32), transparent 70%)",
            }}
          />

          {/* ornate wood frame */}
          <div
            className="relative p-[13px]"
            style={{
              background: "linear-gradient(135deg,#5a3c20,#2c1c0e)",
              boxShadow:
                "0 30px 70px rgba(0,0,0,.6), inset 0 0 0 2px rgba(201,162,39,.4)",
            }}
          >
            <div className="absolute left-1.5 top-1.5 h-[26px] w-[26px] border-l-[3px] border-t-[3px] border-[#c9a227]" />
            <div className="absolute right-1.5 top-1.5 h-[26px] w-[26px] border-r-[3px] border-t-[3px] border-[#c9a227]" />
            <div className="absolute bottom-1.5 left-1.5 h-[26px] w-[26px] border-b-[3px] border-l-[3px] border-[#c9a227]" />
            <div className="absolute bottom-1.5 right-1.5 h-[26px] w-[26px] border-b-[3px] border-r-[3px] border-[#c9a227]" />

            {/* oxblood field with the sigil */}
            <div
              className="relative flex aspect-[4/5] flex-col items-center justify-center overflow-hidden pb-[64px]"
              style={{
                background:
                  "radial-gradient(80% 70% at 50% 36%, #6a2018, #3a120d 60%, #240a07 100%)",
                boxShadow: "inset 0 0 90px rgba(0,0,0,.6)",
              }}
            >
              <div
                className="absolute inset-0 opacity-[.16]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, rgba(0,0,0,.5) 0 1px, transparent 1px 46px)",
                }}
              />
              <div className="anim-sealglow relative aspect-square w-[clamp(140px,55%,252px)] text-[#e7bd6a]">
                <Crest size="100%" />
              </div>
              <div className="font-display relative mt-[18px] text-[clamp(23px,8vw,34px)] font-black tracking-[.04em] text-[#f1dca6]">
                Quest Board
              </div>
              <div className="font-accent relative mt-1.5 text-base italic tracking-[.2em] text-[#d09a58]">
                GATHER · QUEST · RETURN
              </div>
              {/* caption plate */}
              <div className="chip-hall absolute inset-x-[18px] bottom-[18px] flex-wrap justify-between gap-x-3 gap-y-0.5 px-4 py-[11px]">
                <div className="flex items-center gap-[9px]">
                  <span
                    className="h-2 w-2 rounded-full bg-[#8fb15f]"
                    style={{ boxShadow: "0 0 8px #8fb15f" }}
                  />
                  <span className="font-heading text-[13px] tracking-[.04em] text-[#e6d5af]">
                    The hearth is lit
                  </span>
                </div>
                <span className="font-accent text-sm italic text-[#bfa676]">
                  {me ? `Welcome back, ${me.user.name}` : "Your table awaits"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* heraldic divider */}
      <div className="relative z-[5] mx-auto flex max-w-[1240px] items-center gap-[22px] px-6 sm:px-11">
        <span
          className="h-px flex-1"
          style={{
            background:
              "linear-gradient(90deg,transparent,rgba(201,162,39,.45))",
          }}
        />
        <Crest size={30} className="text-[#a87f3a]" />
        <span
          className="h-px flex-1"
          style={{
            background:
              "linear-gradient(90deg,rgba(201,162,39,.45),transparent)",
          }}
        />
      </div>

      {/* what waits within */}
      <section className="relative z-[5] mx-auto max-w-[1240px] px-6 pb-[70px] pt-12 sm:px-11">
        <div className="mb-10 text-center">
          <div className="font-accent mb-2 text-base italic tracking-[.18em] text-[#c89a5a]">
            By the hearth you'll find
          </div>
          <h2 className="font-heading m-0 text-3xl font-semibold text-[#f3e6c8]">
            All your table needs, under one roof
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-[22px] md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="panel-hall relative overflow-hidden px-7 py-[30px]"
            >
              <div
                className="mb-[18px] flex h-12 w-12 items-center justify-center text-[#e7bd6a]"
                style={{ boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)" }}
              >
                {f.icon}
              </div>
              <h3 className="font-heading m-0 mb-[9px] text-[19px] font-semibold text-[#f0e3c5]">
                {f.title}
              </h3>
              <p className="m-0 text-base leading-[1.55] text-[#a8967a]">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* footer */}
      <footer
        className="relative z-[5]"
        style={{
          borderTop: "1px solid rgba(201,162,39,.16)",
          background: "linear-gradient(180deg, transparent, rgba(20,12,6,.6))",
        }}
      >
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-5 px-6 py-6 sm:px-11">
          <div className="flex items-center gap-[11px]">
            <Crest size={26} className="text-[#a87f3a]" />
            <span className="font-display text-[15px] font-bold text-[#bfa676]">
              Quest Board
            </span>
          </div>
          <span className="font-accent text-sm italic text-[#7d6b50]">
            Gather your party. © 2026, kept by your table.
          </span>
        </div>
      </footer>

      {loginOpen && !me && (
        <LoginModal config={config} onClose={() => setLoginOpen(false)} />
      )}
    </div>
  );
}
