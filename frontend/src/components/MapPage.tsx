import { useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { CampaignMap, MapPin, MapPoint, MapShape } from "../api/client";
import {
  useCreateMapPin,
  useCreateMapShape,
  useDeleteMapPin,
  useDeleteMapShape,
  useUpdateMapShape,
  useDeleteReveals,
  useLocations,
  useMapDetail,
  useMaps,
  useSetRevealLocation,
  useParties,
  useSubmitReveals,
  useUpdateMap,
  useUpdateMapPin,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";
import { IconBook, IconEye, IconEyeOff, IconMapPin, IconPencil, IconPlus, IconTrash } from "./ui/icons";
import { AtlasModal } from "./map/AtlasModal";
import { FogCanvas, revealSig } from "./map/FogCanvas";
import { HangMapForm } from "./map/HangMapForm";
import { InkworkModal } from "./map/InkworkModal";
import { PinForm } from "./map/PinForm";
import { PinMarker } from "./map/PinMarker";
import { ShapeForm, type ShapeDraft } from "./map/ShapeForm";
import { ShapeLayer } from "./map/ShapeLayer";
import { RevealLedger } from "./map/RevealLedger";
import { useMapViewer } from "./map/useMapViewer";
import { useRevealDraft } from "./map/useRevealDraft";

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
  const { data: detail } = useMapDetail(currentId, campaign.id);
  const map = detail?.map;

  const updateMap = useUpdateMap(campaign.id);
  const createPin = useCreateMapPin(currentId ?? "", campaign.id);
  const updatePin = useUpdateMapPin(currentId ?? "", campaign.id);
  const deletePin = useDeleteMapPin(currentId ?? "", campaign.id);
  const submitReveals = useSubmitReveals(currentId ?? "", campaign.id);
  const { data: partyRoll } = useParties(campaign.id);
  const parties = (partyRoll ?? []).filter((p) => p.heroCount > 0);
  const [submitPartyId, setSubmitPartyId] = useState("");
  const deleteReveals = useDeleteReveals(currentId ?? "", campaign.id);
  const createShape = useCreateMapShape(currentId ?? "", campaign.id);
  const updateShape = useUpdateMapShape(currentId ?? "", campaign.id);
  const deleteShape = useDeleteMapShape(currentId ?? "", campaign.id);
  const setRevealLocation = useSetRevealLocation(currentId ?? "", campaign.id);

  // The place tree, so a reveal can be handed to whoever knows that place
  // rather than to the whole table (#191). DM-only: the picker never renders
  // for a player, and this is the same list the quest board already loads.
  const { data: locations } = useLocations(campaign.id);

  const draftState = useRevealDraft();
  const {
    stampMode,
    setStampMode,
    draft,
    setDraft,
    brush,
    setBrush,
    submitOpen,
    setSubmitOpen,
    submitNote,
    setSubmitNote,
    submitLocationId,
    setSubmitLocationId,
  } = draftState;

  // ── ui state ─────────────────────────────────────────────────────────────
  const [dropMode, setDropMode] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [newPinAt, setNewPinAt] = useState<{ x: number; y: number } | null>(null);
  const [openPin, setOpenPin] = useState<MapPin | null>(null);
  const [editingPin, setEditingPin] = useState<MapPin | null>(null);
  const [hanging, setHanging] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);

  /*
  Drawing a road or a region (#262).

  One gesture serves both: tap to lay down points, and finish. What is being
  drawn is only `drawKind`, which decides whether the run is stroked along or
  filled in — and, at the end, which words the form uses.
  */
  const [drawKind, setDrawKind] = useState<"line" | "area" | null>(null);
  const [drawPoints, setDrawPoints] = useState<MapPoint[]>([]);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  // What is already drawn (#277) — and where a new run is chosen from.
  const [inkworkOpen, setInkworkOpen] = useState(false);

  function stopDrawing() {
    setDrawKind(null);
    setDrawPoints([]);
  }

  // A line needs two points to go anywhere, a region three to enclose any.
  const drawEnough = drawPoints.length >= (drawKind === "area" ? 3 : 2);

  // What a tap means is the page's business, not the viewer's: the viewer only
  // says that one happened, and where on the map it landed.
  const {
    containerRef,
    view,
    fitScale,
    zoomBy,
    fitToContainer,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } =
    useMapViewer({
      map,
      onTap: (at) => {
        if (!isDM) return;
        if (drawKind) setDrawPoints((pts) => [...pts, { x: at.x, y: at.y }]);
        else if (dropMode) setNewPinAt(at);
        else if (stampMode) draftState.stamp(at);
      },
      onMapChanged: () => {
        setDropMode(false);
        stopDrawing();
        setShapeDraft(null);
        setInkworkOpen(false);
        draftState.reset();
      },
    });

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
          {/* A DM stamping fog on a map nobody can see is doing work for
              nobody, so the map on the table says when it is still theirs
              alone (#276). It leads to the atlas, where the veil is set. */}
          {isDM && map && map.visibleToParty === false && (
            <button
              onClick={() => setAtlasOpen(true)}
              title="The table cannot see this map at all — press to hang it in the hall"
              className="btn-base btn-ghost-ember px-3 py-2 text-[10px]"
            >
              <IconEyeOff size={12} strokeWidth={1.9} />
              Yours alone
            </button>
          )}
          {/* The atlas replaced a bare <select> here (#216): switching, and for
              the DM striking, happen on a page where each map is a row. */}
          {(maps ?? []).length > (isDM ? 0 : 1) && (
            <button
              onClick={() => setAtlasOpen(true)}
              className="btn-base btn-ghost-gold px-4 py-2.5 text-[11px]"
            >
              <IconBook size={13} strokeWidth={1.9} />
              Atlas
            </button>
          )}
          {isDM && (
            <>
              {map && (locations ?? []).length > 0 && (
                <select
                  value={map.locationId ?? ""}
                  onChange={(e) =>
                    // The place this map depicts (#229). The empty choice
                    // unfiles via the nil-UUID sentinel — absent means
                    // unchanged on this endpoint, the shops' lesson.
                    updateMap.mutate({
                      mapId: map.id,
                      body: {
                        name: map.name,
                        ...(map.parentMapId ? { parentMapId: map.parentMapId } : {}),
                        locationId:
                          e.target.value || "00000000-0000-0000-0000-000000000000",
                      },
                    })
                  }
                  disabled={updateMap.isPending}
                  title="The place this map depicts"
                  className="input-hall input-compact w-40 cursor-pointer text-[12px]"
                >
                  <option value="">No place — just a map</option>
                  {(locations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {"— ".repeat(l.depth)}
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              {map && (
                <button
                  onClick={() => {
                    setDropMode((d) => !d);
                    setStampMode(false);
                  }}
                  className={`btn-base ${dropMode ? "btn-wax" : "btn-ghost-gold"} px-4 py-2.5 text-[11px]`}
                >
                  <IconMapPin size={13} strokeWidth={1.9} />
                  {dropMode ? "Tap the map…" : "Drop a pin"}
                </button>
              )}
              {map && (
                <button
                  onClick={() =>
                    updateMap.mutate({
                      mapId: map.id,
                      body: {
                        name: map.name,
                        ...(map.parentMapId ? { parentMapId: map.parentMapId } : {}),
                        fogEnabled: !map.fogEnabled,
                      },
                    })
                  }
                  disabled={updateMap.isPending}
                  title={
                    map.fogEnabled
                      ? "Fog is on — players see only what you have revealed"
                      : "Fog is off — players see the whole map"
                  }
                  className="btn-base btn-ghost-gold px-4 py-2.5 text-[11px]"
                  style={map.fogEnabled ? { color: "#9a86b8" } : undefined}
                >
                  {map.fogEnabled ? (
                    <IconEyeOff size={13} strokeWidth={1.9} />
                  ) : (
                    <IconEye size={13} strokeWidth={1.9} />
                  )}
                  {map.fogEnabled ? "Fog: on" : "Fog: off"}
                </button>
              )}
              {map?.fogEnabled && (
                <>
                  <button
                    onClick={() => {
                      setStampMode((s) => !s);
                      setDropMode(false);
                    }}
                    className={`btn-base ${stampMode ? "btn-wax" : "btn-ghost-gold"} px-4 py-2.5 text-[11px]`}
                  >
                    <IconEye size={13} strokeWidth={1.9} />
                    {stampMode ? "Stamping…" : "Lift the fog"}
                  </button>
                  <button
                    onClick={() => setLedgerOpen(true)}
                    className="btn-base btn-ghost-gold px-4 py-2.5 text-[11px]"
                  >
                    Ledger
                  </button>
                </>
              )}
              {map && (
                <button
                  onClick={() => {
                    // Mid-run this is the way out; otherwise it opens the
                    // inkwork, which asks road-or-region and lists what is
                    // already drawn (#277). One button either way — the
                    // toolbar wrapping is what pushed the map off the fold
                    // when #262 tried two.
                    if (drawKind) {
                      stopDrawing();
                      return;
                    }
                    setDropMode(false);
                    setStampMode(false);
                    setInkworkOpen(true);
                  }}
                  className={`btn-base ${drawKind ? "btn-wax" : "btn-ghost-gold"} px-3 py-2.5 text-[11px]`}
                >
                  <IconPencil size={13} strokeWidth={1.9} />
                  {drawKind ? "Drawing…" : "Draw"}
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
              : "— no map has been unrolled for you yet; the ones you are shown hang here. —"}
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          data-testid="map-viewport"
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
            cursor: dropMode || stampMode ? "crosshair" : "grab",
          }}
        >
          {/* First-glance answer to "is the map broken?" — black ground is
              fog, not a failed image (#250). */}
          {map.fogEnabled && !isDM && (
            <div
              className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[3px] px-3 py-1.5"
              style={{
                background: "rgba(13,8,3,.78)",
                boxShadow: "inset 0 0 0 1px rgba(201,162,39,.25)",
              }}
            >
              <span className="font-accent text-[12.5px] italic text-[#9c855e]">
                The dark ground is fog of war — it lifts as the party discovers it.
              </span>
            </div>
          )}
          <div
            data-testid="map-canvas"
            style={{
              position: "absolute",
              width: map.width,
              height: map.height,
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <img
              src={`/api/maps/${map.id}/image?campaignId=${campaign.id}&v=${
                map.fogEnabled && !isDM ? revealSig(detail?.revealed ?? []) : "full"
              }`}
              alt={map.name}
              draggable={false}
              className="block h-full w-full"
              style={{ imageRendering: view.scale > fitScale.current * 4 ? "pixelated" : "auto" }}
            />
            {/* Players receive a server-fogged image, so only the DM draws the
                translucent overlay (and the live draft while stamping). */}
            {map.fogEnabled && isDM && (
              <FogCanvas
                map={map}
                revealed={detail?.revealed ?? []}
                draft={draft}
                isDM={isDM}
              />
            )}
            {/* Under the pins, over the map: a road should not cover a
                marker standing on it. */}
            <ShapeLayer
              shapes={detail?.shapes ?? []}
              draft={drawKind ? drawPoints : undefined}
              drawingArea={drawKind === "area"}
              width={map.width}
              height={map.height}
              onOpen={
                isDM && !drawKind
                  ? (shape: MapShape) =>
                      setShapeDraft({ kind: shape.kind, points: shape.points, existing: shape })
                  : undefined
              }
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

          {drawKind && (
            <div
              className="absolute left-1/2 top-3 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[3px] px-3.5 py-2"
              style={{ background: "rgba(16,9,5,.88)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.4)" }}
            >
              <span className="flex items-center gap-1">
                {(["line", "area"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setDrawKind(k)}
                    className={`label-stamp cursor-pointer rounded-[2px] border-none px-2 py-1 text-[9px] font-semibold tracking-[1px] transition ${
                      drawKind === k ? "text-[#f0dfb8]" : "text-gold-muted hover:text-ember-bright"
                    }`}
                    style={{ background: drawKind === k ? "rgba(201,162,39,.22)" : "transparent" }}
                  >
                    {k === "line" ? "Road" : "Region"}
                  </button>
                ))}
              </span>
              <span className="label-stamp text-[10px] tracking-[1.5px] text-[#f0dfb8]">
                {drawPoints.length === 0
                  ? drawKind === "area"
                    ? "Tap the corners"
                    : "Tap along the road"
                  : `${drawPoints.length} ${drawPoints.length === 1 ? "point" : "points"}`}
              </span>
              {drawPoints.length > 0 && (
                <button
                  onClick={() => setDrawPoints((pts) => pts.slice(0, -1))}
                  className="label-stamp cursor-pointer border-none bg-transparent text-[10px] font-semibold tracking-[1px] text-gold-muted transition hover:text-ember-bright"
                >
                  Undo
                </button>
              )}
              <button
                disabled={!drawEnough}
                onClick={() => {
                  setShapeDraft({ kind: drawKind, points: drawPoints });
                  stopDrawing();
                }}
                className="btn-base btn-gold h-7 px-3 py-0 text-[10px] disabled:opacity-40"
              >
                Finish
              </button>
              <button
                onClick={stopDrawing}
                className="label-stamp cursor-pointer border-none bg-transparent text-[10px] font-semibold tracking-[1px] text-gold-muted transition hover:text-ember-bright"
              >
                Cancel
              </button>
            </div>
          )}

          {/* the stamping bar: draft controls, nothing committed until Submit */}
          {stampMode && (
            <div
              className="absolute left-1/2 top-3 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[3px] px-3.5 py-2"
              style={{ background: "rgba(16,9,5,.88)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.4)" }}
            >
              <span className="label-stamp text-[10px] tracking-[1.5px] text-[#f0dfb8]">
                {draft.length === 0
                  ? "Tap to stamp a reveal"
                  : `${draft.length} stamped`}
              </span>
              <span className="flex items-center gap-1">
                <button
                  // The floor used to be 0.015, which reads as 3 on the dial —
                  // too coarse to lift a single room or a stretch of street
                  // (#262). The server has always accepted anything above 0.
                  onClick={() => setBrush((b) => Math.max(0.005, b / 1.35))}
                  title="Smaller brush"
                  className="font-heading h-6 w-6 cursor-pointer rounded-[2px] border-none text-[13px] font-bold text-[#e0c890]"
                  style={{ background: "rgba(255,255,255,.06)" }}
                >
                  −
                </button>
                <span className="label-stamp w-14 text-center text-[9px] tracking-[1px] text-gold-muted">
                  brush {Math.round(brush * 200)}
                </span>
                <button
                  onClick={() => setBrush((b) => Math.min(0.35, b * 1.35))}
                  title="Bigger brush"
                  className="font-heading h-6 w-6 cursor-pointer rounded-[2px] border-none text-[13px] font-bold text-[#e0c890]"
                  style={{ background: "rgba(255,255,255,.06)" }}
                >
                  +
                </button>
              </span>
              {draft.length > 0 && (
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => setDraft((d) => d.slice(0, -1))}
                    className="label-stamp cursor-pointer border-none bg-transparent text-[10px] font-semibold tracking-[1px] text-gold-muted transition hover:text-ember-bright"
                  >
                    Undo
                  </button>
                  <button
                    onClick={() => setDraft([])}
                    className="label-stamp cursor-pointer border-none bg-transparent text-[10px] font-semibold tracking-[1px] text-gold-muted transition hover:text-ember-bright"
                  >
                    Discard
                  </button>
                  <button
                    onClick={() => {
                      // A map that depicts a place suggests that place for
                      // its reveals (#229) — the DM can still clear it.
                      if (!submitLocationId && map.locationId) {
                        setSubmitLocationId(map.locationId);
                      }
                      setSubmitOpen(true);
                    }}
                    className="btn-base btn-gold clip-octagon h-8 px-3.5 text-[11px]"
                  >
                    Submit
                  </button>
                </span>
              )}
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
            initial={{ label: "", note: "", dmOnly: false, linkMapId: "", shape: "pin" }}
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
                  shape: v.shape,
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
              shape: editingPin.shape ?? "pin",
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
                    shape: v.shape,
                    ...(v.linkMapId ? { linkMapId: v.linkMapId } : {}),
                  },
                },
                { onSuccess: () => setEditingPin(null) },
              )
            }
          />
        </ParchmentModal>
      )}

      {/* naming and styling a road or a region (#262) */}
      {shapeDraft && (
        <ParchmentModal onClose={() => setShapeDraft(null)} maxWidth="max-w-[460px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            {shapeDraft.kind === "area" ? "A region" : "A road"}
          </div>
          <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
            {shapeDraft.existing ? "Redraw it" : "Ink it in"}
          </h3>
          <ShapeForm
            draft={shapeDraft}
            locations={locations ?? []}
            isPending={createShape.isPending || updateShape.isPending}
            errorText={
              ((createShape.error ?? updateShape.error) as { error?: string } | null)?.error
            }
            onSubmit={(body) => {
              const done = { onSuccess: () => setShapeDraft(null) };
              if (shapeDraft.existing) {
                updateShape.mutate({ shapeId: shapeDraft.existing.id, body }, done);
              } else {
                createShape.mutate(body, done);
              }
            }}
            onDelete={
              shapeDraft.existing
                ? () =>
                    deleteShape.mutate(shapeDraft.existing!.id, {
                      onSuccess: () => setShapeDraft(null),
                    })
                : undefined
            }
            onCancel={() => setShapeDraft(null)}
          />
        </ParchmentModal>
      )}

      {/* everything drawn on this map, and where a new run starts (#277) */}
      {inkworkOpen && map && (
        <InkworkModal
          shapes={detail?.shapes ?? []}
          isPending={deleteShape.isPending}
          onEdit={(shape) => {
            setInkworkOpen(false);
            setShapeDraft({ kind: shape.kind, points: shape.points, existing: shape });
          }}
          onDraw={(kind) => {
            setInkworkOpen(false);
            setDrawKind(kind);
            setDrawPoints([]);
          }}
          onDelete={(id) => deleteShape.mutate(id)}
          onClose={() => setInkworkOpen(false)}
        />
      )}

      {/* submit-reveals modal */}
      {submitOpen && map && (
        <ParchmentModal onClose={() => setSubmitOpen(false)} maxWidth="max-w-[420px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            {map.name}
          </div>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
            Lift the Fog
          </h3>
          <p className="font-body m-0 mb-4 text-center text-[13.5px] italic text-ink-body">
            {draft.length} {draft.length === 1 ? "circle" : "circles"}
            {submitLocationId
              ? " will be revealed to whoever knows that place — and to nobody else."
              : submitPartyId
                ? " will be revealed to the heroes riding with that party right now — and stay theirs wherever they ride next."
                : " will be revealed to the whole table. This is what they'll see from now on."}
          </p>
          <label className="block">
            <span className="field-label">A line for the ledger (optional)</span>
            <input
              value={submitNote}
              onChange={(e) => setSubmitNote(e.target.value)}
              placeholder="session 12 — the road east"
              className="input-parchment mt-1 w-full"
            />
          </label>
          {parties.length > 0 && (
            <label className="mt-3 block">
              <span className="field-label">Stamped for (optional)</span>
              <select
                value={submitPartyId}
                onChange={(e) => setSubmitPartyId(e.target.value)}
                className="input-parchment mt-1 w-full cursor-pointer"
              >
                <option value="">— the whole table —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.heroCount})
                  </option>
                ))}
              </select>
              <span className="font-body mt-1 block text-[12px] italic text-ink-body">
                The ground goes to the heroes riding with them at this moment,
                and belongs to those heroes from then on — moving between
                parties never takes it away, and joining one never hands it over.
              </span>
            </label>
          )}
          {(locations ?? []).length > 0 && (
            <label className="mt-3 block">
              <span className="field-label">Knowledge of a place (optional)</span>
              <select
                value={submitLocationId}
                onChange={(e) => setSubmitLocationId(e.target.value)}
                className="input-parchment mt-1 w-full cursor-pointer"
              >
                <option value="">— no place gates it —</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {"— ".repeat(l.depth)}
                    {l.name}
                  </option>
                ))}
              </select>
              <span className="font-body mt-1 block text-[12px] italic text-ink-body">
                Tie it to a place and this ground follows that place's veil: it
                lifts for the hero who grew up there, and for everyone once you
                show the place to the party.
              </span>
            </label>
          )}
          {submitReveals.isError && (
            <div className="font-body mt-2 text-sm italic text-[#8b2520]">
              {apiError(submitReveals.error)}
            </div>
          )}
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              onClick={() => setSubmitOpen(false)}
              className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
            >
              Not yet
            </button>
            <button
              onClick={() =>
                submitReveals.mutate(
                  {
                    circles: draft,
                    ...(submitNote.trim() ? { note: submitNote.trim() } : {}),
                    ...(submitLocationId ? { locationId: submitLocationId } : {}),
                    ...(submitPartyId ? { partyId: submitPartyId } : {}),
                  },
                  {
                    onSuccess: () => {
                      setDraft([]);
                      setSubmitNote("");
                      setSubmitLocationId("");
                      setSubmitPartyId("");
                      setSubmitOpen(false);
                      setStampMode(false);
                    },
                  },
                )
              }
              disabled={submitReveals.isPending}
              className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px]"
            >
              {submitReveals.isPending ? "Lifting…" : "Reveal it"}
            </button>
          </div>
        </ParchmentModal>
      )}

      {/* reveal ledger */}
      {ledgerOpen && map && (
        <RevealLedger
          campaignId={campaign.id}
          mapId={map.id}
          mapName={map.name}
          locations={locations ?? []}
          onDelete={(id) => deleteReveals.mutate(id)}
          deleting={deleteReveals.isPending}
          onRetie={(batchId, locationId) =>
            setRevealLocation.mutate({ batchId, locationId })
          }
          retying={setRevealLocation.isPending}
          onClose={() => setLedgerOpen(false)}
        />
      )}

      {atlasOpen && (
        <AtlasModal
          campaignId={campaign.id}
          maps={maps ?? []}
          currentId={currentId}
          isDM={isDM}
          onOpen={(id) => {
            setAtlasOpen(false);
            goTo(id);
          }}
          onHang={() => {
            setAtlasOpen(false);
            setHanging(true);
          }}
          onStruck={(id) => {
            // Striking the map on the table sends the viewer back to the
            // overworld; striking any other row leaves the table alone.
            if (id === currentId) navigate(`/questboard/campaigns/${campaign.id}/map`);
          }}
          onClose={() => setAtlasOpen(false)}
        />
      )}

      {hanging && (
        <HangMapForm
          campaignId={campaign.id}
          maps={maps}
          onClose={() => setHanging(false)}
          onHung={goTo}
        />
      )}
    </div>
  );
}
