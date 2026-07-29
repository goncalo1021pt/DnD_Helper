/*
 * A loud, unmissable notice for anything the forge needs to say out loud.
 */

// A loud, unmissable notice for anything the forge needs to say out loud —
// skill/background collisions, picks a table's codex won't admit. The old
// warning was tiny italic text buried on the final step, so testers never
// understood it.
export function ForgeAlert({
  text,
  tone = "error",
  action,
}: {
  text: string;
  tone?: "error" | "info";
  action?: { label: string; onClick: () => void };
}) {
  const c =
    tone === "error"
      ? { bg: "rgba(139,37,32,.14)", ring: "rgba(139,37,32,.6)", mark: "#e0725f", body: "#eccbb9", link: "#f0b48f" }
      : { bg: "rgba(154,112,58,.14)", ring: "rgba(201,162,39,.5)", mark: "#d9b25a", body: "#e4d3ad", link: "#e7c169" };
  return (
    <div
      role="alert"
      className="font-body mt-3 flex items-start gap-2.5 rounded-[3px] px-3.5 py-2.5 text-[13px] leading-snug"
      style={{ background: c.bg, boxShadow: `inset 0 0 0 1px ${c.ring}`, color: c.body }}
    >
      <span aria-hidden className="font-display mt-[-1px] text-[16px] font-black leading-none" style={{ color: c.mark }}>
        {tone === "error" ? "!" : "i"}
      </span>
      <span>
        {text}
        {action && (
          <>
            {" "}
            <button
              type="button"
              onClick={action.onClick}
              className="cursor-pointer border-none bg-transparent p-0 font-semibold underline"
              style={{ color: c.link }}
            >
              {action.label}
            </button>
          </>
        )}
      </span>
    </div>
  );
}

export default ForgeAlert;
