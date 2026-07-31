/*
The encounter page's palette and one stubborn default.

Split out of EncounterPage (#108) because every row, tracker and browser reaches
for these, and a constant shared by nine files should not live inside one of them.
*/

export const HP_STATE_TONE: Record<string, string> = {
  healthy: "#7ea63f",
  bloodied: "#c99a3f",
  down: "#8b2520",
};

// The damage box always falls back to 1 rather than emptying. A DM chipping a
// creature down clicks − repeatedly; resetting to blank disabled the button and
// forced a retype between every single point.
export const HP_STEP = "1";

// Button intents on the DARK encounter page. The design system's btn-ghost-*
// classes are for parchment (dark ink text) — on dark they look disabled, so we
// set explicit light-on-dark styles. The scheme, applied consistently:
//   gold  = confirm/create (Prepare, Add, Trigger)
//   wax   = the live-combat verbs (Roll, Next turn)
//   NEUTRAL = secondary (Prev, back)   RED = destructive   GREEN = heal
export const NEUTRAL_BTN = { color: "#e6d2a0", background: "rgba(201,162,39,.08)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.32)" };
export const RED_BTN = { color: "#d68a72", background: "rgba(139,37,32,.14)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" };
export const GREEN_BTN = { color: "#8fb15f", background: "rgba(77,107,57,.14)", boxShadow: "inset 0 0 0 1px rgba(77,107,57,.5)" };
