#!/usr/bin/env node
'use strict';
/*
 * check_deps.js — preflight for the brand-kit skill.
 *
 * Run this BEFORE you write a brand.json. It answers one question with an exit
 * code: is everything this skill depends on actually present and usable here?
 *
 * Nothing in the pack is installed: the document skills carry docx inside
 * them, and this skill needs nothing beyond Node's built-ins — brand_check.js
 * is zero-dependency by design. That is exactly why it needs its own
 * preflight. A skill whose whole value is a validator fails in the one way
 * nobody checks for: the validator is not there, or it is there and cannot
 * run.
 *
 * So this checks what CAN be wrong: files missing because the package was
 * copied out of piecemeal rather than installed, a Node too old for the
 * runtime, a package.json that has quietly grown a dependency it is not
 * supposed to have, and the validator's own verdict on the two fixtures
 * shipped to prove it works.
 *
 * Usage:
 *   node check_deps.js            # from the skill folder
 *   node check_deps.js --json
 *
 * Exit codes:
 *   0  everything present and the validator agrees with its own fixtures
 *   1  something is missing — the report names it and the fix
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const asJson = process.argv.includes('--json');
const ROOT = __dirname;

// Every file the package is supposed to carry. SETUP.md's "What's in the
// package" listing is the contract; this is that listing, mechanically.
const BUNDLED_FILES = [
  'SKILL.md',
  'SETUP.md',
  'brand_kit.js',
  'brand_check.js',
  'package.json',
  'LICENSE.txt',
];

// The fixtures brand_check.js is documented against. Without them the two
// verification commands in SETUP.md cannot be run, which makes the install
// unverifiable rather than merely incomplete.
const BUNDLED_FIXTURES = [
  path.join('examples', 'brand-sample', 'brand.json'),
  path.join('examples', 'brand-sample', 'brand-broken.json'),
  path.join('examples', 'brand-sample', 'README.md'),
  path.join('examples', 'brand-sample', 'logo.png'),
  path.join('examples', 'brand-sample', 'logo_untrimmed.png'),
];

// The API surface the other skills in the family require this file for. If
// brand_kit.js stops exporting one of these, every skill that reads a kit
// breaks — and it breaks in their build, not here, which is the wrong place
// to find out.
const REQUIRED_EXPORTS = ['load', 'resolveConfigPath', 'DEFAULTS', 'SEARCH_ORDER', 'SCHEMA_ID', 'CONFIG_NAME'];

// The seven slots a kit declares. The defaults must fill all of them, because
// an un-configured install is a supported state and has to produce a valid
// document rather than a half-coloured one.
const PALETTE_SLOTS = ['ACCENT', 'DACCENT', 'LACCENT', 'LACCENT2', 'ALT_ACCENT', 'GOLD', 'BGLTGOLD'];

// Node built-ins brand_check.js reads the config and decodes the logo PNG
// with. Named explicitly so "zero dependencies" is a checked claim rather
// than a comment.
const REQUIRED_BUILTINS = ['fs', 'path', 'zlib'];

const checks = [];
const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix: ok ? null : fix });

// --- 1. Node version ------------------------------------------------------
const major = parseInt(process.versions.node.split('.')[0], 10);
add('node >= 18', major >= 18, 'found node ' + process.versions.node,
  'Install Node 18 or newer. The rest of the pack requires it and this skill declares it in package.json.');

// --- 2. Bundled files present --------------------------------------------
const missingFiles = BUNDLED_FILES.filter(f => !fs.existsSync(path.join(ROOT, f)));
add('bundled files present', missingFiles.length === 0,
  missingFiles.length ? 'missing: ' + missingFiles.join(', ') : BUNDLED_FILES.join(', '),
  'The skill folder is incomplete — re-install the .skill package into ' + ROOT +
  ' rather than copying files out of it piecemeal.');

// --- 3. Sample fixtures present ------------------------------------------
const missingFixtures = BUNDLED_FIXTURES.filter(f => !fs.existsSync(path.join(ROOT, f)));
add('sample fixtures present', missingFixtures.length === 0,
  missingFixtures.length ? 'missing: ' + missingFixtures.join(', ')
                         : BUNDLED_FIXTURES.length + ' files under examples/brand-sample/',
  'SETUP.md verifies the install by running the validator against these files. Re-install the .skill package into ' + ROOT + '.');

// --- 4. Zero dependencies, still ------------------------------------------
// brand_check.js runs on Node's built-ins alone, on any machine. A dependency
// added here would break that silently, because nothing else in the pack
// would fail.
let declaredDeps = null, pkgErr = null;
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  declaredDeps = Object.keys(pkg.dependencies || {});
} catch (e) { pkgErr = e.message; }
add('zero runtime dependencies', declaredDeps !== null && declaredDeps.length === 0,
  pkgErr ? 'could not read package.json: ' + pkgErr
         : (declaredDeps.length ? 'declares: ' + declaredDeps.join(', ') : 'empty dependency object, as designed'),
  'This skill runs on Node\'s built-ins alone and must stay that way. Remove the dependency from ' +
  path.join(ROOT, 'package.json') + '; nothing in the pack installs anything.');

// --- 5. The built-ins brand_check.js decodes a PNG with -------------------
const missingBuiltins = REQUIRED_BUILTINS.filter(m => {
  try { require(m); return false; } catch (_) { return true; }
});
add('node built-ins resolve', missingBuiltins.length === 0,
  missingBuiltins.length ? 'missing: ' + missingBuiltins.join(', ') : REQUIRED_BUILTINS.join(', '),
  'This runtime is missing a core module. Install a standard Node 18+ distribution.');

// --- 6. brand_kit.js loads and exports the documented API -----------------
let kitmod = null, kitErr = null;
try { kitmod = require(path.join(ROOT, 'brand_kit.js')); }
catch (e) { kitErr = e.message; }

if (kitmod) {
  const missing = REQUIRED_EXPORTS.filter(k => kitmod[k] === undefined);
  add('brand_kit.js exports complete API', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : REQUIRED_EXPORTS.length + ' exports present',
    'brand_kit.js has drifted from the API every other skill in the pack reads a kit through. Re-install the skill into ' + ROOT + '.');

  const pal = (kitmod.DEFAULTS || {}).palette || {};
  const badSlots = PALETTE_SLOTS.filter(k => !/^[0-9A-Fa-f]{6}$/.test(String(pal[k])));
  add('neutral defaults complete', badSlots.length === 0,
    badSlots.length ? 'missing or not 6-hex: ' + badSlots.join(', ')
                    : PALETTE_SLOTS.length + ' palette slots, ACCENT=' + pal.ACCENT + ' GOLD=' + pal.GOLD,
    'An install with no brand.json builds on these. A missing slot produces a half-coloured document rather than an error.');
} else {
  add('brand_kit.js exports complete API', false, 'failed to load: ' + kitErr,
    'brand_kit.js could not be required from ' + ROOT + '. Re-install the skill.');
  add('neutral defaults complete', false, 'skipped — brand_kit.js did not load',
    'Resolve brand_kit.js, then re-run.');
}

// --- 7. The validator runs, and agrees with its own fixtures --------------
// A skill whose hard-fails are enforced by a script it cannot run has prose
// hard-fails, which is the anti-pattern these checks exist to avoid. Here the
// validator IS the product, so "it executes" is not enough: it has to return
// the two verdicts SETUP.md promises. A checker that passes everything is
// worse than no checker, and it would clear a bare does-it-run test.
const VALIDATOR = path.join(ROOT, 'brand_check.js');
const runValidator = (args) => {
  try {
    execFileSync('node', [VALIDATOR].concat(args), { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return 0;
  } catch (e) {
    return typeof e.status === 'number' ? e.status : null;
  }
};

if (fs.existsSync(VALIDATOR)) {
  const usage = runValidator(['--help']);
  add('brand_check.js runs', usage === 2,
    usage === null ? 'could not execute' : 'usage check returns exit ' + usage + (usage === 2 ? ' as designed' : ' (expected 2)'),
    'The validator is not runnable. Do not write a brand.json you could not check. Try:  node ' + VALIDATOR + ' --help');

  if (missingFixtures.length === 0) {
    const good = runValidator([path.join('examples', 'brand-sample', 'brand.json')]);
    add('validator accepts the passing fixture', good === 0,
      good === null ? 'could not execute' : 'exit ' + good + ' (expected 0)',
      'The shipped kit that is supposed to pass does not. Something under ' +
      path.join(ROOT, 'examples', 'brand-sample') + ' has been edited, or the thresholds moved.');

    const bad = runValidator([path.join('examples', 'brand-sample', 'brand-broken.json')]);
    add('validator rejects the broken fixture', bad === 1,
      bad === null ? 'could not execute' : 'exit ' + bad + ' (expected 1)',
      'The validator passed a kit built to fail ten checks, so it is not enforcing anything. Re-install the skill into ' + ROOT + '.');
  } else {
    add('validator accepts the passing fixture', false, 'skipped — fixtures missing',
      'Restore examples/brand-sample/ under ' + ROOT + ', then re-run.');
    add('validator rejects the broken fixture', false, 'skipped — fixtures missing',
      'Restore examples/brand-sample/ under ' + ROOT + ', then re-run.');
  }
} else {
  add('brand_check.js runs', false, 'not present',
    'The validator is the product. Re-install the .skill package into ' + ROOT + '.');
  add('validator accepts the passing fixture', false, 'skipped — validator missing',
    'Restore brand_check.js to ' + ROOT + ', then re-run.');
  add('validator rejects the broken fixture', false, 'skipped — validator missing',
    'Restore brand_check.js to ' + ROOT + ', then re-run.');
}

// --- report ---------------------------------------------------------------
const failed = checks.filter(c => !c.ok);
if (asJson) {
  console.log(JSON.stringify({ root: ROOT, node: process.versions.node, dependencies: declaredDeps, checks, ok: failed.length === 0 }, null, 2));
} else {
  console.log('check_deps — brand-kit');
  console.log('  skill folder: ' + ROOT);
  console.log('');
  for (const c of checks) {
    console.log('  ' + (c.ok ? 'OK  ' : 'FAIL') + '  ' + c.name.padEnd(38) + c.detail);
  }
  console.log('');
  console.log('  Nothing in this pack is installed, this skill included.');
  console.log('  That is why the checks above are about files and verdicts, not packages.');
  console.log('');
  if (failed.length) {
    console.log('  Fix:');
    for (const c of failed) console.log('    - ' + c.name + ': ' + c.fix);
    console.log('');
    console.log('FAIL — ' + failed.length + (failed.length === 1 ? ' check failed' : ' checks failed'));
  } else {
    console.log('PASS — package complete and the validator agrees with its fixtures.');
  }
}
process.exit(failed.length ? 1 : 0);
