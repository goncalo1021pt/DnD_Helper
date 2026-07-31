

/* How many to add — a tap-to-change stepper so the DM never has to type. It
   starts at 1 and can't drop below it, so a single "Add" always means one. */
export function QtyStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.min(Math.max(n, 1), 12);
  return (
    <div
      className="flex flex-none items-center rounded-[3px]"
      style={{ background: "rgba(0,0,0,.2)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.22)" }}
    >
      <button
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= 1}
        title="One fewer"
        className="flex h-8 w-6 items-center justify-center text-[16px] leading-none text-gold-muted transition hover:text-ember-bright disabled:opacity-30"
      >
        −
      </button>
      <span className="w-5 text-center font-heading text-[12.5px] font-bold tabular-nums text-cream" title="How many to add">
        {value}
      </span>
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= 12}
        title="One more"
        className="flex h-8 w-6 items-center justify-center text-[14px] leading-none text-gold-muted transition hover:text-ember-bright disabled:opacity-30"
      >
        ＋
      </button>
    </div>
  );
}
