/**
 * Decorative drifting embers rising from the bottom of the page.
 * Deterministic per-index placement (no randomness, stable across renders).
 */
export default function Embers({ count = 9 }: { count?: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => {
        const left = (i * 12 + 5) % 100;
        const size = 3 + (i % 3);
        const dur = 7 + (i % 5);
        const delay = (i * 1.1) % 7;
        return (
          <span
            key={i}
            className="anim-spark absolute rounded-full"
            style={{
              bottom: -12,
              left: `${left}%`,
              width: size,
              height: size,
              background: "radial-gradient(circle,#ffd27a,#d9701f)",
              boxShadow: "0 0 9px rgba(245,150,60,.8)",
              animation: `spark ${dur}s linear ${delay}s infinite`,
            }}
          />
        );
      })}
    </div>
  );
}
