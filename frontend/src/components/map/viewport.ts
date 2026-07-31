/*
The map's own coordinate system.

A pin is stored as a fraction of the map, not as pixels, so it survives a
different screen, a different zoom and a different browser. tapFraction is what
turns a press into one — through the pan/zoom transform, which is why it needs
the view and not just the element. Get it wrong and every pin on every map moves
at once, quietly. e2e/map.spec.ts holds it to an off-centre point for exactly
that reason.
*/
import type { CampaignMap } from "../../api/client";

export type View = { scale: number; tx: number; ty: number };

/** Where a tap landed, as fractions of the map image. */
export function tapFraction(
  e: { clientX: number; clientY: number },
  el: HTMLElement,
  view: View,
  map: CampaignMap,
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - view.tx) / (map.width * view.scale),
    y: (e.clientY - r.top - view.ty) / (map.height * view.scale),
  };
}
