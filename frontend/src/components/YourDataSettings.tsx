import { useDownloadMyData } from "../hooks";

/*
 * Your data (#317): everything you own, as one document, downloaded from the
 * profile. The same veils as the screen; images as links; not an import.
 */
export default function YourDataSettings() {
  const download = useDownloadMyData();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-body text-[13px] text-[#c9b183]">
        Everything you own as one file — your heroes as their sheets read, every table as it reads to you, your homebrew,
        your account. Images are links; nothing here imports back.
      </span>
      <button
        onClick={() => download.mutate()}
        disabled={download.isPending}
        className="btn-base btn-gold clip-octagon ml-auto h-9 px-4 text-[12px] disabled:opacity-50"
      >
        {download.isPending ? "Preparing…" : "Download my data"}
      </button>
    </div>
  );
}
