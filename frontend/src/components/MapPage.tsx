import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { CampaignMap, MapPin } from "../api/client";
import {
  useCreateMap,
  useCreateMapPin,
  useDeleteMap,
  useDeleteMapPin,
  useMapDetail,
  useMaps,
  useUpdateMapPin,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";
import { IconEyeOff, IconMapPin, IconPlus, IconTrash, IconPencil } from "./ui/icons";

/**
 * The Map: the campaign atlas. One canvas you can pan, zoom and pinch;
 * pins at fractional coordinates; region pins that lead into sub-maps.
 * DM hangs maps and drops pins — players wander what they're shown.
 */

type View = { scale: number; tx: number; ty: number };

/** Where a tap landed, as fractions of the map image. */
function tapFraction(
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

/* One pin marker on the canvas, counter-scaled to stay a constant size.
 * Clicks are its own affair — the canvas never captures a press that starts
 * on a pin, so the native click survives. */
function PinMarker({
  pin,
  scale,
  onOpen,
}: {
  pin: MapPin;
  scale: number;
  onOpen: (pin: MapPin) => void;
}) {
  const region = !!pin.linkMapId;
  return (
    <div
      data-pin-id={pin.id}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(pin);
      }}
      className="absolute cursor-pointer"
      style={{
        left: `${pin.x * 100}%`,
        top: `${pin.y * 100}%`,
        transform: `translate(-50%, -100%) scale(${1 / scale})`,
        transformOrigin: "50% 100%",
        opacity: pin.dmOnly ? 0.65 : 1,
      }}
    >
      <div className="flex flex-col items-center">
        <span
          className="relative"
          style={{
            color: region ? "#e0a94e" : "#c96a5a",
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,.6))",
          }}
        >
          <IconMapPin size={region ? 30 : 24} strokeWidth={2} />
          {pin.dmOnly && (
            <span className="absolute -right-2 -top-1 text-[#9a86b8]">
              <IconEyeOff size={12} strokeWidth={2.2} />
            </span>
          )}
        </span>
        <span
          className="label-stamp mt-0.5 max-w-[140px] truncate rounded-[2px] px-1.5 py-0.5 text-[9px] font-semibold tracking-[1px] text-[#f0dfb8]"
          style={{
            background: "rgba(16,9,5,.72)",
            boxShadow: `inset 0 0 0 1px ${region ? "rgba(201,162,39,.5)" : "rgba(201,106,90,.4)"}`,
          }}
        >
          {pin.label}
        </span>
      </div>
    </div>
  );
}

/* Create-or-edit pin form. */
function PinForm({
  initial,
  maps,
  currentMapId,
  isPending,
  errorText,
  onCancel,
  onSubmit,
}: {
  initial: { label: string; note: string; dmOnly: boolean; linkMapId: string };
  maps: CampaignMap[];
  currentMapId: string;
  isPending: boolean;
  errorText?: string;
  onCancel: () => void;
  onSubmit: (v: { label: string; note: string; dmOnly: boolean; linkMapId: string }) => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [note, setNote] = useState(initial.note);
  const [dmOnly, setDmOnly] = useState(initial.dmOnly);
  const [linkMapId, setLinkMapId] = useState(initial.linkMapId);
  const targets = maps.filter((m) => m.id !== currentMapId);

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="field-label">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="The Sleeping Giant Inn"
          className="input-parchment mt-1 w-full"
        />
      </label>
      <label className="block">
        <span className="field-label">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What the party should know — or what only you should."
          className="input-parchment mt-1 w-full resize-y"
        />
      </label>
      {targets.length > 0 && (
        <label className="block">
          <span className="field-label">Leads into</span>
          <select
            value={linkMapId}
            onChange={(e) => setLinkMapId(e.target.value)}
            className="input-parchment mt-1 w-full cursor-pointer"
          >
            <option value="">Nowhere — just a marker</option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={dmOnly}
          onChange={(e) => setDmOnly(e.target.checked)}
        />
        <span className="text-[13px] text-ink-body">
          DM only — the party never sees this pin
        </span>
      </label>
      {errorText && (
        <div className="font-body text-sm italic text-[#8b2520]">{errorText}</div>
      )}
      <div className="mt-1 flex items-center justify-end gap-3">
        <button onClick={onCancel} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ label, note, dmOnly, linkMapId })}
          disabled={!label.trim() || isPending}
          className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Pinning…" : "Pin it"}
        </button>
      </div>
    </div>
  );
}

export default function MapPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { mapId: routeMapId } = useParams();
  const navigate = useNavigate();

  const { data: maps, isLoading } = useMaps(campaign.id);

  // The map on the table: the routed one, else the first overworld, else the first.
  const currentId =
    routeMapId ??
    (maps ?? []).find((m) => !m.parentMapId)?.id ??
    (maps ?? [])[0]?.id;
  const { data: detail } = useMapDetail(currentId);
  const map = detail?.map;

  const createMap = useCreateMap(campaign.id);
  const deleteMap = useDeleteMap(campaign.id);
  const createPin = useCreateMapPin(currentId ?? "");
  const updatePin = useUpdateMapPin(currentId ?? "");
  const deletePin = useDeleteMapPin(currentId ?? "");

  // ── viewer state ─────────────────────────────────────────────────────────
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

  // ── ui state ─────────────────────────────────────────────────────────────
  const [dropMode, setDropMode] = useState(false);
  const [newPinAt, setNewPinAt] = useState<{ x: number; y: number } | null>(null);
  const [openPin, setOpenPin] = useState<MapPin | null>(null);
  const [editingPin, setEditingPin] = useState<MapPin | null>(null);
  const [hanging, setHanging] = useState(false);
  const [mapName, setMapName] = useState("");
  const [mapParent, setMapParent] = useState("");
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [hangError, setHangError] = useState("");

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
      setDropMode(false);
      fitToContainer(map.width, map.height);
    }
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
  }, [currentId]);

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
    // A press on a pin or a control is theirs — capturing it would eat
    // their click (captured pointers retarget every later event).
    if ((e.target as HTMLElement).closest?.("button, [data-pin-id]")) return;
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

    // A tap (no drag) on open ground: drop a pin, in drop mode.
    if (tap.current && !tap.current.moved && pointers.current.size === 0 && map) {
      if (dropMode && isDM && containerRef.current) {
        const f = tapFraction(e, containerRef.current, viewRef.current, map);
        if (f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1) setNewPinAt(f);
      }
    }
    tap.current = null;
  }

  // ── atlas structure ──────────────────────────────────────────────────────
  const byId = useMemo(() => new Map((maps ?? []).map((m) => [m.id, m])), [maps]);
  const breadcrumb = useMemo(() => {
    const chain: CampaignMap[] = [];
    let cur = map ? byId.get(map.id) : undefined;
    let hops = 0;
    while (cur && hops++ < 10) {
      chain.unshift(cur);
      cur = cur.parentMapId ? byId.get(cur.parentMapId) : undefined;
    }
    return chain;
  }, [map, byId]);

  function goTo(id: string) {
    navigate(`/questboard/campaigns/${campaign.id}/map/${id}`);
  }

  function hangMap() {
    if (!mapFile) return;
    setHangError("");
    const reader = new FileReader();
    reader.onload = () => {
      createMap.mutate(
        {
          name: mapName.trim() || mapFile.name.replace(/\.[^.]+$/, ""),
          imageBase64: String(reader.result),
          ...(mapParent ? { parentMapId: mapParent } : {}),
        },
        {
          onSuccess: (m) => {
            setHanging(false);
            setMapName("");
            setMapParent("");
            setMapFile(null);
            goTo(m.id);
          },
          onError: (err) =>
            setHangError(
              (err as { error?: string } | null)?.error ?? "The map would not hang.",
            ),
        },
      );
    };
    reader.readAsDataURL(mapFile);
  }

  const apiError = (e: unknown) =>
    (e as { error?: string } | null)?.error ?? "The quill snapped — try again.";

  // ── render ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
        Unrolling the map…
      </div>
    );
  }

  return (
    <div className="panel-hall px-4 pb-6 pt-6 sm:px-[26px]">
      {/* header: breadcrumb + atlas controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2
            className="font-display m-0 text-[clamp(20px,2.6vw,26px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Map
          </h2>
          {breadcrumb.length > 0 && (
            <span className="label-stamp flex flex-wrap items-center gap-1 text-[10px] tracking-[1.5px] text-gold-muted">
              {breadcrumb.map((m, i) => (
                <span key={m.id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gold-hair">›</span>}
                  {i === breadcrumb.length - 1 ? (
                    <span className="text-ember-bright">{m.name}</span>
                  ) : (
                    <button
                      onClick={() => goTo(m.id)}
                      className="cursor-pointer border-none bg-transparent p-0 text-[10px] font-semibold tracking-[1.5px] text-gold-muted transition hover:text-ember-bright"
                    >
                      {m.name}
                    </button>
                  )}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(maps ?? []).length > 1 && (
            <select
              value={currentId ?? ""}
              onChange={(e) => goTo(e.target.value)}
              className="input-hall w-44"
            >
              {(maps ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.parentMapId ? `↳ ${m.name}` : m.name}
                </option>
              ))}
            </select>
          )}
          {isDM && (
            <>
              {map && (
                <button
                  onClick={() => setDropMode((d) => !d)}
                  className={`btn-base ${dropMode ? "btn-wax" : "btn-ghost-ink"} px-4 py-2.5 text-[11px]`}
                  style={dropMode ? undefined : { color: "#cdba93" }}
                >
                  <IconMapPin size={13} strokeWidth={1.9} />
                  {dropMode ? "Tap the map…" : "Drop a pin"}
                </button>
              )}
              <button
                onClick={() => setHanging(true)}
                className="btn-base btn-gold clip-octagon h-10 px-4 text-[12px]"
              >
                <IconPlus size={14} strokeWidth={2} />
                Hang a map
              </button>
            </>
          )}
        </div>
      </div>

      {/* the canvas */}
      {!map ? (
        <div className="px-5 py-[80px] text-center">
          <div className="mb-4 inline-flex text-[#7a5e34]">
            <IconMapPin size={44} strokeWidth={1.4} />
          </div>
          <div className="font-display text-2xl text-[#cdb582]">
            The world is still uncharted
          </div>
          <div className="font-accent mt-2 text-base italic text-[#9c855e]">
            {isDM
              ? "— hang the first map and give the party somewhere to be. —"
              : "— the DM has not unrolled a map yet. —"}
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative w-full select-none overflow-hidden rounded-[4px]"
          style={{
            height: "min(72vh, 900px)",
            background: "#0d0803",
            boxShadow: "inset 0 0 0 1px rgba(201,162,39,.28), inset 0 0 60px rgba(0,0,0,.7)",
            touchAction: "none",
            cursor: dropMode ? "crosshair" : "grab",
          }}
        >
          <div
            style={{
              position: "absolute",
              width: map.width,
              height: map.height,
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <img
              src={`/api/maps/${map.id}/image`}
              alt={map.name}
              draggable={false}
              className="block h-full w-full"
              style={{ imageRendering: view.scale > fitScale.current * 4 ? "pixelated" : "auto" }}
            />
            {(detail?.pins ?? []).map((p) => (
              <PinMarker key={p.id} pin={p} scale={view.scale} onOpen={setOpenPin} />
            ))}
          </div>

          {/* zoom rail */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
            {[
              ["+", () => zoomBy(1.45)] as const,
              ["−", () => zoomBy(1 / 1.45)] as const,
              ["⌂", () => fitToContainer(map.width, map.height)] as const,
            ].map(([label, fn]) => (
              <button
                key={label}
                onClick={fn}
                className="font-heading h-9 w-9 cursor-pointer rounded-[3px] border-none text-base font-bold text-[#e0c890] transition hover:brightness-125"
                style={{
                  background: "rgba(16,9,5,.78)",
                  boxShadow: "inset 0 0 0 1px rgba(201,162,39,.4)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {dropMode && (
            <div
              className="label-stamp absolute left-1/2 top-3 -translate-x-1/2 rounded-[3px] px-3 py-1.5 text-[10px] tracking-[2px] text-[#f0dfb8]"
              style={{ background: "rgba(94,22,17,.85)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" }}
            >
              Tap where the pin goes
            </div>
          )}
        </div>
      )}

      {/* pin popover */}
      {openPin && (
        <ParchmentModal onClose={() => setOpenPin(null)} maxWidth="max-w-[420px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            {openPin.dmOnly ? "DM only" : map?.name}
          </div>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
            {openPin.label}
          </h3>
          {openPin.note && (
            <p className="font-body m-0 mb-4 whitespace-pre-wrap text-center text-[13.5px] italic text-ink-body">
              {openPin.note}
            </p>
          )}
          {openPin.linkMapId && byId.get(openPin.linkMapId) && (
            <button
              onClick={() => {
                const id = openPin.linkMapId!;
                setOpenPin(null);
                goTo(id);
              }}
              className="btn-base btn-gold clip-octagon mx-auto mb-2 flex h-11 px-6 text-[13px]"
            >
              Enter {byId.get(openPin.linkMapId)!.name} →
            </button>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={() => setOpenPin(null)}
              className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
            >
              Close
            </button>
            {isDM && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditingPin(openPin);
                    setOpenPin(null);
                  }}
                  className="btn-base btn-ghost-ink px-3.5 py-2 text-[11px]"
                >
                  <IconPencil size={12} strokeWidth={1.8} />
                  Amend
                </button>
                <button
                  onClick={() => {
                    deletePin.mutate(openPin.id);
                    setOpenPin(null);
                  }}
                  className="btn-base btn-ghost-red px-3.5 py-2 text-[11px]"
                >
                  <IconTrash size={12} strokeWidth={1.8} />
                  Pull it
                </button>
              </div>
            )}
          </div>
        </ParchmentModal>
      )}

      {/* new pin form */}
      {newPinAt && map && (
        <ParchmentModal onClose={() => setNewPinAt(null)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            {map.name}
          </div>
          <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
            Drop a Pin
          </h3>
          <PinForm
            initial={{ label: "", note: "", dmOnly: false, linkMapId: "" }}
            maps={maps ?? []}
            currentMapId={map.id}
            isPending={createPin.isPending}
            errorText={createPin.isError ? apiError(createPin.error) : undefined}
            onCancel={() => setNewPinAt(null)}
            onSubmit={(v) =>
              createPin.mutate(
                {
                  label: v.label,
                  note: v.note,
                  x: newPinAt.x,
                  y: newPinAt.y,
                  dmOnly: v.dmOnly,
                  ...(v.linkMapId ? { linkMapId: v.linkMapId } : {}),
                },
                {
                  onSuccess: () => {
                    setNewPinAt(null);
                    setDropMode(false);
                  },
                },
              )
            }
          />
        </ParchmentModal>
      )}

      {/* edit pin form */}
      {editingPin && map && (
        <ParchmentModal onClose={() => setEditingPin(null)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            {map.name}
          </div>
          <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
            Amend the Pin
          </h3>
          <PinForm
            initial={{
              label: editingPin.label,
              note: editingPin.note,
              dmOnly: editingPin.dmOnly,
              linkMapId: editingPin.linkMapId ?? "",
            }}
            maps={maps ?? []}
            currentMapId={map.id}
            isPending={updatePin.isPending}
            errorText={updatePin.isError ? apiError(updatePin.error) : undefined}
            onCancel={() => setEditingPin(null)}
            onSubmit={(v) =>
              updatePin.mutate(
                {
                  pinId: editingPin.id,
                  body: {
                    label: v.label,
                    note: v.note,
                    x: editingPin.x,
                    y: editingPin.y,
                    dmOnly: v.dmOnly,
                    ...(v.linkMapId ? { linkMapId: v.linkMapId } : {}),
                  },
                },
                { onSuccess: () => setEditingPin(null) },
              )
            }
          />
        </ParchmentModal>
      )}

      {/* hang-a-map modal */}
      {hanging && (
        <ParchmentModal onClose={() => setHanging(false)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Map
          </div>
          <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
            Hang a Map
          </h3>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="field-label">Name</span>
              <input
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                placeholder="The Known World"
                className="input-parchment mt-1 w-full"
              />
            </label>
            <label className="block">
              <span className="field-label">The image (JPEG or PNG, up to 10 MB)</span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={(e) => setMapFile(e.target.files?.[0] ?? null)}
                className="font-body mt-1 w-full text-[13px] text-ink-body"
              />
            </label>
            {(maps ?? []).length > 0 && (
              <label className="block">
                <span className="field-label">Hangs under</span>
                <select
                  value={mapParent}
                  onChange={(e) => setMapParent(e.target.value)}
                  className="input-parchment mt-1 w-full cursor-pointer"
                >
                  <option value="">Nothing — it's an overworld</option>
                  {(maps ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {hangError && (
              <div className="font-body text-sm italic text-[#8b2520]">{hangError}</div>
            )}
            <div className="mt-1 flex items-center justify-between gap-3">
              {map && isDM ? (
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Strike "${map.name}" and all its pins from the atlas?`,
                      )
                    ) {
                      setHanging(false);
                      deleteMap.mutate(map.id, {
                        onSuccess: () => {
                          fittedFor.current = null;
                          navigate(`/questboard/campaigns/${campaign.id}/map`);
                        },
                      });
                    }
                  }}
                  className="btn-base btn-ghost-red px-3.5 py-2 text-[11px]"
                >
                  <IconTrash size={12} strokeWidth={1.8} />
                  Strike this map
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setHanging(false)}
                  className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={hangMap}
                  disabled={!mapFile || createMap.isPending}
                  className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createMap.isPending ? "Hanging…" : "Hang it"}
                </button>
              </div>
            </div>
          </div>
        </ParchmentModal>
      )}
    </div>
  );
}
