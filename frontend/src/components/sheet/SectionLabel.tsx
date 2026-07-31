

/** A species' pick list, so a chosen lineage can be shown as what it grants. */
export interface SpeciesChoice {
  id?: string;
  options?: Array<{ name?: string; summary?: string }>;
}

export default function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="label-stamp mb-2.5 text-[10px] tracking-[2.5px] text-gold-muted">
      {children}
    </div>
  );
}
