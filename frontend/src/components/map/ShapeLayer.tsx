import type { MapShape, MapPoint } from "../../api/client";

/*
Roads and regions, drawn over the map (#262).

One SVG sheet stretched across the image, in the image's own coordinates, so a
shape's normalised points map straight onto it and the whole thing scales with
the zoom for free — no counter-scaling, no redraw on pan.

Strokes are the one thing that must NOT scale with the zoom the way the sheet
does, or a road becomes a hairline when you pull back and a river when you push
in. `vectorEffect="non-scaling-stroke"` would freeze it in screen pixels, which
is the opposite mistake — a road should be a road on the map. So the width is
stored as a fraction of the image and multiplied up here: it stays true to the
ground, which is what a map means.

A shape is grabbed by its EDGE and never by its fill (#277). The sheet and the
marks are transparent to the pointer; one generous invisible stroke along the
run is the only thing that answers, plus the name where there is one. A region
covering half the map would otherwise be half a map you cannot drag — and the
tap that lands inside it still drops a pin or stamps fog, as open ground should.
Which is also why `data-shape-id` sits on the group: the viewer reads it to know
this press belongs to the shape rather than to the pan (see useMapViewer).
*/

/** A shape's points as an SVG path, closed when it encloses something. */
export function shapePath(points: MapPoint[], close: boolean, w: number, h: number): string {
  if (points.length === 0) return "";
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * w} ${p.y * h}`).join(" ");
  return close ? `${d} Z` : d;
}

/** Where a region's name sits: the centroid of its corners, near enough. */
function centroid(points: MapPoint[], w: number, h: number) {
  const sx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const sy = points.reduce((a, p) => a + p.y, 0) / points.length;
  return { x: sx * w, y: sy * h };
}

function ShapeMark({
  shape,
  runKey,
  width,
  height,
  onOpen,
}: {
  shape: MapShape;
  /** Which run of a clipped road this is — its id alone is not unique. */
  runKey: number;
  width: number;
  height: number;
  onOpen?: (shape: MapShape) => void;
}) {
  const area = shape.kind === "area";
  const stroke = Math.max(shape.width * width, 1);
  // A dash that does not scale with the stroke stops reading as a dash at
  // either end of the zoom, so it is measured in strokes rather than pixels.
  const dash = shape.dashed ? `${stroke * 2.5} ${stroke * 2}` : undefined;
  const d = shapePath(shape.points, area, width, height);
  const label = shape.label || shape.locationName;

  return (
    <g
      data-shape-id={shape.id}
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(shape); } : undefined}
      // Nothing here answers by default; the hit stroke and the name opt in.
      style={{ pointerEvents: "none" }}
      opacity={shape.dmOnly ? 0.72 : 1}
    >
      {/* A generous invisible stroke ALONG the run — the whole of a road, the
          border of a region — so it can be grabbed without demanding pixel
          accuracy at low zoom, and so the inside of a region stays ground. */}
      {onOpen && (
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(stroke * 3, 14)}
          style={{ pointerEvents: "stroke", cursor: "pointer" }}
        />
      )}
      <path
        d={d}
        fill={area ? shape.color : "none"}
        fillOpacity={area ? shape.opacity : undefined}
        stroke={shape.color}
        strokeWidth={stroke}
        strokeDasharray={dash}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={area ? 0.85 : 1}
        style={{ filter: area ? undefined : "drop-shadow(0 1px 2px rgba(0,0,0,.55))" }}
      />
      {label &&
        (area ? (
          <text
            x={centroid(shape.points, width, height).x}
            y={centroid(shape.points, width, height).y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={Math.max(width * 0.016, 10)}
            fill="#f3e6c8"
            fillOpacity={0.92}
            stroke="rgba(16,9,5,.75)"
            strokeWidth={Math.max(width * 0.0035, 2)}
            paintOrder="stroke"
            style={{
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 600,
              ...(onOpen ? { pointerEvents: "auto" as const, cursor: "pointer" } : {}),
            }}
          >
            {label}
          </text>
        ) : (
          // A road's name follows the road. It was stored and never drawn
          // before, which made naming one pointless — and a straight caption
          // beside a winding track reads as a different thing entirely.
          <>
            <defs>
              <path id={`shape-path-${shape.id}-${runKey}`} d={d} />
            </defs>
            <text
              dy={-stroke * 1.1}
              fontSize={Math.max(width * 0.013, 9)}
              fill="#f3e6c8"
              stroke="rgba(16,9,5,.8)"
              strokeWidth={Math.max(width * 0.003, 1.6)}
              paintOrder="stroke"
              style={{
                letterSpacing: "0.1em",
                fontWeight: 600,
                ...(onOpen ? { pointerEvents: "auto" as const, cursor: "pointer" } : {}),
              }}
            >
              <textPath href={`#shape-path-${shape.id}-${runKey}`} startOffset="50%" textAnchor="middle">
                {label}
              </textPath>
            </text>
          </>
        ))}
    </g>
  );
}

export function ShapeLayer({
  shapes,
  draft,
  drawingArea,
  width,
  height,
  onOpen,
}: {
  shapes: MapShape[];
  /** The run being drawn right now, if any — same coordinates, no row yet. */
  draft?: MapPoint[];
  drawingArea?: boolean;
  width: number;
  height: number;
  onOpen?: (shape: MapShape) => void;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="absolute left-0 top-0"
      // Regions fill large parts of the map, so the sheet itself must never
      // swallow a pan or a tap meant for the ground: only the marks answer.
      style={{ pointerEvents: "none" }}
    >
      {shapes.map((s, i) => (
        // A clipped road comes back as several runs sharing one id, so the key
        // has to say which run this is (#262).
        <ShapeMark
          key={`${s.id}-${i}`}
          shape={s}
          runKey={i}
          width={width}
          height={height}
          onOpen={onOpen}
        />
      ))}
      {draft && draft.length > 0 && (
        <>
          <path
            d={shapePath(draft, !!drawingArea, width, height)}
            fill={drawingArea ? "#e0a94e" : "none"}
            fillOpacity={drawingArea ? 0.18 : undefined}
            stroke="#e0a94e"
            strokeWidth={Math.max(width * 0.004, 2)}
            strokeDasharray={`${width * 0.01} ${width * 0.008}`}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {draft.map((p, i) => (
            <circle
              key={i}
              cx={p.x * width}
              cy={p.y * height}
              r={Math.max(width * 0.004, 3)}
              fill="#e0a94e"
              stroke="rgba(16,9,5,.7)"
              strokeWidth={Math.max(width * 0.0012, 1)}
            />
          ))}
        </>
      )}
    </svg>
  );
}
