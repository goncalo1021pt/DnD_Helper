import { useEffect, useRef } from "react";
import type { CampaignMap, RevealCircle } from "../../api/client";

/** Cap the fog raster so huge maps don't allocate huge canvases; circles are
 * fractional, so the raster scale never changes the geometry. */
export const FOG_RASTER_MAX = 2048;

/** A stable fingerprint of a player's revealed set, appended to the image URL
 * so the browser refetches the server-fogged image when the DM reveals more. */
export function revealSig(circles: RevealCircle[]): string {
  let h = 0;
  for (const c of circles) {
    const s = `${c.x.toFixed(4)},${c.y.toFixed(4)},${c.r.toFixed(4)};`;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return `${(h >>> 0).toString(36)}-${circles.length}`;
}

/* The fog itself: black for players, a readable dark veil for the DM.
 * Committed and draft circles punch through; drafts get a dashed gold rim so
 * the DM can see what hasn't been submitted yet. Sits between the map image
 * and the pins, and ignores the pointer entirely. */
export function FogCanvas({
  map,
  revealed,
  draft,
  isDM,
}: {
  map: CampaignMap;
  revealed: RevealCircle[];
  draft: RevealCircle[];
  isDM: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const k = Math.min(1, FOG_RASTER_MAX / Math.max(map.width, map.height));
    const W = Math.max(1, Math.round(map.width * k));
    const H = Math.max(1, Math.round(map.height * k));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = isDM ? 0.62 : 1;
    ctx.fillStyle = "#060301";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // Punch every circle out of the veil, soft-edged.
    ctx.globalCompositeOperation = "destination-out";
    for (const c of [...revealed, ...draft]) {
      const cx = c.x * W;
      const cy = c.y * H;
      const cr = Math.max(1, c.r * W);
      const g = ctx.createRadialGradient(cx, cy, cr * 0.62, cx, cy, cr);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draft rims, for the DM's eyes while stamping.
    if (isDM && draft.length > 0) {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(224,169,78,.9)";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = Math.max(1.5, W / 900);
      for (const c of draft) {
        ctx.beginPath();
        ctx.arc(c.x * W, c.y * H, Math.max(1, c.r * W), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }, [map.id, map.width, map.height, revealed, draft, isDM]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
