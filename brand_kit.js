'use strict';
/*
 * brand_kit.js — the config loader every Document Ops skill reads.
 *
 * One brand kit, one read path. A document build calls `load()` once and gets
 * the resolved palette, typography, logo and naming vocabulary, after
 * brand_rules.js's checks have passed on it. The pack's shared facts are
 * defined here once — the naming grammar (NAMING), the palette slots and fixed
 * neutrals, the light ramp and the LACCENT rule, the fallback font and the
 * Arial metrics (FONT), and the colour normalisation (normalizeHex) — so the
 * validator, the builders and the checkers apply the same rules.
 *
 * Zero dependencies, by design: this file is required from inside a document
 * build, and a config loader that can fail on a missing npm package would take
 * the whole build down for a reason that has nothing to do with the config.
 *
 * A build script in a work folder loads it by the installed skill's path:
 *   const BRAND = require(path.join(SKILL_DIR, 'brand_kit.js')).load();
 *
 * Every load that finds a kit runs the checks on it; with no kit there is
 * nothing to check, and the neutral defaults are used. brand_check.js, which
 * ships beside this file, runs the same checks from the command line and
 * prints the report:
 *   node SKILL_DIR/brand_check.js path/to/brand.json
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_ID = 'hpw-brand-kit/1';
const CONFIG_NAME = 'brand.json';

// ---------------------------------------------------------------------------
// Naming grammar — defined once.
//
// Every filename the pack writes starts {PREFIX}_{SEGMENT}_{Topic}_..., and the
// underscore separates the fields, so neither PREFIX nor SEGMENT may contain
// one. brand_check.js and every builder or checker that validates a PREFIX or
// SEGMENT read these two patterns from here rather than keeping their own.
// ---------------------------------------------------------------------------
const NAMING = Object.freeze({
  PREFIX_RE: /^[A-Z][A-Z0-9]{1,7}$/,   // 2-8 characters, starting with a letter
  SEGMENT_RE: /^[A-Z][A-Z0-9]{1,9}$/,  // 2-10 characters, starting with a letter
  // One word of a Title_Case topic: a capital first, hyphens inside a word,
  // underscores between words (Batch_Disposition_Code, Point-of-Sale_Rounding).
  TOPIC_WORD_RE: /^[A-Z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*$/,
  // A change reference: 2-20 uppercase letters, digits and hyphens, at least
  // one digit (CR1042, 2026-114, REQ88).
  REF_RE: /^(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{1,19}$/,
});

// ---------------------------------------------------------------------------
// Palette slots and the fixed neutrals — defined once.
//
// All seven slots are the kit's, GOLD and BGLTGOLD included: a kit carries its
// own attention colour and every document prints it. WHITE, DARK and MID are
// not slots. They are the text colours every template uses, under any kit.
// ---------------------------------------------------------------------------
const PALETTE_SLOTS = Object.freeze(['ACCENT', 'DACCENT', 'LACCENT', 'LACCENT2', 'ALT_ACCENT', 'GOLD', 'BGLTGOLD']);
const FIXED = Object.freeze({ WHITE: 'FFFFFF', DARK: '212121', MID: '555555' });

// The light ramp, darkest first: each slot is lighter (higher L*) than the one
// before it. The LACCENT rule rides on it: LACCENT draws borders and carries no
// text; LACCENT2 is a light fill behind DARK body text, and the one light slot
// that is ever text, on DACCENT (the QRG priority strip). Neither is ever text
// on ACCENT.
const RAMP = Object.freeze(['DACCENT', 'ACCENT', 'LACCENT', 'LACCENT2']);
const LACCENT_RULE =
  'LACCENT draws borders and carries no text. LACCENT2 is a light fill behind body text and the ' +
  'priority-strip text on DACCENT, the one light slot ever printed as text. Neither is ever text on ACCENT.';

// The kit's closed shape: every key a brand.json may hold, by dotted path, and
// the JSON type it holds -- 'any' where a check of its own reads the value. A
// key outside it is read by nothing, so a misspelling ("pth" for "path") would
// pass every other check while the slot it meant went missing. `header` is an
// older kit's section: read by nothing, and let through with all it holds.
const KIT_KEYS = Object.freeze(Object.assign({
  schema: 'any', header: 'any',
  org: 'any', 'org.name': 'any', 'org.shortName': 'string',
  palette: 'any',
  type: 'any', 'type.FONT': 'any', 'type.fallback': 'any',
  logo: 'object', 'logo.path': 'any', 'logo.absent': 'boolean', 'logo.headerCellDxa': 'number',
  naming: 'any', 'naming.PREFIX': 'any', 'naming.SEGMENTS': 'any', 'naming.defaultSegment': 'any',
}, Object.fromEntries(PALETTE_SLOTS.map((s) => ['palette.' + s, 'any']))));

// A kit file's text as JSON. A UTF-8 byte-order mark, which Windows editors
// write, is not part of the kit.
function parseKit(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

// ---------------------------------------------------------------------------
// Fonts and metrics — defined once.
//
// FALLBACK_FONT is the face a document gets when the kit names none. The pack
// measures text (line wraps, the organization name's width) with Arial advance
// widths, the Helvetica AFM values, so a face in METRIC_COMPATIBLE measures
// exactly and any other face is measured as Arial.
// Widths are thousandths of an em.
// ---------------------------------------------------------------------------
const FALLBACK_FONT = 'Arial';
const METRIC_COMPATIBLE = /^(arial|helvetica|liberation sans|arimo|nimbus sans|helvetica neue)$/i;
const ARIAL_ASCII = [   // U+0020-U+007E
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const ARIAL_PUNCT = { 0x00A0: 278, 0x2013: 556, 0x2014: 1000, 0x2018: 222, 0x2019: 222, 0x201C: 333, 0x201D: 333 };
const ARIAL_BOLD_ASCII = [   // U+0020-U+007E
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const ARIAL_BOLD_LATIN1 = [   // U+00A0-U+00FF
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 552,
  400, 549, 333, 333, 333, 576, 556, 333, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 549, 611, 611, 611, 611, 611, 556, 611, 556,
];
const ARIAL_BOLD_PUNCT = { 0x2013: 556, 0x2014: 1000, 0x2018: 278, 0x2019: 278, 0x201C: 500, 0x201D: 500, 0x2026: 1000 };

/**
 * Arial advance width of one code point, in thousandths of an em. CJK, Hangul
 * and full-width forms take a full em. Any other character outside the tables
 * is counted at a digit's width (regular) or a capital's (bold).
 * @param {number} cp
 * @param {boolean} [bold]
 */
function advance(cp, bold) {
  if (cp >= 0x20 && cp <= 0x7E) return (bold ? ARIAL_BOLD_ASCII : ARIAL_ASCII)[cp - 0x20];
  if (bold && cp >= 0xA0 && cp <= 0xFF) return ARIAL_BOLD_LATIN1[cp - 0xA0];
  const punct = bold ? ARIAL_BOLD_PUNCT : ARIAL_PUNCT;
  if (punct[cp] !== undefined) return punct[cp];
  if ((cp >= 0x2E80 && cp <= 0x9FFF) || (cp >= 0xAC00 && cp <= 0xD7AF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFF00 && cp <= 0xFFEF)) return 1000;
  return bold ? 722 : 556;
}
const FONT = Object.freeze({ FALLBACK: FALLBACK_FONT, METRIC_COMPATIBLE, advance });

/**
 * A colour as the document builder takes it: six hex digits, uppercase, no
 * "#". "#2e75b6" and "2E75B6" are the same colour, so both become "2E75B6".
 * Anything that is not six hex digits comes back unchanged, for brand_check.js
 * to report; the builder refuses it ("Invalid hex value").
 * @param {*} v
 * @returns {*}
 */
function normalizeHex(v) {
  if (typeof v !== 'string') return v;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(v.trim());
  return m ? m[1].toUpperCase() : v;
}

// ---------------------------------------------------------------------------
// Neutral defaults
//
// These are the values a document is built with when no brand kit is present.
// They are deliberately unremarkable and deliberately valid — `brand_check.js`
// passes clean against them, every text-on-fill pair included — so that an
// un-configured install produces a correct document rather than a broken one.
// They are not recommendations.
// ---------------------------------------------------------------------------
const DEFAULTS = Object.freeze({
  schema: SCHEMA_ID,
  org: { name: 'Your Organization', shortName: 'Your Organization' },
  palette: {
    ACCENT:     '2E75B6',
    DACCENT:    '1F4E79',
    LACCENT:    '9DC3E6',
    LACCENT2:   'DEEBF7',
    ALT_ACCENT: '6B4C9A',
    GOLD:       '8C6900',
    BGLTGOLD:   'FFF6E0',
  },
  type: { FONT: FALLBACK_FONT },
  logo: { path: null, absent: true, headerCellDxa: 1400 },
  naming: { PREFIX: 'DOC', SEGMENTS: ['OPS'], defaultSegment: 'OPS' },
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function fileAt(p) {
  try { return fs.statSync(p).isFile() ? p : null; } catch (_) { return null; }
}

/**
 * Walk up from `dir` looking for brand.json, to the filesystem root.
 */
function walkUp(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    const hit = fileAt(path.join(cur, CONFIG_NAME));
    if (hit) return hit;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/**
 * Resolve the brand kit path without reading it.
 *
 * A kit lives with the work, not with the skill: in the folder a build runs
 * from, above it, or wherever $HPW_BRAND_KIT points. An installed skill folder
 * is never searched: a read-only install cannot take a file, and no surface
 * guarantees where the skills sit relative to each other.
 * @param {{cwd?:string}} opts
 * @returns {string|null} absolute path, or null when no kit is found
 */
function resolveConfigPath(opts = {}) {
  const cwd = opts.cwd || process.cwd();

  // 1. Explicit override. Accepts a file or a directory containing one.
  const env = process.env.HPW_BRAND_KIT;
  if (env && env.trim()) {
    const raw = path.resolve(env.trim());
    const asFile = fileAt(raw);
    if (asFile) return asFile;
    const asDir = fileAt(path.join(raw, CONFIG_NAME));
    if (asDir) return asDir;
    // A set-but-wrong override is a mistake worth surfacing, not routing
    // around: the buyer said where the kit is and it is not there.
    const err = new Error(
      'HPW_BRAND_KIT is set to "' + env + '" but no ' + CONFIG_NAME + ' was found there.\n' +
      'Point it at a brand.json file or at the folder holding one, or unset it to fall back to the search order.'
    );
    err.code = 'HPW_BRAND_ENV_NOT_FOUND';
    throw err;
  }

  // 2-3. cwd, then up the tree.
  return walkUp(cwd);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function mergeSection(base, override) {
  const out = Object.assign({}, base);
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    for (const k of Object.keys(override)) {
      if (override[k] !== undefined && override[k] !== null) out[k] = override[k];
    }
  }
  return out;
}

/**
 * The resolved kit: the file's sections merged over the defaults, colours
 * normalised, and the derived fields filled in. The same shape whether or not
 * a file was found. A `header` section in an older kit is not read.
 * @param {object|null} parsed  the kit file's contents, or null for defaults
 * @param {string|null} configPath
 */
function assemble(parsed, configPath) {
  const own = parsed || {};
  const kit = {
    schema: SCHEMA_ID,
    org:     mergeSection(DEFAULTS.org, own.org),
    palette: mergeSection(DEFAULTS.palette, own.palette),
    type:    mergeSection(DEFAULTS.type, own.type),
    logo:    mergeSection(DEFAULTS.logo, own.logo),
    naming:  mergeSection(DEFAULTS.naming, own.naming),
  };

  // Builds get bare uppercase hex whatever case or "#" the kit was written in.
  for (const slot of Object.keys(kit.palette)) kit.palette[slot] = normalizeHex(kit.palette[slot]);

  if (Array.isArray(kit.naming.SEGMENTS)) kit.naming.SEGMENTS = kit.naming.SEGMENTS.slice();

  // A kit that lists its own segments and names no default files under the
  // first of them, never under the built-in "OPS" it may not have.
  const ownNaming = (own.naming && typeof own.naming === 'object') ? own.naming : {};
  if ((ownNaming.defaultSegment === undefined || ownNaming.defaultSegment === null) &&
      Array.isArray(ownNaming.SEGMENTS) && ownNaming.SEGMENTS.length) {
    kit.naming.defaultSegment = ownNaming.SEGMENTS[0];
  }

  // The short form falls back to the kit's own name, never to the default's:
  // the QRG header prints the short form.
  const ownShort = own.org && own.org.shortName;
  if (typeof ownShort !== 'string' || !ownShort.trim()) kit.org.shortName = kit.org.name;

  // A logo path in the config is relative to the config, not to whatever
  // directory the build script happens to be run from. No logo: null --
  // `absent: true` or any empty path (null, "", false, 0) means no logo. Any
  // other path that is not a string never gets here: verify() refuses it as
  // brand_rules.js's logo.path before a kit is assembled.
  const lp = kit.logo.path;
  if (kit.logo.absent === true || !lp) {
    kit.logo.resolvedPath = null;
  } else {
    kit.logo.resolvedPath = path.isAbsolute(lp) ? lp : path.resolve(path.dirname(configPath), lp);
  }

  kit._source = parsed ? 'config' : 'defaults';
  kit._configPath = parsed ? configPath : null;
  return kit;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

let announced = false;
/** Say once per process, on stderr, that no kit was found. */
function announceDefaults() {
  if (announced) return;
  announced = true;
  process.stderr.write('brand kit: none found — building with neutral defaults (organization "' +
    DEFAULTS.org.name + '", naming ' + DEFAULTS.naming.PREFIX + '_' + DEFAULTS.naming.defaultSegment +
    '). Put a brand.json in the folder you build from, or set HPW_BRAND_KIT to one.\n');
}

/**
 * Run brand_rules.js's checks on a parsed kit, and throw when any fails. The
 * kit is checked where it is used, so a kit edited by hand after the brand:
 * intake cannot build a document that the validator would have refused.
 */
function verify(parsed, configPath) {
  // brand_check.js ships beside this file in every skill that carries it, so
  // the command is named by this file's own folder, found when it runs.
  const checkCmd = 'node "' + path.join(__dirname, 'brand_check.js') + '" "' + configPath + '"';
  let findings;
  try {
    findings = require('./brand_rules.js').checkKit(parsed, configPath);
  } catch (e) {
    const err = new Error('brand kit at ' + configPath + ' could not be validated: ' + e.message + '\n' +
      'Not building with an unvalidated kit. For the details, run: ' + checkCmd);
    err.code = 'HPW_BRAND_UNCHECKED';
    throw err;
  }
  const failed = findings.filter((f) => f.level === 'VIOLATION');
  if (failed.length) {
    const err = new Error('brand kit at ' + configPath + ' fails brand_check — ' + failed.length +
      (failed.length === 1 ? ' violation: ' : ' violations: ') + failed.map((f) => f.id).join(', ') + '.\n' +
      'Not building with it: a document in colours or names the kit check refuses would report success. ' +
      'For the fix to each, run: ' + checkCmd);
    err.code = 'HPW_BRAND_CHECK_FAILED';
    err.failed = failed.map((f) => f.id);
    throw err;
  }
}

/**
 * Load the brand kit.
 *
 * Absent config → the neutral defaults, with one line on stderr saying so.
 * That is the documented un-configured state and it produces a correct
 * document; the line is there so nobody mistakes it for their own brand.
 *
 * Present but unreadable, unparseable, wrong-schema, or failing brand_check →
 * throws. A build that silently falls back to neutral defaults because the
 * buyer's config had a trailing comma, or builds in colours the validator
 * refuses, ships a wrong document and says nothing, which is the exact failure
 * this pack exists to prevent.
 *
 * @param {{cwd?:string}} opts
 * @returns {object} the merged kit, plus `_source` and `_configPath`
 */
function load(opts = {}) {
  const configPath = resolveConfigPath(opts);

  if (!configPath) { announceDefaults(); return assemble(null, null); }

  // A kit that cannot be read and one that is not JSON are the same stop:
  // the message carries the file and the reason, the parse position or the
  // OS error.
  let parsed;
  try {
    parsed = parseKit(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    const err = new Error(
      'brand kit at ' + configPath + ' could not be read as JSON: ' + e.message + '\n' +
      'Not falling back to defaults — a build in the wrong colours that reports success is worse than a build that stops.'
    );
    err.code = 'HPW_BRAND_MALFORMED';
    throw err;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('brand kit at ' + configPath + ' is valid JSON but not an object, so it is not a brand kit.');
    err.code = 'HPW_BRAND_MALFORMED';
    throw err;
  }

  if (parsed.schema !== SCHEMA_ID) {
    const err = new Error(
      'brand kit at ' + configPath + ' declares schema "' + parsed.schema + '", expected "' + SCHEMA_ID + '".\n' +
      'A kit written for a different schema version may have slots this build does not read.'
    );
    err.code = 'HPW_BRAND_SCHEMA';
    throw err;
  }

  verify(parsed, configPath);
  return assemble(parsed, configPath);
}

module.exports = {
  load, resolveConfigPath, normalizeHex, NAMING, DEFAULTS, SCHEMA_ID, CONFIG_NAME,
  PALETTE_SLOTS, FIXED, RAMP, LACCENT_RULE, FONT, KIT_KEYS, parseKit,
};
