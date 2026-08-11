/*
Bringing a prop to the table.

The image rides to the server as base64 in the body, the same way a map does,
which is why this call is allowed to be slow — see HEAVY_PATHS in lib/http.ts.
Deliberately mirrors HangMapForm rather than abstracting with it: two upload
forms that happen to share a FileReader is not a shared component, and the day
one of them grows a crop tool the abstraction would be in the way.
*/

import { useState } from "react";
import { useCreateHandout } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";

export default function HandoutForm({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose: () => void;
}) {
  const create = useCreateHandout(campaignId);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [now, setNow] = useState(false);
  const [failed, setFailed] = useState("");

  function hand() {
    if (!file) return;
    setFailed("");
    const reader = new FileReader();
    reader.onload = () => {
      create.mutate(
        {
          title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
          caption: caption.trim(),
          imageBase64: String(reader.result),
          visibleToParty: now,
        },
        {
          onSuccess: () => onClose(),
          onError: (err) =>
            setFailed(
              (err as { error?: string } | null)?.error ??
                "The handout would not reach the table.",
            ),
        },
      );
    };
    reader.onerror = () => setFailed("That file would not open.");
    reader.readAsDataURL(file);
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[440px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        The Chronicle
      </div>
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
        Hand Something Over
      </h3>
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="field-label">What it is</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="A sealed letter"
            className="input-parchment mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="field-label">The line under it</span>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
            placeholder="Sealed in red wax, unsigned…"
            className="input-parchment mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="field-label">The image (JPEG or PNG, up to 10 MB)</span>
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="font-body mt-1 w-full text-[13px] text-ink-body"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={now}
            onChange={(e) => setNow(e.target.checked)}
            className="cursor-pointer"
          />
          <span className="font-body text-[13px] text-ink-body">
            Hand it to the party now — otherwise it waits, veiled, until you do
          </span>
        </label>
        {failed && <div className="font-body text-sm italic text-[#8b2520]">{failed}</div>}
        <div className="mt-1 flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
            Cancel
          </button>
          <button
            onClick={hand}
            disabled={!file || create.isPending}
            className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {create.isPending ? "Handing it over…" : "Bring it to the table"}
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
