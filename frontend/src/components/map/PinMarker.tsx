import type { MapPin, PinShape } from "../../api/client";
import { IconEyeOff, IconMapPin } from "../ui/icons";

/*
The markers a pin may wear (#262).

A teardrop is the right shape for "a thing is here" and the wrong one for
everything else — a capital, a ruin, a battle, a border post all want to be
told apart at a glance on a crowded map. These are drawn rather than pulled
from the icon set because they are map furniture, not UI: they want to be flat,
solid, and legible at a quarter of an inch, which the stroked interface icons
are not.

Every one is drawn in a 24×24 box around a centre at (12,12), so the label sits
the same distance below whichever is chosen. The teardrop is the exception and
stays the icon it always was — it points at its spot from above, which is why
the whole marker hangs by its tip.
*/

const GEOMETRY: Record<Exclude<PinShape, "pin">, string> = {
  circle: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
  square: "M4.5 4.5h15v15h-15z",
  diamond: "M12 2.5 21.5 12 12 21.5 2.5 12z",
  triangle: "M12 3 21 20H3z",
  star: "M12 2.5l2.7 6.2 6.8.6-5.1 4.4 1.5 6.6L12 16.8 6.1 20.3l1.5-6.6L2.5 9.3l6.8-.6z",
  cross: "M9.5 2.5h5v7h7v5h-7v7h-5v-7h-7v-5h7z",
  // A skull for a lair or a graveyard: a dome, two sockets, a jaw.
  skull:
    "M12 2.5c-4.7 0-7.5 3-7.5 7 0 2.4 1 4 2.3 5v2.2c0 .9.7 1.6 1.6 1.6h7.2c.9 0 1.6-.7 1.6-1.6V14.5c1.3-1 2.3-2.6 2.3-5 0-4-2.8-7-7.5-7zM9 9.6a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm6 0a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z",
};

function Marker({ shape, size, color }: { shape: PinShape; size: number; color: string }) {
  if (shape === "pin") return <IconMapPin size={size} strokeWidth={2} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={GEOMETRY[shape]}
        fill={color}
        stroke="rgba(16,9,5,.65)"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* One pin marker on the canvas, counter-scaled to stay a constant size.
 * Clicks are its own affair — the canvas never captures a press that starts
 * on a pin, so the native click survives. */
export function PinMarker({
  pin,
  scale,
  onOpen,
}: {
  pin: MapPin;
  scale: number;
  onOpen: (pin: MapPin) => void;
}) {
  const region = !!pin.linkMapId;
  const shape: PinShape = pin.shape ?? "pin";
  const color = region ? "#e0a94e" : "#c96a5a";
  // The teardrop hangs by its tip; everything else is centred on its spot,
  // because a circle has no point to stand on.
  const anchor = shape === "pin" ? "translate(-50%, -100%)" : "translate(-50%, -50%)";
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
        transform: `${anchor} scale(${1 / scale})`,
        transformOrigin: shape === "pin" ? "50% 100%" : "50% 50%",
        opacity: pin.dmOnly ? 0.65 : 1,
      }}
    >
      <div className="flex flex-col items-center">
        <span
          className="relative"
          style={{ color, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.6))" }}
        >
          <Marker shape={shape} size={region ? 30 : 24} color={color} />
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

/** The markers a DM may choose between, in the order the picker shows them. */
export const PIN_SHAPES: PinShape[] = [
  "pin",
  "circle",
  "square",
  "diamond",
  "triangle",
  "star",
  "cross",
  "skull",
];

/** One marker at picker size, for the form's row of choices. */
export function MarkerSwatch({ shape }: { shape: PinShape }) {
  return <Marker shape={shape} size={18} color="#5a3d22" />;
}
