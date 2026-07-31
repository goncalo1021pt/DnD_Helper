import type { MapPin } from "../../api/client";
import { IconEyeOff, IconMapPin } from "../ui/icons";

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
