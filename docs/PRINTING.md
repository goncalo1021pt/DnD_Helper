# Printing a hero onto the 2024 character sheet

The hero sheet page has a printer button. It turns a forged hero into a PDF you
can put on paper — laid onto **the official 2024 D&D character sheet**, which
you supply.

## Why you supply the sheet

Quest Board ships no copy of Wizards' character sheet, and never will: the sheet
is their artwork, not ours to redistribute. What the exporter ships is a *map* —
where a name goes, where the Dexterity modifier goes, where the third spell slot
row goes — and the ink to fill it.

That also settles the privacy question. The whole export runs in your browser:
the PDF you hand over is read by the tab and nothing else, and neither it nor
the hero is posted anywhere. Nothing about printing touches the server.

Get the sheet from D&D Beyond's free downloads, or use any sheet you like —
homebrew, a scan, a translation. The exporter does not care whose it is.

## The three ways out

Pick the one that matches the file you have.

### Print over my sheet — the usual path

You have the sheet as Wizards ships it. Hand over the PDF (or page images) and
the exporter lays it down as a backdrop and writes on top, giving you a single
file to print.

The sheet you pick is **kept in this browser**, so you choose the file once and
every hero you print afterwards finds it already there. *Forget this sheet*
clears it. It is stored locally and never uploaded.

Page images, rather than the PDF, additionally unlock the drag-to-align tool
described below.

### Ink only — for paper you have already printed

No backdrop at all: just the writing, on blank pages. Print the official sheet
first, put it back in the paper tray, and run the ink over it.

Pages you leave unticked still come out **blank rather than skipped**, so the
stack stays in step with the sheet.

### Fill my sheet — for a fillable copy

Note that the sheet Wizards publishes for download is *flat*: it has no form
fields, and this mode will tell you so and send you back to the one above. This
path is for a genuinely fillable PDF — a homebrew sheet, a translation, or a
fillable edition — where the exporter can write into the sheet's own form fields
and flatten the result.

The only guesswork is *which* box is which. The exporter matches its field names
against the sheet's — "Strength Save" against `ST Strength`, "Attack 1 Damage"
against `Wpn1 Damage` — and gets the great majority right on the first pass.
Press **Check the matching** to see every pairing and re-point anything wrong.

Corrections are saved against a fingerprint of that sheet's field names, so you
fix a sheet once and every hero you print on it afterwards inherits the fix.

## Getting the alignment right

The coordinates that ship with Quest Board are **measured off the official
sheet**, not guessed: the ruled write-on lines and the proficiency circles were
found by scanning the page, and the panels were measured against a coordinate
grid laid over it. On the sheet as Wizards ships it, the ink should land right
without you touching anything.

What no map can predict is your printer. Most shift the page a little and some
shrink it, and that shows up the moment you print onto pre-printed paper. The
tools below are for that, and everything they save stays in your browser.

**The aligner.** In *Print over my sheet*, give the exporter page images (rather
than the PDF) and an **Align page** button appears. It lays the boxes over your sheet at true
proportion, with your hero's actual values inside them, and you drag them into
place: pull a corner to resize, or select a box and walk it with the arrow keys
(hold shift for five points a step). Filter by section so you are looking at six
boxes instead of a hundred.

**The nudge.** Alignment that is right on screen and wrong on paper is the
printer, not the map: most printers shift the whole page a little and some shrink
it. *Nudge across*, *nudge down* and *scale* move everything at once. Tick
**Show alignment guides** to print a page with every box outlined and named — one
of those next to your real sheet tells you exactly which way to nudge.

**Ink and hand.** The ink colour defaults to a dark blue that reads as writing
rather than as print. Black is there if you want the typed look.

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
| `fields.ts` | the field catalogue — every box, named once, with the aliases the matcher uses |
| `values.ts` | pure: a hero and the rules it points at, in, a value per field id, out |
| `layout2024.ts` | where each box sits, in points from the top-left of the sheet's 603 x 774 page |
| `render.ts` | the pdf-lib pass: ink, backdrops, calibration, guides |
| `acroform.ts` | reading, auto-matching and filling a fillable PDF |
| `prefs.ts` | what the browser remembers: calibration, box nudges, field maps |
| `store.ts` | the sheet file itself, kept in IndexedDB so it is picked once |

Adding a box means adding it to `fields.ts` (so the matcher and the UI see it),
`layout2024.ts` (so it has a position) and `values.ts` (so it has a value).

`pdf-lib` is loaded only when the dialog builds something — `render.ts` and
`acroform.ts` are reached through `import()`, which keeps ~430 kB out of the
main bundle. Keep it that way: never import either module eagerly.

The layout was measured by scanning a render of the sheet: light grey rules
(values around 200-230 on a 254 background, one or two points thick with clean
space above and below) are the write-on lines, and the small dark rings at a
fixed x are the proficiency circles. If a future printing of the sheet moves
things, that is the way to re-measure it rather than nudging by eye.

If you tune the layout further and get it dead on, that alignment is worth
sharing. The saved overrides live under `questboard.sheet-export.v1` in
`localStorage`; folding them into the defaults in `layout2024.ts` improves the
first run for everyone.
