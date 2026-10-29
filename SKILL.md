---
name: brand-kit
description: >
  Capture an organization's visual identity and document-naming vocabulary into
  a validated brand.json that every other Document Ops skill reads. Run once per
  organization. The entry point is the "brand:" prefix: a message that starts
  with "brand:" invokes this skill and nothing else needs to match. "brand:"
  alone runs the full intake; "brand: check" validates the installed kit and
  reports; "brand: recheck PATH" validates a specific brand.json. It also
  applies when a document build reports it is using neutral defaults and the
  user wants their own colours, when a user supplies a logo or a palette and
  asks to set up their branding, or when a document skill reaches a {PREFIX},
  {SEGMENT}, or {ORG_NAME} placeholder with no kit installed. Read this file
  before writing a brand.json: the contrast, ramp, and naming constraints are
  computed by brand_check.js, not estimated.
license: Terms in LICENSE.txt, section 1 names which apply to this skill
compatibility: >
  Requires Node (tested on 20 and 24): brand_kit.js and brand_check.js use only
  Node's built-ins, so there is nothing to install and no library is vendored.
metadata:
  version: 1.0.1
---

# brand-kit

## What this skill is for

One `brand.json` holds an organization's palette, typography, logo, and
document-naming vocabulary. Every other skill in the pack reads it through
`brand_kit.js`. Running this skill is how that file comes to exist, and
`brand_check.js` is what decides whether it is fit to build against.

Run once per organization. Re-run when the brand changes.

## The gap this closes

Without this skill, the base model takes a brand guide's colours at face value:
it judges them as swatches on a white ground, not where the templates print
them — white text on the header fill, the second path of a decision block
beside the first. A header colour that fails contrast, or an alternate path one
tint away from the primary, then goes into every document, and no build
reports it. `brand_check.js` measures each against a threshold and exits
non-zero.

## Trigger

| Command | Action |
|---|---|
| `brand:` | Full intake. Produces `brand.json` and the logo the buyer picked. |
| `brand: check` | Validate the kit the search order finds from the buyer's work folder. Report only. |
| `brand: recheck PATH` | Validate a specific `brand.json`. Report only. |

Every command names the checker by its full path. `SKILL_DIR` is the folder
holding this SKILL.md — resolve it from this file, not from the working
directory. You should run from the buyer's work folder, never from `SKILL_DIR`: with no
path, `brand_check.js` finds the kit from the folder it runs in, exactly as a
build there does, so from the skill folder it finds none.

- `brand: check` — `node "SKILL_DIR/brand_check.js"`
- `brand: recheck PATH` — `node "SKILL_DIR/brand_check.js" PATH`

## Hard fails

1, 2 and 4 stop the skill, each on a check's signal; no check enforces 3.

1. **`brand_check.js` exits non-zero → no `brand.json` is written.** Not
   written-with-a-caveat. A kit that fails is not saved: every document build
   runs the same checks and refuses it. Report the violations and the
   proposed corrections, and write only after a clean run. Verify by exit code;
   never by reading the report text and concluding it looked fine.
2. **A colour that is not six hex digits is never written** — a name such as
   `navy`, or three digits. `brand_check.js` refuses it, and a document build
   stops with HPW_BRAND_CHECK_FAILED, naming `palette.format`. Write every
   slot as six uppercase digits with no `#`: `#2e75b6` is written `2E75B6`.
3. **A buyer's logo is never refused for its padding.** When `brand_check.js`
   advises `logo.trim`, show the logo as delivered, trimmed, and trimmed with a
   border, and use the one the buyer picks. The embedder scales the canvas, so
   margin shrinks the visible mark; that trade is theirs to make.
4. **`brand.json` is never partially written.** All seven palette slots, or
   none. A document build refuses a half-kit, naming each missing slot.

## Scope boundaries

- **Asked to design a brand** — pick colours, invent a logo, choose a typeface
  with no existing identity to work from: you should refuse, and say that this skill
  captures an identity rather than authoring one. Offer instead to run the
  intake against the neutral defaults so documents build now, and to re-run once
  an identity exists.
- **Asked to change what a colour is used for** — swap which slot fills the
  table header rows, drop the info-box header bar, restyle the step card,
  re-point a text run at a different slot: you should refuse, and say that slot semantics
  belong to the skill that owns the template. This skill fills slots; it does
  not redefine them. Where a slot genuinely cannot satisfy its role, the
  finding belongs to the template's owner as a report, not to this skill as an
  edit.
- **Asked to bypass a failing check** — "ship it anyway", "the client approved
  those colours": do not write the file. State the measured number and the
  threshold, name which slot is adjustable, and offer the nearest passing value.
  There is no override flag, deliberately.
- **Given a non-PNG logo** — SVG, PDF, JPEG: do not convert silently. Say what
  conversion is needed and why PNG with transparency is what the builder embeds.
- **Given a brand with no logo at all**: this is a supported state, not a
  failure. Set `logo.absent: true` and `logo.path: null`; the document skills
  then build their headers without a logo.

## Procedure

### 1. Gather

Ask for, in one pass:

- the organization name, and a short form if the full name is long — the QRG
  header cell prints the short form, else the full name; `brand_check.js`
  fails one too wide for it in Arial Bold, whatever `FONT` is
- the logo file, or a statement that there is none
- the brand's primary colour, and any secondary colours that exist
- the document typeface, and whether it is installed on the machines readers
  open documents on. A Word file names its font and carries no substitute, so
  if the brand face is not on those machines, pick one that is
- the library prefix and the process-area segments documents are filed under

You should not ask for seven hex values. Ask for the brand's actual colours and derive
the ramp in step 3.

### 2. Check the colours as supplied, and ask before moving any

The buyer's colours are theirs. A kit that comes back darker, or with a colour
they never chose, is a decision made behind their back unless they made it.
So measure first and ask, before deriving anything.

Put the supplied values into a scratch `brand.json`: the primary as `ACCENT`,
any secondary as `ALT_ACCENT`, the warm neutral as `GOLD`, tints where the brand
has them, and the neutral default's value in any slot the brand does not supply,
since the checker needs all seven. This file is a measurement and should not be written
into place. Run `brand_check.js` on it with the step 5 command. Exit 0 means nothing
has to move: say so, and carry on. Exit 1 lists every slot that fails, with the
measured number.

Then ask, in one message, for every slot that has to move:

- **Say where it prints**, not only the ratio: "white header text on your green
  is 3.35:1, and small print needs 4.5:1 to read reliably" — the document, not
  the swatch.
- **Offer choices, with a recommendation.** (a) a darker shade of the same
  colour, with the proposed hex and its new ratio — usually the recommendation,
  because it keeps the brand's hue; (b) another colour the brand already owns,
  if one passes; (c) build on the neutral defaults for now and re-run the
  intake once the brand owner has ruled.
- **A slot with no brand colour to fill it should be a question, never a pick.** The
  commonest is `ALT_ACCENT` when the brand has one hue family: the second path
  needs a different hue, and choosing one is designing the brand (see Scope
  boundaries). Offer the neutral default's `ALT_ACCENT`, or ask them to name
  one.
- **Naming is theirs too.** A segment that breaks the pattern gets a proposed
  short form and a question — `CIRCULATION` is 11 characters; "CIRC?" — not a
  silent rename.

The logo is a choice too: show it three ways (step 4) and ask which one. The check still gates the write whatever the answers are — there is no
override, so an answer of "keep my green exactly" gets the measured number, the
slot it fails in, and option (c).

### 3. Derive the ramp

Seven slots, from however few colours the brand actually has.

| Slot | Role | Derivation |
|---|---|---|
| `ACCENT` | header fill, rules, section labels | the primary brand colour, dark enough to carry WHITE text at 4.5:1 |
| `DACCENT` | table header rows, headings | same hue, ~10 L\* darker |
| `LACCENT` | label underlines, post-action border — **borders, never text on `ACCENT`** | same hue, light tint |
| `LACCENT2` | post-action fill, priority-strip text on `DACCENT` | same hue, lighter still |
| `ALT_ACCENT` | alternate-path header | a **different hue family** — a secondary brand colour if one exists |
| `GOLD` | info-box header bar | brand's warm neutral, dark enough to carry white |
| `BGLTGOLD` | info-box body fill | a pale tint of it |

`ACCENT` often has to move. Here it is a fill under 8.5pt
white and it is also printed as text on the white page. Expect to darken it —
but only as the buyer chose in step 2.

**You should not try to make a tint of the accent readable on the accent.** It is the
trap this derivation exists to avoid. A tint light
enough to read at 8.5pt on its own parent forces that parent so dark that every
document in the pack turns navy. The header prints WHITE. `LACCENT` is a
border; `LACCENT2` is a fill and the priority-strip text on `DACCENT`; neither
is ever text on `ACCENT`.

The light ramp must ascend in L\*: `DACCENT < ACCENT < LACCENT < LACCENT2`.

### 4. Prepare the logo

Check the logo as delivered. When `brand_check.js` advises `logo.trim`, show
three versions and keep the one the buyer picks:

- **as delivered**;
- **trimmed** to the content bounding box: the smallest box holding every pixel
  that is not background — not transparent, or not the corner colour on an
  opaque canvas;
- **trimmed with a border**: the trimmed art, an even gap, a 2 px `DACCENT`
  outline.

Keep transparency. You should not upscale. Save as PNG — `brand_check.js`
decodes every PNG, interlaced or not, and treats a file that breaks the PNG
format as damaged.

No image tool ships with this skill. Check what the environment you are running
in has — ImageMagick (`magick -version`, or `convert -version` anywhere but
Windows, where a bare `convert` is a disk utility) or Pillow
(`python -c "import PIL"`) — and make the two versions with one that answers.
If none answers, you should not name a tool to the buyer that you have not seen
run here: offer the logo as delivered, pass on the margin `brand_check.js`
measured on each side (its `logo.trim` line), and say they can send a cropped
version if they want one.

For a trimmed version, print the crop box: the original size and the box kept,
in pixels — "1100×240, kept x 20–727, y 40–200: 708×161".

Name the one they picked `logo.png` and keep it in the same folder as `brand.json`. A kit is
those two files side by side, with no folder inside it, so it still works when
it travels as two attachments.

### 5. Write the candidate and check it

Write `brand.json` to a scratch folder, beside the chosen `logo.png`, then run
from the buyer's work folder:

```bash
node "SKILL_DIR/brand_check.js" SCRATCH/brand.json
echo $?
```

Exit 0 → move it into place (see *Where the file goes*). Exit 1 → correct and
re-run. Exit 2 → the file is unreadable or unparseable; fix that before reading
any finding. Exit 3 → the checker crashed on a value it did not expect: report
its message, which is not a list of violations — a crash is exit 3, never 1.
Node's own failure to start the checker is exit 1 with no report
(`Cannot find module` means `SKILL_DIR` is wrong), so an exit 1 is violations
only when the report ends in a `FAIL —` line.

Read the exit code. The report is for the buyer; the exit code is the gate.

### 6. Report what moved

State every value that differs from what the buyer supplied, with the measured
number that forced it. "Your blue went from `3A9BB5` to `2E75B6` because white
8.5pt on the original is 3.21:1 and the floor is 4.5:1" is the deliverable. Tie each change to the answer in step 2 that chose it; the
report confirms an agreement, and nothing in it should be news to the buyer.

## Where the file goes

`brand_kit.js` resolves in this order and stops at the first hit:

1. the path in `$HPW_BRAND_KIT`
2. `brand.json` in the current working directory
3. `brand.json` in any parent directory, walking up to the filesystem root
4. the built-in neutral defaults

It never reads an installed skill folder, this one included, and never a
sibling skill (except a build run inside one): skills may be read-only;
no surface guarantees they sit side by side. So "move it into place" means the buyer's own
folders, never a skill's:

- **One brand per project** — `brand.json` at the top of the project folder,
  found at (2) or (3).
- **One brand across every project** — `brand.json` in a folder above all of
  them; the walk-up at (3) finds it from any project beneath.
- **An attached file, a build server, a pinned shell** — point
  `$HPW_BRAND_KIT` at it (1).

Where the environment keeps no folder between conversations, hand the buyer the
validated `brand.json` and `logo.png` as two files to keep, and say so plainly:
they attach the pair next time with both names unchanged, and the document
skills point `$HPW_BRAND_KIT` at it.

A **missing** kit is not an error — the skills build with neutral defaults, and
that is a documented, correct state. A **present but malformed** kit throws.

## The schema

```json
{
  "schema": "hpw-brand-kit/1",
  "org":     { "name": "Roastworks Coffee Co.", "shortName": "Roastworks" },
  "palette": {
    "ACCENT": "2E75B6", "DACCENT": "1F4E79",
    "LACCENT": "9DC3E6", "LACCENT2": "DEEBF7",
    "ALT_ACCENT": "6B4C9A",
    "GOLD": "8C6900", "BGLTGOLD": "FFF6E0"
  },
  "type":    { "FONT": "Arial" },
  "logo":    { "path": "logo.png", "absent": false, "headerCellDxa": 1400 },
  "naming":  { "PREFIX": "ROAST", "SEGMENTS": ["OPS", "SVC", "ADMIN"], "defaultSegment": "OPS" }
}
```

`logo.path` is resolved relative to `brand.json`, not to the directory a build
runs from. Write it as the bare file name, `logo.png`.

## Naming rules

`PREFIX` must match `^[A-Z][A-Z0-9]{1,7}$`: a capital letter, then capitals or
digits, 2 to 8 characters in all. Each `SEGMENTS` entry must match
`^[A-Z][A-Z0-9]{1,9}$`: the same, 2 to 10 characters. Set `defaultSegment` to
one of the `SEGMENTS`. `brand_check.js` exits 1 when either does not match,
naming `naming.prefix` or `naming.segments`.

## Example kits

`examples/brand-sample/brand.json` passes: it is the template to copy when
writing a kit by hand. `examples/brand-sample/brand-broken.json` is the same
company's kit chosen from swatches, and fails on contrast, the alternate path
and the prefix, with advice on its logo; the README beside them says what
each failure looks like on paper.

## Verification

Before reporting a kit as done:

- [ ] `node "SKILL_DIR/brand_check.js" PATH` exits 0 — checked by reading `$?`, not the report
- [ ] every value that differs from what the buyer supplied is named, with its number
- [ ] every one of those changes was put to the buyer in step 2 and chosen by them —
      no slot filled with a colour they were not shown
- [ ] `logo.png` beside `brand.json` is the version the buyer picked
- [ ] from the folder the buyer builds in, `node "SKILL_DIR/brand_check.js"` with
      no path names the `brand.json` you wrote on its first line and exits 0 — the
      file a build there will read
