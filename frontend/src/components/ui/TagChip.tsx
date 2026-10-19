/*
A friend tag as it is read (#387): the name, then the four digits a shade
quieter, because the name is the part people know and the digits only tell two
of them apart.
*/

/** A tag as it is read: the name, then the digits a shade quieter. */
export function TagChip({ tag, tone = "ink" }: { tag?: string; tone?: "ink" | "hall" }) {
  const at = tag?.lastIndexOf("#") ?? -1;
  const name = tag && at >= 0 ? tag.slice(0, at) : (tag ?? "");
  const digits = tag && at >= 0 ? tag.slice(at) : "";
  const ink = tone === "ink";
  return (
    <code
      data-testid="friend-tag"
      className={`font-body rounded-[3px] px-3 py-2 text-[17px] font-semibold ${ink ? "text-ink-strong" : "text-cream"}`}
      style={{
        background: ink ? "rgba(60,35,15,.09)" : "rgba(255,255,255,.05)",
        boxShadow: ink ? "inset 0 0 0 1px rgba(60,35,15,.25)" : "inset 0 0 0 1px rgba(201,162,39,.3)",
      }}
    >
      {tag ? (
        <>
          {name}
          <span className={ink ? "text-ink-label" : "text-gold-muted"}>{digits}</span>
        </>
      ) : (
        "········"
      )}
    </code>
  );
}
