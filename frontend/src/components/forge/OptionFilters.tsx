/**
 * The sieve above every option grid: free-text search, the source the entry
 * came from (SRD, an imported book, plain homebrew), and the table whose codex
 * the hero must satisfy. The table choice is deliberately not cleared by
 * "Clear filters" — it is a decision about the hero, not a way to squint at
 * the list.
 */
export function OptionFilters({
  noun,
  search,
  onSearch,
  source,
  onSource,
  sources,
  tableId,
  onTable,
  tables,
  shown,
  total,
}: {
  noun: string;
  search: string;
  onSearch: (v: string) => void;
  source: string;
  onSource: (v: string) => void;
  sources: string[];
  tableId: string;
  onTable: (v: string) => void;
  tables: Array<{ id: string; name: string }>;
  shown: number;
  total: number;
}) {
  const sifting = search !== "" || source !== "";
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={`Search ${noun}…`}
          className="input-hall min-w-0 flex-1 basis-[200px] sm:max-w-[260px]"
        />
        {sources.length > 1 && (
          <select
            value={source}
            onChange={(e) => onSource(e.target.value)}
            className="input-hall w-[180px]"
            title="Where the option came from"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {tables.length > 0 && (
          <select
            value={tableId}
            onChange={(e) => onTable(e.target.value)}
            className="input-hall w-[200px]"
            title="Show only what a table's codex admits"
          >
            <option value="">Legal anywhere</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>Legal at {t.name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="label-stamp mt-2 text-[10px] tracking-[1.5px] text-gold-muted">
        {shown} of {total} {noun}
        {sifting && (
          <button
            onClick={() => {
              onSearch("");
              onSource("");
            }}
            className="ml-2 cursor-pointer border-none bg-transparent p-0 text-[10px] tracking-[1.5px] text-ember-bright underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

export default OptionFilters;
