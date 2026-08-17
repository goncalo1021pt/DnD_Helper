import { useMemo, type ReactNode } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import type { Location } from "../api/client";
import {
  useEncounters,
  useLocations,
  useMaps,
  useNpcs,
  useQuests,
  useVendors,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import {
  IconCoins,
  IconEyeOff,
  IconMapPin,
  IconScroll,
  IconSwords,
  IconUsers,
} from "./ui/icons";

/*
 * One place, and everything that hangs in it (#230).
 *
 * Published adventures are organised this way and always have been: the place
 * chapter lists who lives there, what is sold there, what is happening there,
 * and the map. The tree already WAS that join — four features file by
 * `location_id` — and a row that advertised two of them was underselling it.
 *
 * There is no endpoint behind this page, and that is deliberate. Every domain
 * list is already veil-filtered on the way out (a player is not sent a person
 * they may not know, a shop that is not revealed, a notice that is dark), so
 * assembling the page from those payloads means it can never show a player
 * something the server withheld. The page and the counts on the World rows
 * read the same data and therefore cannot disagree.
 */

/* A section of the chapter. Renders nothing at all when the DM has filed
   nothing here AND there is no player-facing promise worth making. */
function Chapter({
  icon,
  title,
  door,
  doorLabel,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  door?: string;
  doorLabel?: string;
  empty: string;
  children: ReactNode[];
}) {
  return (
    <section className="mt-6">
      <div
        className="mb-2.5 flex flex-wrap items-center justify-between gap-3 pb-2"
        style={{ borderBottom: "1px solid rgba(201,162,39,.2)" }}
      >
        <h3 className="font-display m-0 flex items-center gap-2 text-[17px] font-black text-[#e7d3a6]">
          <span className="text-gold-muted">{icon}</span>
          {title}
        </h3>
        {door && children.length > 0 && (
          <Link
            to={door}
            className="label-stamp text-[9.5px] tracking-[1.5px] text-gold-muted no-underline transition hover:text-ember-bright"
          >
            {doorLabel} →
          </Link>
        )}
      </div>
      {children.length === 0 ? (
        <p className="font-accent m-0 py-2 text-[13.5px] italic text-[#9c855e]">{empty}</p>
      ) : (
        <div className="flex flex-col gap-1.5">{children}</div>
      )}
    </section>
  );
}

/* One line in a chapter: a name, a whisper of detail, and somewhere to go. */
function Entry({
  to,
  name,
  detail,
  stamp,
}: {
  to?: string;
  name: string;
  detail?: string | null;
  stamp?: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-[14px] font-semibold text-ink">
          {name}
        </span>
        {detail && (
          <span className="font-body block truncate text-[12.5px] italic text-ink-body">
            {detail}
          </span>
        )}
      </span>
      {stamp && (
        <span className="label-stamp flex-none text-[9px] tracking-[1.5px] text-ink-label">
          {stamp}
        </span>
      )}
    </>
  );
  const cls = "parchment flex items-center gap-3 px-4 py-2.5 no-underline";
  return to ? (
    <Link to={to} className={`${cls} transition hover:brightness-[1.04]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default function PlacePage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const { placeId = "" } = useParams();
  const isDM = role === "dm";
  const base = `/questboard/campaigns/${campaign.id}`;

  const { data: locations, isLoading } = useLocations(campaign.id);
  const { data: npcs } = useNpcs(campaign.id);
  const { data: vendors } = useVendors(campaign.id);
  const { data: maps } = useMaps(campaign.id);
  const { data: quests } = useQuests(campaign.id);
  // The prepared-fights library is the DM's alone; players have no door to it.
  const { data: encounters } = useEncounters(campaign.id, isDM);

  const place = (locations ?? []).find((l) => l.id === placeId);

  /* The road here, for the breadcrumb. A place a player may not see is simply
     absent from `locations`, so the trail stops where their knowledge does. */
  const ancestors = useMemo(() => {
    const byId = new Map((locations ?? []).map((l) => [l.id, l]));
    const trail: Location[] = [];
    let cur = place?.parentId ? byId.get(place.parentId) : undefined;
    while (cur && trail.length < 10) {
      trail.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return trail;
  }, [locations, place]);

  if (isLoading) {
    return (
      <div className="panel-hall px-5 py-[60px] text-center sm:px-[30px]">
        <span className="font-accent text-base italic text-[#9c855e]">Unrolling the map…</span>
      </div>
    );
  }

  /* Veiled, struck, or never charted — all the same answer, because a player
     must not learn a place exists from the shape of a refusal. */
  if (!place) {
    return (
      <div className="panel-hall px-5 py-[60px] text-center sm:px-[30px]">
        <div className="font-display text-2xl text-[#cdb582]">No such place</div>
        <div className="font-accent mt-2 text-base italic text-[#9c855e]">
          — nothing of it is known here. —
        </div>
        <Link
          to={`${base}/world`}
          className="label-stamp mt-5 inline-block text-[10px] tracking-[2px] text-gold-muted no-underline hover:text-ember-bright"
        >
          ← The World
        </Link>
      </div>
    );
  }

  const children = (locations ?? []).filter((l) => l.parentId === place.id);
  const folk = (npcs ?? []).filter((n) => n.locationId === place.id);
  const shops = (vendors ?? []).filter((v) => v.locationId === place.id);
  const sheets = (maps ?? []).filter((m) => m.locationId === place.id);
  const notices = (quests ?? []).filter((q) => q.locationId === place.id);
  const battles = (encounters ?? []).filter((e) => e.locationId === place.id);

  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      {/* the road here */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Link
          to={`${base}/world`}
          className="label-stamp text-[9.5px] tracking-[1.5px] text-gold-muted no-underline hover:text-ember-bright"
        >
          The World
        </Link>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <span className="text-ink-faded">›</span>
            <Link
              to={`${base}/world/${a.id}`}
              className="label-stamp text-[9.5px] tracking-[1.5px] text-gold-muted no-underline hover:text-ember-bright"
            >
              {a.name}
            </Link>
          </span>
        ))}
      </div>

      <div
        className="mb-2 flex flex-wrap items-start justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="min-w-0">
          <h2
            className="font-display m-0 flex items-center gap-2.5 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            <span className="text-[#8a5e2c]">
              <IconMapPin size={22} />
            </span>
            {place.name}
          </h2>
          {place.description ? (
            <p className="font-body m-0 mt-2 max-w-[68ch] text-[14px] leading-relaxed text-cream-soft">
              {place.description}
            </p>
          ) : (
            <p className="font-accent m-0 mt-2 text-[13px] italic text-[#9c855e]">
              {isDM
                ? "Nothing is written of it yet — the pencil on the World page opens its page in the ledger."
                : "Nothing is written of it yet."}
            </p>
          )}
        </div>
        {isDM && (
          <span
            className="label-stamp flex flex-none items-center gap-1.5 text-[9.5px] tracking-[1.5px]"
            style={{ color: place.visibleToParty ? "#7fa06a" : "#a8734a" }}
            title={
              place.visibleToParty
                ? "The party knows this place"
                : "Veiled — the party does not know this place exists"
            }
          >
            {!place.visibleToParty && <IconEyeOff size={12} strokeWidth={1.8} />}
            {place.visibleToParty ? "Known to the party" : "Veiled"}
          </span>
        )}
      </div>

      <Chapter
        icon={<IconMapPin size={15} />}
        title="Inside"
        empty={isDM ? "Nothing is charted inside it." : "Nothing you know of lies inside it."}
      >
        {children.map((c) => (
          <Entry
            key={c.id}
            to={`${base}/world/${c.id}`}
            name={c.name}
            detail={c.description}
            stamp={isDM && !c.visibleToParty ? "veiled" : undefined}
          />
        ))}
      </Chapter>

      <Chapter
        icon={<IconUsers size={15} />}
        title="The Folk"
        door={`${base}/npcs`}
        doorLabel="All the folk"
        empty={
          isDM
            ? "Nobody is filed here yet — the Folk page files a person under a place."
            : "You have met nobody here yet."
        }
      >
        {folk.map((n) => (
          <Entry
            key={n.id}
            to={`${base}/npcs`}
            name={n.name}
            detail={n.description}
            stamp={isDM && !n.visibleToParty ? "veiled" : undefined}
          />
        ))}
      </Chapter>

      <Chapter
        icon={<IconCoins size={15} />}
        title="The Bazaar"
        door={`${base}/vendors`}
        doorLabel="All the shops"
        empty={
          isDM
            ? "No shop keeps a door here yet."
            : "You have found nothing for sale here."
        }
      >
        {shops.map((v) => (
          <Entry
            key={v.id}
            to={`${base}/vendors`}
            name={v.name}
            detail={v.description}
            // An empty shelf says nothing rather than announcing a zero — for
            // a player it may simply be stock they have not been shown.
            stamp={v.stock.length > 0 ? `${v.stock.length} on the shelf` : undefined}
          />
        ))}
      </Chapter>

      <Chapter
        icon={<IconScroll size={15} />}
        title="Notices"
        door={`${base}/board?place=${place.id}`}
        doorLabel="On the board"
        empty={
          isDM ? "No notice hangs here." : "No notice you can read hangs here."
        }
      >
        {notices.map((q) => (
          <Entry
            key={q.id}
            to={`${base}/board?place=${place.id}`}
            name={q.title}
            detail={q.description}
            stamp={q.status}
          />
        ))}
      </Chapter>

      <Chapter
        icon={<IconMapPin size={15} />}
        title="Maps"
        empty={
          isDM
            ? "No map depicts this place — hang one and file it here."
            : "No map of this place has been unrolled."
        }
      >
        {sheets.map((m) => (
          <Entry
            key={m.id}
            to={`${base}/map/${m.id}`}
            name={m.name}
            stamp={m.fogEnabled ? "fogged" : undefined}
          />
        ))}
      </Chapter>

      {isDM && (
        <Chapter
          icon={<IconSwords size={15} />}
          title="Battles"
          door={`${base}/encounters?place=${place.id}`}
          doorLabel="The library"
          empty="No fight is prepared for this place."
        >
          {battles.map((e) => (
            <Entry
              key={e.id}
              to={`${base}/encounters?place=${place.id}`}
              name={e.name}
              detail={e.tag}
              stamp={e.status === "active" ? "running" : undefined}
            />
          ))}
        </Chapter>
      )}
    </div>
  );
}
