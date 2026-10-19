import { describe, expect, it } from "vitest";
import { PACES, distanceLine, formatDistance, runDistance, runWidths, scaleFor, travelTime } from "./mapScale";

const map = { width: 2000, height: 1000, scale: { distance: 120, unit: "miles" as const } };

describe("map scale (#357)", () => {
  it("measures in widths, with the height counted in widths too", () => {
    // Straight across: one width. Straight down a half-height map: half a width.
    expect(runWidths([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], 2000, 1000)).toBeCloseTo(1);
    expect(runWidths([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], 2000, 1000)).toBeCloseTo(0.5);
    // A 3-4-5 triangle: 0.3 across and 0.8 down a half-height map (0.4 widths).
    expect(runWidths([{ x: 0, y: 0 }, { x: 0.3, y: 0.8 }], 2000, 1000)).toBeCloseTo(0.5);
  });

  it("turns a run into the map's own unit, and says nothing without a scale", () => {
    expect(runDistance([{ x: 0, y: 0 }, { x: 0.5, y: 0 }], map)).toBeCloseTo(60);
    expect(runDistance([{ x: 0, y: 0 }, { x: 0.5, y: 0 }], { ...map, scale: undefined })).toBeNull();
    expect(runDistance([{ x: 0, y: 0 }], map)).toBeNull();
  });

  it("sets a scale from a measured run", () => {
    // A quarter of the width is 30 miles: the whole width is 120.
    expect(scaleFor([{ x: 0.1, y: 0.2 }, { x: 0.35, y: 0.2 }], map, 30)).toBeCloseTo(120);
    expect(scaleFor([{ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2 }], map, 30)).toBeNull();
  });

  it("reads distances and travel the way a table says them", () => {
    expect(formatDistance(63.4, "miles")).toBe("63 mi");
    expect(formatDistance(4.24, "km")).toBe("4.2 km");
    expect(formatDistance(1250.4, "feet")).toBe("1,250 ft");
    const normal = PACES[1];
    expect(travelTime(6, "miles", normal)).toBe("2 hours");
    expect(travelTime(1, "miles", normal)).toBe("½ hour");
    expect(travelTime(63, "miles", normal)).toBe("3 days"); // 2.6 days, rounded up to the half
    expect(travelTime(60, "miles", normal)).toBe("2½ days");
    expect(travelTime(96.5, "km", normal)).toBe("2½ days"); // just under 60 miles
    expect(travelTime(500, "feet", normal)).toBeNull();
    expect(distanceLine(63, "miles")).toBe("63 mi · about 3 days");
    expect(distanceLine(300, "feet")).toBe("300 ft");
  });
});
