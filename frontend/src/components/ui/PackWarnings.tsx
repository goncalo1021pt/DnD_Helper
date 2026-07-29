import type { ImportReport } from "../../api/client";

/**
 * Non-fatal notes from a pack import. Chiefly: an entry whose name shadows an
 * SRD one, which imports fine but leaves the library listing both. Packs are
 * additive — extending an existing class means shipping a subclass, feat or
 * spell that names it, not a second copy of the class.
 */
export default function PackWarnings({ report }: { report: ImportReport }) {
  const warnings = report.warnings ?? [];
  if (warnings.length === 0) return null;
  return (
    <div
      className="mb-4 flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-[3px] px-3 py-2.5 pr-1"
      style={{ background: "rgba(180,120,20,.12)", boxShadow: "inset 0 0 0 1px rgba(150,100,20,.4)" }}
    >
      <div className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">
        {warnings.length === 1 ? "One thing to know" : `${warnings.length} things to know`}
      </div>
      {warnings.map((w, i) => (
        <div key={i} className="text-[12.5px] leading-relaxed text-ink-body">
          {w}
        </div>
      ))}
    </div>
  );
}
