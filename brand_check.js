#!/usr/bin/env node
'use strict';
/*
 * brand_check.js — the brand kit validator.
 *
 * A brand kit is a set of colours dropped into slots that the document skills'
 * templates already decided how to use. The buyer picks the colours; this file
 * checks them against the places they actually land — white 8.5pt text on the
 * QRG header fill, a light tint on a dark strip, a logo scaled into each box a
 * document prints it in — and exits non-zero when one of those combinations
 * does not work.
 *
 * Nothing here is a matter of taste. Every violation is a computed number
 * against a stated threshold, and the report prints the number.
 *
 * The checks themselves are brand_rules.js beside this file, the same ones
 * brand_kit.js runs inside every build. This file finds the kit, runs them
 * and prints the report. Zero dependencies: it runs wherever Node runs.
 *
 * Usage:
 *   node brand_check.js                    # brand.json, resolved by search order
 *   node brand_check.js path/to/brand.json
 *   node brand_check.js --json
 *   node brand_check.js --strict           # warnings count as failures
 *
 * Exit codes:
 *   0  no violations
 *   1  one or more violations — the report names each and the fix
 *   2  usage error, or the config could not be found, read or parsed, or its
 *      top level is not a JSON object; --help prints the usage and exits 2
 *   3  the checker itself failed (a value it does not expect, a missing
 *      brand_rules.js or brand_kit.js beside it, or a bug) — the kit was NOT
 *      validated
 *
 * Node's own start-up failures, such as a wrong path to this file, also exit
 * 1, but print no "brand_check —" report. An exit 1 is a set of violations
 * only when the report is there.
 */

const fs = require('fs');
const path = require('path');

const USAGE = [
  'usage: node brand_check.js [path/to/brand.json] [--json] [--strict]',
  '',
  '  With no path, checks the brand.json a document build would read:',
  '  $HPW_BRAND_KIT, then the current folder, then each folder above it.',
  '',
  'exit codes:',
  '  0  no violations (warnings may be present, unless --strict)',
  '  1  one or more violations; the report names each and the fix',
  '  2  usage error or --help, or no brand.json could be found, read or',
  '     parsed, or its top level is not a JSON object',
  '  3  the checker failed (a value it does not expect, a brand_rules.js or',
  '     brand_kit.js beside it that will not load, or a bug); the kit was not validated',
  '',
  '  Node\'s own start-up errors (a wrong path to this file, for one) also exit 1,',
  '  with no "brand_check —" report. Read the report, not only the code.',
].join('\n');

// The checks. A missing brand_rules.js is an incomplete install, never a
// verdict: main() throws it, and the catch around main() exits 3.
let rules = null, rulesErr = null;
try { rules = require(path.join(__dirname, 'brand_rules.js')); } catch (e) { rulesErr = e; }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (rulesErr) {
    const err = new Error('brand_rules.js could not be loaded from ' + __dirname + ' (' + (rulesErr.code || rulesErr.message) +
      '). It ships beside brand_check.js; re-install the skill.');
    err.checkerSetup = true;
    throw err;
  }
  const { checkKit, logoBoxes, kitModule } = rules;
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(2);
  }
  const FLAGS = ['--json', '--strict'];
  const unknown = argv.filter((a) => a.startsWith('-') && !FLAGS.includes(a));
  const positional = argv.filter((a) => !a.startsWith('-'));
  if (unknown.length || positional.length > 1) {
    console.error('brand_check: ' + (unknown.length ? 'unknown option ' + unknown.join(', ')
      : 'one brand.json at a time, got ' + positional.length));
    console.error(USAGE);
    process.exit(2);
  }
  const asJson = argv.includes('--json');
  const strict = argv.includes('--strict');

  // The loader, brand_kit.js. This file uses it only to find the config.
  const kitmod = kitModule();

  // Resolve the config the same way the loader does, so a passing check and a
  // successful build are talking about the same file.
  let configPath = positional[0] ? path.resolve(positional[0]) : null;
  if (!configPath) {
    try {
      configPath = kitmod.resolveConfigPath();
    } catch (e) {
      console.error('brand_check: could not resolve a brand.json — ' + e.message);
      process.exit(2);
    }
  }
  if (!configPath) {
    console.error('brand_check: no brand.json found.');
    console.error('  Pass one explicitly, or run this from a folder that has one.');
    console.error('  A kit is optional — without one the skills use neutral defaults — but');
    console.error('  there is nothing here to check.');
    process.exit(2);
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    console.error('brand_check: ' + configPath);
    console.error('  could not read or parse: ' + e.message);
    process.exit(2);
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    console.error('brand_check: ' + configPath);
    console.error('  is valid JSON but its top level is ' + (Array.isArray(cfg) ? 'an array' : JSON.stringify(cfg)) +
      ', not an object, so it is not a brand kit.');
    process.exit(2);
  }

  const findings = checkKit(cfg, configPath);
  const lg0 = (cfg.logo && typeof cfg.logo === 'object') ? cfg.logo : {};
  const boxes = logoBoxes(lg0.headerCellDxa);
  report(findings, configPath, boxes, asJson, strict);
}

function report(findings, configPath, boxes, asJson, strict) {
  const { T } = rules;
  const violations = findings.filter((f) => f.level === 'VIOLATION');
  const warnings = findings.filter((f) => f.level === 'WARN');
  const passes = findings.filter((f) => f.level === 'PASS');

  if (asJson) {
    console.log(JSON.stringify({
      config: configPath,
      thresholds: T,
      logoBoxes: boxes,
      findings,
      counts: { violations: violations.length, warnings: warnings.length, passes: passes.length },
      ok: violations.length === 0 && (!strict || warnings.length === 0),
    }, null, 2));
  } else {
    console.log('brand_check — ' + configPath);
    console.log('');
    for (const f of passes)     console.log('  OK    ' + f.id.padEnd(24) + f.msg);
    for (const f of warnings)   console.log('  WARN  ' + f.id.padEnd(24) + f.msg);
    for (const f of violations) console.log('  FAIL  ' + f.id.padEnd(24) + f.msg);
    console.log('');
    if (warnings.length) {
      console.log('  Warnings:');
      for (const f of warnings) console.log('    - ' + f.id + ': ' + f.fix);
      console.log('');
    }
    if (violations.length) {
      console.log('  Fix:');
      for (const f of violations) console.log('    - ' + f.id + ': ' + f.fix);
      console.log('');
      console.log('FAIL — ' + violations.length + (violations.length === 1 ? ' violation' : ' violations') +
        ', ' + warnings.length + ' warning' + (warnings.length === 1 ? '' : 's'));
    } else if (strict && warnings.length) {
      console.log('FAIL — 0 violations, ' + warnings.length + ' warning' +
        (warnings.length === 1 ? '' : 's') + ' (--strict)');
    } else {
      // "clean" only when nothing was found at all, warnings included.
      console.log('PASS — ' + (warnings.length ? '' : 'clean. ') + passes.length + ' checks, ' + warnings.length + ' warning' +
        (warnings.length === 1 ? '' : 's') + '.');
    }
  }

  const failed = violations.length > 0 || (strict && warnings.length > 0);
  process.exit(failed ? 1 : 0);
}

module.exports = rules;

// A crash is never a verdict. Exit 1 means "violations, see the report"; a
// failure inside the checker exits 3 and says the kit was not validated.
if (require.main === module) try {
  main();
} catch (e) {
  console.error('brand_check: the checker failed before it finished — the kit was NOT validated (exit 3).');
  if (e && e.checkerSetup) {
    console.error('  ' + e.message);
  } else {
    // inspect() prints an Error's stack and any other thrown value as itself.
    const where = require('util').inspect(e).split('\n').slice(0, 2).map((l) => l.trim()).join(' | ');
    console.error('  ' + where);
    console.error('  A value in the kit is a type this checker does not expect, or this is a bug in it.');
    console.error('  Exit 3 says nothing about the kit either way.');
  }
  process.exit(3);
}
