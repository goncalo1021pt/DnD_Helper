import type { MapLayer } from "../../api/client";

/*
Which layer a pin or a shape is filed in (#355), for the two forms that make
them. Absent until the map has a layer to offer: a map with none has only the
base, and a picker with one choice is a question nobody needs asking. Listed
top to bottom, the way the Legend and the Inkwork read.
*/
export function LayerPicker({
  layers,
  value,
  onChange,
}: {
  layers: MapLayer[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (layers.length === 0) return null;
  return (
    <label className="block">
      <span className="field-label">Layer</span>
      <select
        name="layer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-parchment mt-1 w-full cursor-pointer"
      >
        <option value="">The base map — always drawn</option>
        {[...layers].reverse().map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.dmOnly ? " (DM only)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
