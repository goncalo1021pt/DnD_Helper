import { initials, medallionFor } from "../../lib/party";

/* Small round face for a member: their avatar, or inked initials on a medallion. */
export default function Face({ name, image, id }: { name: string; image?: string | null; id: string }) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className="h-10 w-10 flex-none rounded-full object-cover"
        style={{ border: "1px solid rgba(201,162,39,.4)" }}
      />
    );
  }
  return (
    <div
      className="font-heading flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold text-cream"
      style={{ background: medallionFor(id), border: "1px solid rgba(201,162,39,.4)" }}
    >
      {initials(name)}
    </div>
  );
}
