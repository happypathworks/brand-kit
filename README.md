# brand-kit

A Claude skill that captures an organization's visual identity and
document-naming vocabulary into one validated `brand.json`: palette, typeface,
logo, header style, and the prefix and segments documents are filed under.
Document skills read the kit to build in your colors. `action-list` is one.

Free, MIT. Node 18 or later, and nothing else: the loader and the validator use
only Node's built-ins.

## The gap it closes

Ask a model to set up branding from a brand guide and it takes the colors at
face value. They are judged as swatches, side by side on a white ground, and
then dropped into slots that already decided how they get used: small tinted
text on a header fill, white text on an accent bar. Three failures follow, and
none of them raise an error when a document builds.

1. **Contrast collapses at the point of use.** A mid-tone accent that looks
   confident in a swatch cannot carry white or tinted small print. The document
   builds and prints; the header is simply hard to read.
2. **The second-path color is a shade, not a hue.** Two close tints on the two
   halves of a decision block read as one path with a rendering fault.
3. **The naming vocabulary gets no scrutiny.** Prefix and segment are filename
   fields split by underscores. An underscore inside one shifts every field
   after it.

None of the three is a judgement call. Each is a number against a threshold,
and `brand_check.js` computes all of them and exits non-zero.

## What it refuses

- **A kit that fails the check is never written.** Not written with a caveat:
  a saved kit is one every later build reads without asking.
- **Your colors are not moved without asking.** When a supplied color fails,
  it reports the measured ratio and the threshold, and offers the nearest
  passing shade of the same hue. "The client approved these colors" does not
  change the number. There is no override flag.
- **It does not design a brand.** With no existing identity, it says so and
  offers to build on neutral defaults until one exists.
- **It does not convert a logo silently.** Given an SVG, PDF or JPEG, it says
  what conversion is needed and why a PNG with transparency is what gets
  embedded.

## Deciding example

`examples/brand-sample/brand-broken.json` is a kit that looks fine as a set of
swatches.

    node brand_check.js examples/brand-sample/brand-broken.json

Each FAIL line it prints is a failure a printed document would carry
without complaint, and the exit code is 1. `examples/brand-sample/README.md` explains
what each one would have looked like on the page. `brand.json` beside it is a
kit that passes clean.

## Install

Put the whole folder where your Claude surface keeps skills, as `brand-kit/`:

- Claude Code, for you on this machine: `~/.claude/skills/brand-kit/`
- Claude Code, for one project: `PROJECT/.claude/skills/brand-kit/`
- The claude.ai web app, Cowork and the desktop app: zip the folder and add it
  to your claude.ai account as a skill.

Then check it where it will run:

    node brand-kit/check_deps.js

Expected: `PASS` and exit 0. It confirms the files are present and that the
validator agrees with its own examples.

`SETUP.md` has the rest: where to put the kit so builds find it, the
no-logo setup, and how to check which kit a build actually used.

## Use

| Message | What happens |
|---|---|
| `brand:` | The full intake. Produces `brand.json` and a trimmed logo. |
| `brand: check` | Validates the kit a build would find. Report only. |
| `brand: recheck PATH` | Validates a specific `brand.json`. Report only. |

No kit is a supported state, not an error: documents build in neutral
defaults, and the defaults pass the check.

## License

MIT. `LICENSE.txt` states two sets of terms because it ships unchanged in every
skill in the catalog, some of which are sold; its section 1 names this one as
free, and section 2 is the MIT text.

## Who makes this

Happy Path Works builds Claude skills as systems: explicit triggers, enforced
hard-fails, stated scope boundaries, a worked example per skill.

Changes to this skill, and the next ones as they ship, go out on the list:
[happypathworks.beehiiv.com](https://happypathworks.beehiiv.com/subscribe?utm_source=brand-kit).

Questions and bug reports: hello@happypath.works

## Independence and AI assistance

Happy Path Works is an independent project. It is **not affiliated with,
endorsed by, or sponsored by Anthropic**. Claude, Claude Code and Anthropic are
trademarks of Anthropic PBC, used here only to describe what this skill works
with. You need your own Claude access; nothing here resells it.

This skill and its documentation are developed with AI assistance, and a human
reviews everything before it ships.
