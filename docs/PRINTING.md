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

### Fill my sheet — best results

You have the **fillable** PDF (the one with typable boxes). Hand it over and the
exporter writes into the sheet's own form fields, then flattens the result so it
prints as ink. Nothing is positioned by guesswork, so it comes out looking
typed.

The only guesswork is *which* box is which. The exporter matches its field names
against the sheet's — "Strength Save" against `ST Strength`, "Attack 1 Damage"
against `Wpn1 Damage` — and gets the great majority right on the first pass.
Press **Check the matching** to see every pairing and re-point anything wrong.

Corrections are saved against a fingerprint of that sheet's field names, so you
fix a sheet once and every hero you print on it afterwards inherits the fix.

### Print over my sheet — one file, one pass

You have the sheet as **page images** (PNG/JPEG) or as a non-fillable PDF. The
exporter lays it down as a backdrop and writes on top, giving you a single file
to print. This is the path to use if your printer will not reliably take paper
twice.

Page images unlock the aligner — see below.

### Ink only — for paper you have already printed

No backdrop at all: just the writing, on blank pages. Print the official sheet
first, put it back in the paper tray, and run the ink over it.

Pages you leave unticked still come out **blank rather than skipped**, so the
stack stays in step with the sheet. Asking for pages 1 and 3 gives you three
sheets, the middle one empty — otherwise page 3's writing would land on page 2.

## Getting the alignment right

The coordinates that ship with Quest Board are a careful reconstruction, not a
measurement taken off Wizards' file. Expect to spend five minutes lining them up
the first time. You will never spend them again — everything below is saved in
your browser.

**The aligner.** In *Print over my sheet*, give the exporter page images and an
**Align page** button appears. It lays the boxes over your sheet at true
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

Everything the hero sheet knows: name, class, subclass, species, background,
level, XP and player; the six abilities with their modifiers; saving throws and
all eighteen skills with proficiency ticks; AC, initiative, speed, size,
proficiency bonus and passive Perception; hit points and hit dice; equipped
weapons as attack rows, with damage cantrips filling the rows below them; class
and subclass features to your level, species traits and feats; armor training,
weapon and tool proficiencies; the pack and your gold; and on the spell page the
casting ability, modifier, save DC and attack bonus, cantrips, and every known
spell filed under its level with the slot counts.

Boxes the app does not model — temporary hit points, hit dice spent, death
saves, languages, the coins that are not gold — are left empty for you to fill
in at the table, which is where they belong.

## For contributors

The exporter lives in `frontend/src/lib/sheet/`:

| file | what it holds |
| --- | --- |
| `fields.ts` | the field catalogue — every box, named once, with the aliases the matcher uses |
| `values.ts` | pure: a hero and the rules it points at, in, a value per field id, out |
| `layout2024.ts` | where each box sits, in points from the top-left of a Letter page |
| `render.ts` | the pdf-lib pass: ink, backdrops, calibration, guides |
| `acroform.ts` | reading, auto-matching and filling a fillable PDF |
| `prefs.ts` | what the browser remembers: calibration, box nudges, field maps |

Adding a box means adding it to `fields.ts` (so the matcher and the UI see it),
`layout2024.ts` (so it has a position) and `values.ts` (so it has a value).

`pdf-lib` is loaded only when the dialog builds something — `render.ts` and
`acroform.ts` are reached through `import()`, which keeps ~430 kB out of the
main bundle. Keep it that way: never import either module eagerly.

If you tune the layout against a real sheet and get it dead on, that alignment
is worth sharing. The saved overrides live under
`questboard.sheet-export.v1` in `localStorage`; folding them into the defaults
in `layout2024.ts` improves the first-run experience for everyone.
