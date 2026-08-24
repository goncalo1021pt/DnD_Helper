/*
Pan, zoom, and the difference between a drag and a tap.

Lifted whole out of MapPage (#108). This is the part of that file that had
nothing to do with maps: pointer capture, a two-finger pinch, a wheel that must
not scroll the page, and the ~6px of slop that decides whether the DM meant to
move the map or to press a point on it.

The one place it touches the app is that decision. A press that never moved,
released with no other finger down, on open ground, is a *tap* — and only the
caller knows whether a tap means dropping a pin, stamping a reveal, or nothing
at all. So the hook resolves the tap into the map's own fractional coordinates
and hands it over; what it means is not its business.

onMapChanged fires under the same one-shot guard as the fit, deliberately.
`map` is query data, so its identity changes on every refetch; an effect keyed
on the object rather than the id would clear a half-drawn draft each time the
map metadata came back.
*/

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { CampaignMap } from "../../api/client";
import { tapFraction, type View } from "./viewport";

export interface MapViewer {
  containerRef: RefObject<HTMLDivElement | null>;
  view: View;
  fitScale: RefObject<number>;
  zoomBy: (k: number) => void;
  fitToContainer: (w: number, h: number) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useMapViewer({
  map,
  mapId,
  onTap,
  onMapChanged,
}: {
  map: CampaignMap | undefined;
  mapId: string | undefined;
  /** A genuine tap on open ground, in the map's own fractions (both within 0..1). */
  onTap: (at: { x: number; y: number }) => void;
  /** The map on the table changed — fires once per map, before it is fitted. */
  onMapChanged: () => void;
}): MapViewer {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitScale = useRef(1);
  const fittedFor = useRef<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startDist: number;
    startMid: { x: number; y: number };
    start: View;
  } | null>(null);
  const tap = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const clampScale = (s: number) =>
    Math.min(Math.max(s, fitScale.current * 0.4), fitScale.current * 14);

  function fitToContainer(w: number, h: number) {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fit = Math.min(r.width / w, r.height / h);
    fitScale.current = fit;
    setView({ scale: fit, tx: (r.width - w * fit) / 2, ty: (r.height - h * fit) / 2 });
  }

  // Fit once per map (image dimensions come with the metadata).
  useEffect(() => {
    if (map && fittedFor.current !== map.id) {
      fittedFor.current = map.id;
      onMapChanged();
      fitToContainer(map.width, map.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Wheel zoom, attached non-passively so the page never scrolls under it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const next = clampScale(v.scale * Math.exp(-e.deltaY * 0.0016));
      const k = next / v.scale;
      setView({ scale: next, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId]);

  function zoomBy(k: number) {
    const el = containerRef.current;
    if (!el) return;
    const v = viewRef.current;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    const next = clampScale(v.scale * k);
    const kk = next / v.scale;
    setView({ scale: next, tx: cx - (cx - v.tx) * kk, ty: cy - (cy - v.ty) * kk });
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el) return;
    // A press on a pin, a drawn shape, or a control is theirs — capturing it
    // would eat their click (captured pointers retarget every later event,
    // so the browser resolves the click onto this container instead).
    //
    // A shape is exempted here but answers pointer events only along its
    // stroke (see ShapeLayer): a region covering half the map must still be
    // ground you can drag, or the map would lock up inside its own borders.
    if ((e.target as HTMLElement).closest?.("button, [data-pin-id], [data-shape-id]")) return;
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      tap.current = { x: e.clientX, y: e.clientY, moved: false };
    } else {
      tap.current = null;
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        start: viewRef.current,
      };
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el || !pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 6) {
      tap.current.moved = true;
    }

    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = gesture.current;
      const r = el.getBoundingClientRect();
      const next = clampScale(g.start.scale * (dist / Math.max(g.startDist, 1)));
      const k = next / g.start.scale;
      const mx = g.startMid.x - r.left;
      const my = g.startMid.y - r.top;
      setView({
        scale: next,
        tx: mid.x - r.left - (mx - g.start.tx) * k,
        ty: mid.y - r.top - (my - g.start.ty) * k,
      });
    } else if (pointers.current.size === 1) {
      const v = viewRef.current;
      setView({ ...v, tx: v.tx + (e.clientX - prev.x), ty: v.ty + (e.clientY - prev.y) });
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;

    // A tap (no drag) on open ground: the caller decides what it means.
    if (tap.current && !tap.current.moved && pointers.current.size === 0 && map) {
      if (containerRef.current) {
        const f = tapFraction(e, containerRef.current, viewRef.current, map);
        if (f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1) onTap(f);
      }
    }
    tap.current = null;
  }

  return {
    containerRef,
    view,
    fitScale,
    zoomBy,
    fitToContainer,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
