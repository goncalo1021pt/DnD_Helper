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

/**
 * Where a road's name goes: along its longest straight leg (#312).
 *
 * A name used to ride the road as text on a path, and text on a path reads the
 * path's own way and bends at every vertex — a road laid east to west carried
 * its name upside down, and one drawn with three taps carried "te" on one leg
 * and "ste 5" down the next. These roads are polylines with sharp corners,
 * never curves, so following them buys nothing. Paper maps letter a road along
 * its straightest stretch instead: the name is one straight label, centred on
 * the longest leg and turned to its angle, and it always reads left to right —
 * a leg that runs west is lettered from its far end, and a vertical one reads
 * bottom to top like a book's spine, whichever way it was drawn.
 */
export function namePlacement(
  points: MapPoint[],
  w: number,
  h: number,
): { x: number; y: number; angle: number } | null {
  if (points.length < 2) return null;
  let at = 1;
  let longest = -1;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot((points[i].x - points[i - 1].x) * w, (points[i].y - points[i - 1].y) * h);
    if (len > longest) {
      longest = len;
      at = i;
    }
  }
  const a = points[at - 1];
  const b = points[at];
  let angle = (Math.atan2((b.y - a.y) * h, (b.x - a.x) * w) * 180) / Math.PI;
  // Into [-90, 90): left to right, and straight up rather than straight down.
  if (angle >= 90) angle -= 180;
  else if (angle < -90) angle += 180;
  return { x: ((a.x + b.x) / 2) * w, y: ((a.y + b.y) / 2) * h, angle };
}

/** Where a region's name sits: the centroid of its corners, near enough. */
function centroid(points: MapPoint[], w: number, h: number) {
  const sx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const sy = points.reduce((a, p) => a + p.y, 0) / points.length;
  return { x: sx * w, y: sy * h };
}

function ShapeMark({
  shape,
  width,
  height,
  onOpen,
}: {
  shape: MapShape;
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
  const place = area ? null : namePlacement(shape.points, width, height);

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
          // A road's name sits along its longest straight leg, above it, turned
          // to its angle. It was stored and never drawn before #262, which made
          // naming one pointless; and a straight caption beside a winding track
          // reads as a different thing, which is why it is *on* the leg.
          place && (
            <text
              data-road-name={label}
              x={place.x}
              y={place.y - stroke * 1.1}
              transform={`rotate(${place.angle} ${place.x} ${place.y})`}
              textAnchor="middle"
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
              {label}
            </text>
          )
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
