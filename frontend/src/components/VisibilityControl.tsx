import type { Character, SetVisibilityInput, VisibilityOverride } from "../api/client";
import { IconEye, IconEyeOff, IconUsers } from "./ui/icons";

/* What the DM is looking at for one hero: taking the party's setting, or
   singled out. "default" means no override row exists — the hero simply sees
   what the party sees, and picking it again clears the exception.

   The three buttons are not three visibilities. Two of them are exceptions and
   the first is the absence of one, which is why only one of them ever changes
   anything: with the party revealed, Hide is the live one; with the party
   veiled, Show is. */
type HeroState = "default" | "shown" | "hidden";

function heroState(overrides: VisibilityOverride[], characterId: string): HeroState {
  const o = overrides.find((v) => v.characterId === characterId);
  if (!o) return "default";
  return o.visible ? "shown" : "hidden";
}

/* Reveal / veil an entity for the whole party or for a single hero.
   Shared by the place tree and the quest notices — the rules are identical,
   only the thing being veiled changes. */
export default function VisibilityControl({
  visibleToParty,
  overrides,
  characters,
  isPending,
  onChange,
  onClearHero,
}: {
  visibleToParty: boolean;
  overrides: VisibilityOverride[];
  characters: Character[];
  isPending: boolean;
  onChange: (body: SetVisibilityInput) => void;
  onClearHero: (characterId: string) => void;
}) {
  const singledOut = overrides.length;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="field-label flex items-center gap-1.5">
          <IconUsers size={13} />
          The party
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => onChange({ scope: "party", visible: !visibleToParty })}
          className={`btn-base clip-octagon px-3 py-[7px] text-[11px] ${
            visibleToParty ? "btn-wax" : "btn-ghost-ink"
          }`}
        >
          {visibleToParty ? <IconEye size={13} /> : <IconEyeOff size={13} />}
          {visibleToParty ? "Revealed to all" : "Veiled from all"}
        </button>
        {singledOut > 0 && (
          <span className="font-body text-[11px] italic text-ink-faded">
            {singledOut} hero{singledOut === 1 ? "" : "es"} singled out
          </span>
        )}
      </div>

      {characters.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="field-label">Or hero by hero</span>
          {characters.map((c) => {
            const state = heroState(overrides, c.id);
            return (
              <div key={c.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-[12.5px] font-medium text-ink-value">
                  {c.name}
                </span>
                {/* "Follow party" read as a cousin of "travels with the
                    party" (#228) — two unrelated ideas wearing one word. This
                    button is about *inheritance*: no exception on file, so the
                    hero simply does whatever the switch above says. */}
                {(
                  [
                    ["default", "As the party", "No exception — this hero does whatever the switch above says."],
                    ["shown", "Show", "An exception: this hero sees them even when the party does not."],
                    ["hidden", "Hide", "An exception: this hero does not see them even when the party does."],
                  ] as const
                ).map(([value, label, why]) => (
                  <button
                    key={value}
                    type="button"
                    title={why}
                    disabled={isPending}
                    onClick={() =>
                      value === "default"
                        ? onClearHero(c.id)
                        : onChange({
                            scope: "character",
                            characterId: c.id,
                            visible: value === "shown",
                          })
                    }
                    className={`btn-base px-2 py-1 text-[10px] ${
                      state === value ? "btn-wax" : "btn-ghost-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
