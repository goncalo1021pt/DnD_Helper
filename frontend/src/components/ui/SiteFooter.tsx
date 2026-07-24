import { useAuthConfig } from "../../hooks";
import Crest from "./Crest";

/** Site-wide credits bar: crest + name link to the repo (the front door for
 * bug reports), "Crafted by" links to the author. Rendered on the landing
 * page and under every AppShell page. */
export default function SiteFooter() {
  const { data: config } = useAuthConfig();
  return (
    <footer
      className="relative z-[5]"
      style={{
        borderTop: "1px solid rgba(201,162,39,.16)",
        background: "linear-gradient(180deg, transparent, rgba(20,12,6,.6))",
      }}
    >
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-5 px-6 py-6 sm:px-11">
        <a
          href="https://github.com/goncalo1021pt/DnD_Helper"
          target="_blank"
          rel="noopener noreferrer"
          title="Source & issues on GitHub"
          className="flex items-center gap-[11px] no-underline transition hover:brightness-125"
        >
          <Crest size={26} className="text-[#a87f3a]" />
          <span className="font-display text-[15px] font-bold text-[#bfa676]">
            Quest Board
          </span>
        </a>
        <span className="font-accent text-sm italic text-[#7d6b50]">
          {config?.version ? `v${config.version} · ` : ""}Crafted by{" "}
          <a
            href="https://github.com/goncalo1021pt"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a87f3a] no-underline transition hover:text-[#c99a3f] hover:underline"
          >
            goncalo1021pt
          </a>
        </span>
      </div>
    </footer>
  );
}
