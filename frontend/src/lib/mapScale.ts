/*
 * How far things are on a map (#357).
 *
 * A map stores what its full WIDTH spans ("120 miles across"). A point is a
 * fraction of the width (x) and of the height (y), so a leg's length is the
 * hypotenuse of dx and dy·(height/width), in widths, times that distance.
 * Nothing here is stored: a road's length and a measure are worked out on the
 * spot from the points and the map, every time.
 *
 * Travel is the 2024 table: fast 4 mph / 30 miles a day, normal 3 / 24, slow
 * 2 / 18 — a day being eight hours on the road.
 */

import type { CampaignMap, MapPoint } from "../api/client";

export type MapScale = NonNullable<CampaignMap["scale"]>;
export type ScaleUnit = MapScale["unit"];

const KM_PER_MILE = 1.609344;

export const PACES = [
  { pace: "fast", mph: 4, perDay: 30 },
  { pace: "normal", mph: 3, perDay: 24 },
  { pace: "slow", mph: 2, perDay: 18 },
] as const;

/** A run's length in image widths. */
export function runWidths(points: MapPoint[], width: number, height: number): number {
  const aspect = height / width;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, (points[i].y - points[i - 1].y) * aspect);
  }
  return total;
}

/** A run's length in the map's unit, or null on a map nobody has measured. */
export function runDistance(
  points: MapPoint[],
  map: Pick<CampaignMap, "width" | "height" | "scale">,
): number | null {
  if (!map.scale || points.length < 2) return null;
  return runWidths(points, map.width, map.height) * map.scale.distance;
}

/** The scale that makes a measured run as long as the DM says it is. */
export function scaleFor(
  points: MapPoint[],
  map: Pick<CampaignMap, "width" | "height">,
  distance: number,
): number | null {
  const widths = runWidths(points, map.width, map.height);
  if (widths <= 0 || !(distance > 0)) return null;
  return distance / widths;
}

const UNIT: Record<ScaleUnit, string> = { miles: "mi", km: "km", feet: "ft" };

/** "63 mi", "4.2 km", "1,250 ft". */
export function formatDistance(d: number, unit: ScaleUnit): string {
  if (unit === "feet") return `${Math.round(d).toLocaleString("en")} ft`;
  const n = d < 10 ? Math.round(d * 10) / 10 : Math.round(d);
  return `${n.toLocaleString("en")} ${UNIT[unit]}`;
}

/** Halves read as people say them: 2½, not 2.5. */
function halves(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (whole === 0) return half ? "½" : "0";
  return `${whole}${half ? "½" : ""}`;
}

/**
 * How long it takes to walk, at one pace: hours under a day of travel, days
 * after, rounded up to the half. Null for a map in feet — a dungeon is not
 * travelled in days — and for nothing at all.
 */
export function travelTime(d: number, unit: ScaleUnit, pace: (typeof PACES)[number]): string | null {
  if (unit === "feet" || !(d > 0)) return null;
  const miles = unit === "km" ? d / KM_PER_MILE : d;
  const hours = miles / pace.mph;
  if (hours <= 8) {
    const h = Math.max(0.5, Math.ceil(hours * 2) / 2);
    return `${halves(h)} ${h <= 1 ? "hour" : "hours"}`;
  }
  const days = Math.ceil((miles / pace.perDay) * 2) / 2;
  return `${halves(days)} ${days <= 1 ? "day" : "days"}`;
}

/** "63 mi · about 3 days" — the line a road or a measure reads. */
export function distanceLine(d: number, unit: ScaleUnit): string {
  const normal = travelTime(d, unit, PACES[1]);
  return normal ? `${formatDistance(d, unit)} · about ${normal}` : formatDistance(d, unit);
}
