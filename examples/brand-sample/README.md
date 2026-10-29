# brand-sample

Two kits for the same fictional company, a coffee roastery. One passes. One
does not, and the one that does not is the point of this folder.

```bash
node ../../brand_check.js brand.json          # PASS, exit 0
node ../../brand_check.js brand-broken.json   # FAIL, exit 1
```

## What `brand-broken.json` is

It is not a strawman. It is what a careful person produces in ten minutes: a
teal primary pulled off the company's website, a darker teal for headings, two
tints of the primary for light text, a secondary that reads as a different
colour when you look at it, a warm gold, a real typeface, the company's actual
logo file, and a prefix that matches how the company already talks about its
documents.

Every value in it was chosen by looking at swatches on a white ground. That is
the whole failure.

## The violations, and what each one looks like on paper

### Contrast — eight of them

| Finding | Measured | Where it shows up |
|---|---|---|
| `contrast.hdr.title` | 3.21:1 | The document title, white on the header banner. Reads as slightly washed. |
| `contrast.hdr.subtitle` | 3.21:1 | The subtitle under it, at 8.5pt. Legible on a monitor, marginal on paper, gone under office lighting. |
| `contrast.hdr.org` | 3.21:1 | The company's own name in its own header. |
| `contrast.hdr.date` | 3.21:1 | The effective date at 7.5pt — the field someone squints at to check whether the copy on the wall is current. |
| `contrast.path.a` | 3.21:1 | The primary path header in a decision block. |
| `contrast.label.section` | 3.21:1 | Every section label on the page, this time as *text* rather than as a fill. |
| `contrast.info.head` | 2.57:1 | White on the info-box bar. |
| `contrast.purpose.label` | 2.57:1 | The PURPOSE label, printed in the gold on the white page. |

One colour causes six of these. `3A9BB5` is a fill under white text in two
places, five text runs, **and** is printed as text on the white page — two opposite
directions, and no mid-tone value satisfies both. It has to get darker; the
corrected kit uses `2E75B6`, which clears white at 4.84:1 and still reads as
the same family of blue.

The other two are `GOLD`, once as a fill under white text and once as text on
the white page, both at 2.57:1.

This is the class of problem a swatch cannot show you. The colours are only
wrong in combination, and only at the sizes the templates use.

### `alt.distance` — the alternate path that isn't

`ALT_ACCENT` is `2F7E93`. On its own it looks like a different colour from
`3A9BB5`. Measured: dE\*ab 11.4, and **0.5 degrees** of hue apart.

`ALT_ACCENT` has exactly one job — heading the second half of a decision block
so the reader can see there are two paths. At half a degree of hue separation
there is no second path. There is one path and what looks like a printing
fault, which is worse than no colour coding at all, because the reader stops
trusting the colour rather than reading past it.

Brands hand you tints. A tint is not an alternate.

### `naming.prefix` — a delimiter inside a field

`ROAST_CO` is a reasonable-looking prefix, and it is refused. Filenames are
`{PREFIX}_{SEGMENT}_{Topic}_SOP.docx`: the underscore is the delimiter between
the fields, so no field may contain one. `ROASTCO` is the same prefix in a form
a filename can carry.

To reproduce it in isolation, set the prefix to `ROAST_CO` in a copy of
`brand.json` (see below) and re-run the check.

### `logo.trim` (advice) — 33.8% of the width is blank margin on the right

`logo_untrimmed.png` is 1100×240. The artwork occupies x=20 to x=727. The
remaining 372 pixels on the right are blank canvas.

The document builder scales the image to the header cell's width. It scales the
*canvas*, not the artwork — so a third of the header cell is spent on emptiness,
the visible mark comes out a third smaller than intended, and it sits left of
where the header baseline expects it.

`logo.png` is the same file cropped to its content bounding box: 708×161.
Nothing else changed.

This one is advice, not a failure: the logo is the buyer's. The skill shows it
as delivered, trimmed, and trimmed with a border, and keeps the one they pick.

## Breaking the passing kit on purpose

Each of these turns `brand.json` from exit 0 to exit 1. Work on a copy: put
`brand.json`, `logo.png` and `logo_untrimmed.png` in a scratch folder, change
one value there, and run `node "SKILL_DIR/brand_check.js" brand.json` from that
folder, where `SKILL_DIR` is the brand-kit skill folder.

| Change | Finding |
|---|---|
| `"ACCENT": "navy"` | `palette.format` — not six hex digits; a document build stops with HPW_BRAND_CHECK_FAILED |
| Swap `ACCENT` and `LACCENT2` | `order.light` — the L\* ramp no longer ascends — plus the contrast pairs |
| `"ALT_ACCENT": "2A6FA0"` | `alt.distance` — a near tint of the accent |
| `"GOLD": "1F5E89"` | `gold.distance` — every aside now reads as a section header |
| `"PREFIX": "ROASTWORKS"` | `naming.prefix` — over eight characters |
| `"SEGMENTS": ["OPS", "CIRCULATION"]` | `naming.segments` — over ten characters |
| Delete `"BGLTGOLD"` | `palette.missing.BGLTGOLD` — there is no partial kit |
| `"shortName"` wider than the 151 pt cell, such as a 50-character name | `org.shortName.length` — the QRG header prints it, and it wraps and pushes the date onto a second line |
| Delete `"shortName"` and make `"name"` wider than the cell | `org.name.length` — with no short form, the header prints the full name |

A long `"name"` on its own is fine. The agenda and the requirements document
print it at full width; only the QRG header's right-hand cell is narrow, and it
prints `"shortName"` — or `"name"` when there is no short form.

## The two warnings

Neither is a failure. (The broken kit warns on `logo.trim`, explained
above, and on `logo.name`: its logo is called `logo_untrimmed.png`, not
`logo.png`, so the kit no longer travels as two plain attachments.)

`type.fallback` fires when a kit still declares a fallback font. Nothing reads
it: a Word file names its font and cannot carry a substitute, so a reader
without `FONT` sees whatever their copy of Word picks. Delete the key, and if
`FONT` may be missing on your readers' machines, choose one that is installed
on them.

Font *installation* is not reported as a finding at all, because it cannot be
checked offline and a warning that fires on every single run is a warning nobody
reads. It is stated once, in the `type.font` pass line.

`gold.hue` fires when your `ACCENT` sits within 40 degrees of `GOLD` on the hue
wheel. Both are slots in your kit. On a cool palette gold is at the far side
of the wheel and every element that uses it to mean "pay attention here" reads
as different. On a warm palette it is a near neighbour and reads as one more
section heading. `gold.distance` does not catch
this — the two are far apart in dE\*ab and close in hue, and dE does not measure
hue on its own.

It is a warning and not a failure because the attention elements — the agenda's
decision band, the requirement document's extension marker — carry a glyph as
well as a colour. On a warm kit the glyph is doing the work, which is fine.
**What the warning is telling you is not to remove the glyphs.** If you would
rather the colour carried it too, move `ACCENT` or `GOLD` so the two sit
further apart in hue.

To see it: set `"ACCENT": "B45724"` and `"DACCENT": "8E431A"` — a warm kit that
passes every violation check and warns here.
