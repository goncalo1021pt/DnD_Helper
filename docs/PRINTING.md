# Printing a hero onto the 2024 character sheet

The hero sheet page has a **Print** button. Press it and your hero comes out on
the official 2024 D&D character sheet, ready for the table.

That is the whole feature. There is nothing to choose, nothing to upload and
nothing to align — the sheet ships with the app, and the coordinates were
measured off it.

## How it works

The character sheet Wizards publishes for free download is bundled at
`frontend/src/assets/dnd-2024-character-sheet.pdf`. Pressing Print fetches it,
copies both of its pages, draws your hero over them with `pdf-lib`, and hands
the result to the browser's print dialog. Where a browser will not print a PDF
in a frame, the file downloads instead.

All of it happens in the browser. The hero is already loaded in the page, and
the sheet is a static asset, so **nothing is posted anywhere** — printing never
touches the server. There is no endpoint for it, which is why this one feature
sits outside the repo's contract-first pattern.

The sheet and `pdf-lib` are fetched only when the button is pressed, keeping
about two megabytes off the page load for everyone who never prints.

## What lands where

**Page 1.** Name, background, class, species, subclass, level and XP. The six
abilities, each with its modifier in the ring and its score in the tab. Saving
throws and all eighteen skills, filed under the ability that governs them, with
the proficiency circles ticked. Armor class — and the shield diamond, when you
have one equipped. Initiative, speed, size, proficiency bonus and passive
Perception. Current and maximum hit points, and your hit dice. Equipped weapons
across the Weapons & Damage Cantrips table, with damage cantrips filling the
rows below them. Class and subclass features to your level, split down the
panel's two columns the way the sheet rules it. Species traits and feats. Armor
training diamonds, weapon proficiencies and tools.

**Page 2.** Spellcasting ability, modifier, save DC and attack bonus; the slot
totals for every level you have them. Then the Cantrips & Prepared Spells table,
thirty rows of it: each spell's level, name, casting time and range, its
Concentration and Ritual diamonds ticked from the rules text, and its school in
the notes. Your equipment and your gold.

Boxes the app does not model — temporary hit points, hit dice spent, death
saves, appearance, backstory, languages, magic-item attunement, and the coins
that are not gold — are left empty for you to fill in at the table, which is
where they belong.

## For contributors

The exporter lives in `frontend/src/lib/sheet/`:

| file | what it holds |
| --- | --- |
| `print.ts` | the button's whole job: build the PDF, open the print dialog |
| `fields.ts` | the shape of the sheet — abilities, the skills under each, row counts |
| `values.ts` | pure: a hero and the rules it points at in, a value per field id out |
| `layout2024.ts` | where each box sits, in points from the top-left of the sheet's 603 x 774 page |
| `render.ts` | the pdf-lib pass: the sheet's pages, with our ink over them |
| `text.ts` | folding our copy down to what the standard PDF fonts can draw |

Adding a box means adding it to `layout2024.ts` (so it has a position) and
`values.ts` (so it has a value). The ids are the only thing the two share.

`pdf-lib` and the sheet are reached only through `import()` and `fetch()` inside
`print.ts`, which keeps them out of the main bundle. Keep it that way: never
import `render.ts` eagerly.

### Re-measuring the layout

The coordinates are measurements, not guesses, and they were taken by scanning
a render of the sheet rather than by eye:

- The **write-on rules** are light grey — around 200–230 on a 254 background —
  one or two points thick, with clean space above and below. Scanning for runs
  that match that description finds them all and nothing else.
- The **proficiency circles** are small dark rings at a fixed x. There are
  exactly twenty-four: six saving throws and eighteen skills.
- The **panels** were measured against a coordinate grid rendered over the page.

If a future printing of the sheet moves things, re-measure the same way. It is
faster than nudging, and it does not drift.
