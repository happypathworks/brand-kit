'use strict';
/*
 * brand_kit.js — the config loader every Document Ops skill reads.
 *
 * One brand kit, one read path. `sop_helpers.js` calls `load()` at require
 * time and hands the resolved palette, typography, and naming vocabulary to
 * every build script that imports it. Nothing else in the pack reads
 * `brand.json` directly.
 *
 * Zero dependencies, by design: this file is required from inside a document
 * build, and a config loader that can fail on a missing npm package would take
 * the whole build down for a reason that has nothing to do with the config.
 *
 * This file is shipped byte-identical in every skill that consumes a brand
 * kit, the same way `sop_helpers.js` is. If two copies diverge, two skills
 * disagree about what the buyer's brand is, and the drift shows up as a colour
 * mismatch between a SOP and its own QRG.
 *
 *   const BRAND = require('./brand_kit.js').load();
 *
 * Validate a kit before building against it:
 *   node brand_check.js path/to/brand.json
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_ID = 'hpw-brand-kit/1';
const CONFIG_NAME = 'brand.json';

// ---------------------------------------------------------------------------
// Neutral defaults
//
// These are the values a document is built with when no brand kit is present.
// They are deliberately unremarkable and deliberately valid — `brand_check.js`
// passes clean against them — so that an un-configured install produces a
// correct document rather than a broken one. They are not recommendations.
// ---------------------------------------------------------------------------
const DEFAULTS = Object.freeze({
  schema: SCHEMA_ID,
  org: { name: 'Your Organization', shortName: 'Your Organization' },
  palette: {
    // Every value here clears WCAG AA at each of the fourteen text-on-fill
    // combinations the pack's templates create; `brand_check.js` passes clean
    // against this object and `brand_check_acceptance.js` asserts it still
    // does.
    //
    // GOLD is the one value that had to move: white on the superseded gold
    // was 2.94:1, and it fills the infoBox header bar under white text. 8C6900
    // is 5.08:1 and reads as the same colour at a glance. The superseded value
    // is not named here: it is an employer template value and is on the deny
    // list as of dl-hpw-v6 (Decision 91).
    //
    // The blues are unchanged, but only because the QRG header now prints its
    // subtitle, organization name, and date in WHITE. When those three ran in
    // LACCENT/LACCENT2 they measured 2.62:1 and 4.00:1 on this accent — a
    // brand cannot supply a tint of its own primary that is readable ON that
    // primary at 8.5pt, and darkening the accent far enough to allow it turns
    // every document navy. LACCENT and LACCENT2 are borders and fills here,
    // not text on the accent; the L* ramp check is what still constrains them.
    ACCENT:     '2E75B6',
    DACCENT:    '1F4E79',
    LACCENT:    '9DC3E6',
    LACCENT2:   'DEEBF7',
    ALT_ACCENT: '6B4C9A',
    GOLD:       '8C6900',
    BGLTGOLD:   'FFF6E0',
  },
  // No fallback slot. A .docx names its font and carries no substitute: Word
  // and LibreOffice both ignore the font table's altName (measured, Decision
  // 133), so a declared fallback was a promise no document could keep.
  type: { FONT: 'Arial' },
  logo: { path: null, absent: true, headerCellDxa: 1400 },
  header: { style: 'title-only', rule: 'accent' },
  naming: { PREFIX: 'DOC', SEGMENTS: ['OPS'], defaultSegment: 'OPS' },
});

/**
 * The search order, in words, for the SETUP guide and for error messages.
 * Kept next to the implementation so the two cannot drift.
 */
const SEARCH_ORDER = [
  'the path in $HPW_BRAND_KIT, if that variable is set',
  'brand.json in the current working directory',
  'brand.json in any parent directory, walking up to the filesystem root',
  'the built-in neutral defaults',
];

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function fileAt(p) {
  try { return fs.statSync(p).isFile() ? p : null; } catch (_) { return null; }
}

/**
 * Walk up from `dir` looking for brand.json. Stops at the filesystem root.
 * Bounded at 40 levels so a pathological symlink loop cannot hang a build.
 */
function walkUp(dir) {
  let cur = path.resolve(dir);
  for (let i = 0; i < 40; i++) {
    const hit = fileAt(path.join(cur, CONFIG_NAME));
    if (hit) return hit;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/**
 * Resolve the brand kit path without reading it.
 *
 * A kit lives with the work, not with the skill: in the folder a build runs
 * from, above it, or wherever $HPW_BRAND_KIT points. Two lookups used to
 * follow the tree walk — brand.json inside the installed skill folder, then
 * inside a sibling brand-kit/ folder — and both are gone. The first asked the
 * buyer to place a file by hand into an installed skill, which a read-only
 * install cannot take. The second needed the skills to sit side by side in
 * one parent, a layout only a hand-built local install guarantees. Neither
 * holds on every surface the pack ships to.
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
  if (override && typeof override === 'object') {
    for (const k of Object.keys(override)) {
      if (override[k] !== undefined && override[k] !== null) out[k] = override[k];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load the brand kit.
 *
 * Absent config → the neutral defaults, quietly. That is the documented
 * un-configured state and it produces a correct document.
 *
 * Present but unreadable, unparseable, or wrong-schema → throws. A build that
 * silently falls back to neutral defaults because the buyer's config had a
 * trailing comma ships a document in the wrong colours and says nothing, which
 * is the exact failure this pack exists to prevent.
 *
 * @param {{cwd?:string, path?:string}} opts
 * @returns {object} the merged kit, plus `_source` and `_configPath`
 */
function load(opts = {}) {
  const configPath = opts.path ? path.resolve(opts.path) : resolveConfigPath(opts);

  if (!configPath) {
    return Object.assign({}, DEFAULTS, { _source: 'defaults', _configPath: null });
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    const err = new Error('brand kit found at ' + configPath + ' but could not be read: ' + e.message);
    err.code = 'HPW_BRAND_UNREADABLE';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new Error(
      'brand kit at ' + configPath + ' is not valid JSON: ' + e.message + '\n' +
      'Run:  node brand_check.js "' + configPath + '"   for a line-level report.\n' +
      'Not falling back to defaults — a build in the wrong colours that reports success is worse than a build that stops.'
    );
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

  const kit = {
    schema: SCHEMA_ID,
    org:     mergeSection(DEFAULTS.org, parsed.org),
    palette: mergeSection(DEFAULTS.palette, parsed.palette),
    type:    mergeSection(DEFAULTS.type, parsed.type),
    logo:    mergeSection(DEFAULTS.logo, parsed.logo),
    header:  mergeSection(DEFAULTS.header, parsed.header),
    naming:  mergeSection(DEFAULTS.naming, parsed.naming),
  };

  // The short form falls back to the kit's own name, never to the default's.
  // Merging section by section let a kit that set only `name` inherit
  // "Your Organization" as its short form, and the QRG header prints the
  // short form.
  const ownShort = parsed.org && parsed.org.shortName;
  if (typeof ownShort !== 'string' || !ownShort.trim()) kit.org.shortName = kit.org.name;

  // A logo path in the config is relative to the config, not to whatever
  // directory the build script happens to be run from.
  if (kit.logo.path && !path.isAbsolute(kit.logo.path)) {
    kit.logo.resolvedPath = path.resolve(path.dirname(configPath), kit.logo.path);
  } else if (kit.logo.path) {
    kit.logo.resolvedPath = kit.logo.path;
  } else {
    kit.logo.resolvedPath = null;
  }

  kit._source = 'config';
  kit._configPath = configPath;
  return kit;
}

module.exports = { load, resolveConfigPath, DEFAULTS, SEARCH_ORDER, SCHEMA_ID, CONFIG_NAME };
