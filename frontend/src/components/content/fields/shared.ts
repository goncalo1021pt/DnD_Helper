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
  /** Read a key as a string array, whatever is actually stored there. */
  strArr: (key: string) => string[];
  /** Every class the caller can see, for the pickers that name one. */
  classNames: string[];
}
