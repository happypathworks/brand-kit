# brand-kit — setup

## What's in the package

```
brand-kit/
  SKILL.md          the skill itself
  brand_kit.js      the loader every other skill reads the config through
  brand_check.js    the validator, exit-coded
  package.json      declares that there is nothing to install
  SETUP.md          this file
  LICENSE.txt       the terms — this skill is free, under MIT; section 2
  examples/brand-sample/
    brand.json          a kit that passes
    brand-broken.json   a kit that looks fine and fails ten checks
    README.md           what each failure is and how to reproduce it
    logo.png            trimmed, beside brand.json: a kit is these two files
    logo_untrimmed.png  the same logo with its original canvas, for the trim check
```

## Dependencies

None.

`brand_check.js` uses `fs`, `path`, and `zlib` — all built into Node. It decodes
the logo PNG itself rather than pulling in an image library, so it runs on any
machine with Node. Nothing in the pack is installed: the document skills carry
their one library inside them.

Node 18 or newer.

## Verify the install

```bash
cd <skill folder>
node brand_check.js examples/brand-sample/brand.json
```

Expected: `PASS — clean. 15 checks, 0 warnings.` and exit 0.

Then the other direction, which is the one worth seeing:

```bash
node brand_check.js examples/brand-sample/brand-broken.json
echo $?
```

Expected: ten violations and exit 1. Read them. They are the failures this skill
exists to catch, and `examples/brand-sample/README.md` explains what each one
would have looked like in a printed document.

## Install your own kit

Run the skill — `brand:` — and it produces `brand.json` and a trimmed logo for
you. To write one by hand instead, copy `examples/brand-sample/brand.json`,
change the values, and check it:

```bash
node brand_check.js path/to/your/brand.json
```

Do not skip the check. Every constraint it enforces is one that produces a
document which builds cleanly, exports cleanly, and is wrong.

## Where to put the file

`brand_kit.js` looks in this order and stops at the first hit:

1. the path in `$HPW_BRAND_KIT`
2. `brand.json` in the current working directory
3. `brand.json` in any parent directory, up to the filesystem root
4. the built-in neutral defaults

It never reads an installed skill folder, this one included: an installed skill
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

```js
const BRAND = require('./brand_kit.js').load();
console.log(BRAND._source, BRAND._configPath);
```

`_source` is `'config'` or `'defaults'`. A document built on neutral defaults
when you expected your own colours is the failure this architecture introduces,
and it is invisible in the output — the document looks deliberate either way.
One line in a build script closes it.

## No brand kit yet

Nothing breaks. Every skill in the pack builds against neutral defaults, and
those defaults pass `brand_check.js` clean. Install a kit when you have one.

## No logo

Supported. Set:

```json
"logo":   { "absent": true, "path": null },
"header": { "style": "title-only" }
```

The document header collapses to a single full-width cell and keeps its accent
rule, which is the part that makes a header read as branded. Leaving
`header.style` at `"logo-left"` with no logo is a validation failure rather than
a shrug: an empty logo cell puts an unexplained indent on every page.
