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
  Requires Node 18+ and nothing else: brand_kit.js and brand_check.js use only
  Node's built-ins, so there is nothing to install and no library is vendored.
  Run `node check_deps.js` from the skill folder to confirm. See SETUP.md.
metadata:
  version: 1.0.1
---

# brand-kit

## What this skill is for

One `brand.json` holds an organization's palette, typography, logo, header
style, and document-naming vocabulary. Every other skill in the pack reads it
through `brand_kit.js`. Running this skill is how that file comes to exist, and
`brand_check.js` is what decides whether it is fit to build against.

Run once per organization. Re-run when the brand changes.

## The gap this closes

Without this skill, the base model takes the brand guide's colours at face value
and has no way to know what that costs: five of six kits kept a header colour
that fails contrast under white text, and three kept a second-path colour one
tint away from the first. The values are judged as swatches — side by side, on a
white ground, at a size no document ever renders them at. They are then dropped
into slots that already decided how they get used: 8.5pt tinted text on the
header fill, a lighter tint on a dark strip, white on the info-box bar. Three
failures follow and none of them raise an error at build time.

1. **Contrast collapses at the point of use.** A mid-tone accent that reads as
   confident in a swatch cannot carry a light tint of itself as 8.5pt text. The
   document builds, exports, and prints; the subtitle is simply hard to read,
   and nobody traces that back to the palette.
2. **The alternate-path colour is picked as a shade rather than a hue.** Brands
   supply tints, so a tint is what gets offered. Two close tints on the two
   halves of a decision block do not read as two paths — they read as one path
   with a rendering fault.
3. **The naming vocabulary gets no scrutiny at all.** `PREFIX` and `SEGMENT` are
   filename *fields*, delimited by underscores. An underscore inside one shifts
   every field after it, and the SOP↔QRG pairing validator then compares the
   wrong substrings — months after the documents were distributed.

None of the three is a judgement call. Each is a number against a threshold.
`brand_check.js` computes all of them and exits non-zero.

## Trigger

| Command | Action |
|---|---|
| `brand:` | Full intake. Produces `brand.json` and a trimmed logo. |
| `brand: check` | Validate the kit resolved by the search order. Report only. |
| `brand: recheck <path>` | Validate a specific `brand.json`. Report only. |

## Hard fails

These stop the skill. Each is enforced by a check that returns a signal, not by
this paragraph.

1. **`brand_check.js` exits non-zero → no `brand.json` is written.** Not
   written-with-a-caveat. A kit that fails is not saved, because a saved kit is
   one every subsequent build silently reads. Report the violations and the
   proposed corrections, and write only after a clean run. Verify by exit code;
   never by reading the report text and concluding it looked fine.
2. **A colour value that is not six uppercase hex digits is never written.**
   `docx` does not reject `"#2E75B6"`. It renders the cell unshaded, and the
   result looks like a design choice.
3. **A logo is never embedded untrimmed.** Trim to the content bounding box
   first. The embedder scales to the canvas, so baked-in margin shrinks the
   visible mark and lifts it off the header baseline.
4. **`brand.json` is never partially written.** All seven palette slots, or
   none. `brand_kit.js` merges over defaults, so a half-kit produces a document
   in a mix of two palettes with no indication that happened.

## Scope boundaries

Each names the exit, not an intention.

- **Asked to design a brand** — pick colours, invent a logo, choose a typeface
  with no existing identity to work from: refuse, and say that this skill
  captures an identity rather than authoring one. Offer instead to run the
  intake against the neutral defaults so documents build now, and to re-run once
  an identity exists.
- **Asked to change what a colour is used for** — swap which slot fills the
  table header rows, drop the info-box header bar, restyle the step card,
  re-point a text run at a different slot: refuse, and say that slot semantics
  belong to the skill that owns the template. This skill fills slots; it does
  not redefine them. Where a slot genuinely cannot satisfy its role — as when
  the QRG header once printed a tint of `ACCENT` on `ACCENT` — the finding
  belongs to the template's owner as a report, not to this skill as an edit.
- **Asked to bypass a failing check** — "ship it anyway", "the client approved
  those colours": do not write the file. State the measured number and the
  threshold, name which slot is adjustable, and offer the nearest passing value.
  There is no override flag, deliberately.
- **Given a non-PNG logo** — SVG, PDF, JPEG: do not convert silently. Say what
  conversion is needed and why PNG with transparency is what the builder embeds.
- **Given a brand with no logo at all**: this is a supported state, not a
  failure. Set `logo.absent: true` and `header.style: "title-only"`. The header
  collapses to a single full-width cell. Do not leave `header.style` at
  `"logo-left"` with no logo — `brand_check.js` fails that combination, because
  an empty logo cell leaves an unexplained indent on every page.

## Procedure

### 1. Gather

Ask for, in one pass:

- the organization name, and a short form if the full name runs past 48
  characters — the QRG header's right-hand cell prints the short form, or the
  full name when there is none
- the logo file, or a statement that there is none
- the brand's primary colour, and any secondary colours that exist
- the document typeface, and whether it is installed on the machines readers
  open documents on. A Word file names its font and carries no substitute, so
  if the brand face is not on those machines, pick one that is
- the library prefix and the process-area segments documents are filed under

Do not ask for seven hex values. Ask for the brand's actual colours and derive
the ramp in step 3.

### 2. Check the colours as supplied, and ask before moving any

The buyer's colours are theirs. A kit that comes back darker, or with a colour
they never chose, is a decision made behind their back unless they made it.
So measure first and ask, before deriving anything.

Put the supplied values into a scratch `brand.json`: the primary as `ACCENT`,
any secondary as `ALT_ACCENT`, the warm neutral as `GOLD`, tints where the brand
has them, and the neutral default's value in any slot the brand does not supply,
since the checker needs all seven. This file is a measurement, never written into
place. Run `brand_check.js` on it. Exit 0 means nothing has to move: say so,
and carry on. Exit 1 lists every slot that fails, with the measured number.

Then ask, in one message, for every slot that has to move:

- **Say where it prints**, not only the ratio: "white header text on your green
  is 3.35:1, and small print needs 4.5:1 to read reliably" — the document, not
  the swatch.
- **Offer choices, with a recommendation.** (a) a darker shade of the same
  colour, with the proposed hex and its new ratio — usually the recommendation,
  because it keeps the brand's hue; (b) another colour the brand already owns,
  if one passes; (c) build on the neutral defaults for now and re-run the
  intake once the brand owner has ruled.
- **A slot with no brand colour to fill it is a question, never a pick.** The
  commonest is `ALT_ACCENT` when the brand has one hue family: the second path
  needs a different hue, and choosing one is designing the brand (see Scope
  boundaries). Offer the neutral default's `ALT_ACCENT`, or ask them to name
  one.
- **Naming is theirs too.** A segment that breaks the pattern gets a proposed
  short form and a question — `CIRCULATION` is 11 characters; "CIRC?" — not a
  silent rename.

A logo trim is not a choice and needs no question: say it was done and by how
much. The check still gates the write whatever the answers are — there is no
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

`ACCENT` often has to move. A brand's primary is chosen to look good on a
website, where it sits behind large text or none. Here it is a fill under 8.5pt
white and it is also printed as text on the white page. Expect to darken it —
but only as the buyer chose in step 2. This step carries out their answers; it
does not make a choice they were not shown.

**Do not try to make a tint of the accent readable on the accent.** It is the
trap this derivation exists to avoid. A brand hands you tints, the header has a
subtitle, and putting one on the other is the obvious move — but a tint light
enough to read at 8.5pt on its own parent forces that parent so dark that every
document in the pack turns navy. The header prints WHITE. `LACCENT` and
`LACCENT2` are borders and fills.

The light ramp must ascend in L\*: `DACCENT < ACCENT < LACCENT < LACCENT2`.

### 4. Prepare the logo

Trim to the content bounding box. Keep transparency. Do not upscale. Save as
8-bit PNG — `brand_check.js` can only verify trim mechanically on that subset,
and reports honestly that it skipped when it cannot.

Name it `logo.png` and keep it in the same folder as `brand.json`. A kit is
those two files side by side, with no folder inside it, so it still works when
it travels as two attachments.

### 5. Write the candidate and check it

Write `brand.json` to a scratch path first, then:

```bash
node brand_check.js <scratch-path>/brand.json
echo $?
```

Exit 0 → move it into place (see *Where the file goes*). Exit 1 → correct and re-run. Exit 2 → the file is
unreadable or unparseable; fix that before reading any finding.

Read the exit code. The report is for the buyer; the exit code is the gate.

### 6. Report what moved

State every value that differs from what the buyer supplied, with the measured
number that forced it. "Your blue went from `3A9BB5` to `2E75B6` because white
8.5pt on the original is 3.21:1 and the floor is 4.5:1" is the deliverable. A
palette handed back with no account of what changed is the thing this skill
exists to replace. Tie each change to the answer in step 2 that chose it; the
report confirms an agreement, and nothing in it should be news to the buyer.

## Where the file goes

`brand_kit.js` resolves in this order and stops at the first hit:

1. the path in `$HPW_BRAND_KIT`
2. `brand.json` in the current working directory
3. `brand.json` in any parent directory, walking up to the filesystem root
4. the built-in neutral defaults

It never reads an installed skill folder, this one included, and never a
sibling skill: an installed skill may be read-only, and no surface guarantees
that skills sit side by side. So "move it into place" means the buyer's own
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
skills point `$HPW_BRAND_KIT` at it. Attachments arrive as loose files side by
side, which is already the kit's layout, so there is no folder to rebuild.

A **missing** kit is not an error — the skills build with neutral defaults, and
that is a documented, correct state. A **present but malformed** kit throws.
That asymmetry is deliberate: falling back to defaults because a config had a
trailing comma produces a document in the wrong colours that reports success.

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
  "header":  { "style": "logo-left", "rule": "accent" },
  "naming":  { "PREFIX": "ROAST", "SEGMENTS": ["OPS", "SVC", "ADMIN"], "defaultSegment": "OPS" }
}
```

`logo.path` is resolved relative to `brand.json`, not to the directory a build
runs from. Write it as the bare file name, `logo.png`. A kit that keeps its logo
in a subfolder, such as `media/logo.png`, still resolves where the folder exists,
but it breaks as soon as it travels as attachments: a chat surface has no way to
rebuild the folder.

## Naming rules

`PREFIX` matches `^[A-Z][A-Z0-9]{1,7}$`. Each `SEGMENTS` entry matches
`^[A-Z][A-Z0-9]{1,9}$`. Neither may contain an underscore, and no segment may be
`SOP` or `QRG`.

The reason is structural rather than stylistic. Filenames are
`{PREFIX}_{SEGMENT}_{Topic}_SOP.docx`, and the pairing validator compares the
`{SEGMENT}_{Topic}` of a QRG against its parent SOP by splitting on
underscores. An underscore inside a field shifts every field after it, so the
comparison silently runs on the wrong substrings and passes or fails for the
wrong reason.

## Reading the kit from a build script

```js
const BRAND = require('./brand_kit.js').load();
BRAND.palette.ACCENT      // '2E75B6'
BRAND.naming.PREFIX       // 'ROAST'
BRAND.logo.resolvedPath   // absolute, or null
BRAND._source             // 'config' | 'defaults'
BRAND._configPath         // which file was read
```

`sop_helpers.js` already calls this at require time, so a build script that
imports the helper gets the buyer's palette without doing anything. Read
`BRAND` directly only for the slots the helper does not export —
`ALT_ACCENT`, `LACCENT`, `LACCENT2`, the naming vocabulary, and the logo path.

Log `BRAND._source` in any build that matters. A document built on neutral
defaults when the buyer expected their own colours is the one failure mode this
architecture introduces, and one line prevents it.

## Deciding example

`examples/brand-sample/brand-broken.json` is a kit no one would look at twice.
A teal primary, a darker teal for headings, two tints of it, a purple-ish
secondary, the stock warm neutral, a real typeface, the organization's actual
logo file, a sensible prefix. It is what a careful person produces in ten
minutes.

`node brand_check.js examples/brand-sample/brand-broken.json` exits 1 on ten
violations:

```
FAIL  contrast.hdr.title      WHITE on ACCENT is 3.21:1, below 4.5:1
FAIL  contrast.hdr.subtitle   WHITE on ACCENT is 3.21:1, below 4.5:1
FAIL  contrast.hdr.date       WHITE on ACCENT is 3.21:1, below 4.5:1
FAIL  contrast.path.a         WHITE on ACCENT is 3.21:1, below 4.5:1
FAIL  contrast.label.section  ACCENT on WHITE is 3.21:1, below 4.5:1
FAIL  contrast.info.head      WHITE on GOLD is 2.94:1, below 4.5:1
FAIL  alt.distance            ALT_ACCENT is dE*ab 11.4 and 0.5 degrees of hue from ACCENT
FAIL  naming.prefix           naming.PREFIX is "ROAST_CO" — must match /^[A-Z][A-Z0-9]{1,7}$/
FAIL  logo.trim               untrimmed: 33.8% blank margin on the right
```

Four things worth noticing about that list.

The teal is not a bad colour. It fails in six places at once because one
mid-tone value is used as the header fill under white, as both decision-path
header fills under white, and as text on the white page — two opposite
directions, and no mid-tone satisfies both. That is the finding a swatch
cannot produce.

`ALT_ACCENT` at `2F7E93` looks purple-adjacent in isolation and is 0.5 degrees
of hue from the accent. The eye reading a printed decision block will not see
two paths.

`ROAST_CO` is a completely reasonable prefix and it breaks the pairing
validator eight months later.

And the logo is the project's own shipped sample asset. It carries a 33.8%
blank right margin that survived a strip audit, a build, and a sign-off,
because every check it had been through until now measured geometry.

`examples/brand-sample/brand.json` is the corrected kit. It exits 0.

## Verification

Before reporting a kit as done:

- [ ] `node brand_check.js <path>` exits 0 — checked by reading `$?`, not the report
- [ ] every value that differs from what the buyer supplied is named, with its number
- [ ] every one of those changes was put to the buyer in step 2 and chosen by them —
      no slot filled with a colour they were not shown
- [ ] `logo.png` beside `brand.json` is the trimmed file, not the original
- [ ] `header.style` matches whether a logo exists
- [ ] a build script run from the intended working directory reports
      `BRAND._source === 'config'` and the `_configPath` you expect
