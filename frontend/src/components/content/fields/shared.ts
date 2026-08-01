/*
What every kind's field set is handed.

GuidedFields was 485 lines of `if (kind === …) return (…)` — seven field sets
living in one function because they happened to share three helpers. These are
the three: a setter that writes one key, a reader that guarantees an array back,
and the input class the parchment forms use.
*/

export const input = "input-parchment input-compact";

export type DataObj = Record<string, unknown>;

export interface FieldProps {
  data: DataObj;
  /** Write one key of the entry's `data`, leaving the rest alone. */
  set: (key: string, value: unknown) => void;
  /**
   * Write several keys at once.
   *
   * Not sugar: two `set` calls in one handler both spread the same `data` from
   * the render that made them, so the second silently discards the first. That
   * bites wherever one field derives another — a monster's written CR and the
   * numeric crValue the Den sorts on have to move together, and with two calls
   * only the second survives.
   */
  patch: (values: DataObj) => void;
  /** Read a key as a string array, whatever is actually stored there. */
  strArr: (key: string) => string[];
  /** Every class the caller can see, for the pickers that name one. */
  classNames: string[];
}
