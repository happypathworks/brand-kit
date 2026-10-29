# brand-kit — setup

## What's in the package

```
brand-kit/
  SKILL.md          the skill itself
  brand_kit.js      the loader every other skill reads the config through
  brand_check.js    the validator, exit-coded
  brand_rules.js    the checks themselves, which brand_check.js and every build run
  check_deps.js     the install check: every file present, and the validator
                    returns the right verdict on both sample kits
  package.json      declares that there is nothing to install
  SETUP.md          this file
  NOT_CHECKED.md    the rules in SKILL.md that no tool checks
  LICENSE.txt       the terms — this skill is free, under MIT; section 2
  examples/brand-sample/
    brand.json          a kit that passes
    brand-broken.json   a kit that looks fine and fails the check
    README.md           what each failure is and how to reproduce it
    logo.png            trimmed, beside brand.json: a kit is these two files
    logo_untrimmed.png  the same logo with its original canvas, for the trim advice
```

`SKILL_DIR` below is the folder this file is in.

## Dependencies

None.

`brand_check.js` and `brand_rules.js` use `fs`, `path`, `util` and `zlib` — all built into Node. They decode
the logo PNG themselves rather than pulling in an image library, so the check runs on any
machine with Node. Nothing in the pack is installed: the document skills carry
their one library inside them.

Node 20 or newer, tested on Node 20 and 24.

## Verify the install

```bash
cd "SKILL_DIR"
node brand_check.js examples/brand-sample/brand.json
```

Expected: a `PASS — clean.` line and exit 0.

Then the other direction, which is the one worth seeing:

```bash
node brand_check.js examples/brand-sample/brand-broken.json
echo $?
```

Expected: exit 1 and ten violations, a `FAIL` line for each — contrast, the
alternate path and the prefix — and warnings on the logo trim and the logo's file name. Read them. They are the failures
this skill exists to catch, and `examples/brand-sample/README.md` explains what
each one would have looked like in a printed document.

Both at once, from any folder:

```bash
node "SKILL_DIR/check_deps.js"
```

Expected: `PASS — package complete and the validator agrees with its fixtures.`
and exit 0. It confirms every file above is present, Node is 20 or newer, and
the validator passes `brand.json` and fails `brand-broken.json`. Exit 1 names
each check that failed and its fix.

## Install your own kit

Run the skill — `brand:` — and it produces `brand.json` and the logo you pick
for you. To write one by hand instead, copy `examples/brand-sample/brand.json`,
change the values, and check it:

```bash
node "SKILL_DIR/brand_check.js" path/to/your/brand.json
```

Do not skip the check. Nearly everything it refuses is a document that builds
cleanly, exports cleanly, and is wrong.

## Where to put the file

`brand_kit.js` looks in this order and stops at the first hit:

1. the path in `$HPW_BRAND_KIT`
2. `brand.json` in the current working directory
3. `brand.json` in any parent directory, up to the filesystem root
4. the built-in neutral defaults

It never searches an installed skill folder, this one included (only a build run
from inside one reads it, and that is the wrong place to run one): an installed skill
may be read-only, and no surface guarantees that skills sit side by side. Two
placements cover almost everything:

**One brand, many projects.** Put `brand.json` in a folder above all of your
projects. A build run from any project beneath it finds the file at (3), by
walking up.

**Several brands.** Put a `brand.json` at the top of each project folder. Builds
run from inside that folder find it at (2) or (3). This is the layout to use if
you produce documents for clients.

`$HPW_BRAND_KIT` is for the case where neither works — a file attached to a
conversation, a build server, a scripted batch, a shell you want pinned to one
kit regardless of where it is run from.

## Check which kit a build actually used

From the folder you build in:

```bash
node "SKILL_DIR/brand_check.js"
```

With no path, the checker finds the kit the way a build run from that folder
does, and its first line names the file. `no brand.json found` (exit 2) means a
build there uses the neutral defaults. A document built on neutral defaults
when you expected your own colours is the failure this architecture introduces,
and it is invisible in the output — the document looks deliberate either way.

## No brand kit yet

Nothing breaks. Every skill in the pack builds against neutral defaults, and
those defaults pass `brand_check.js` clean. Install a kit when you have one.

## No logo

Supported. Set:

```json
"logo": { "absent": true, "path": null }
```

The document skills then build their headers without a logo.
