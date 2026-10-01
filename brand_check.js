#!/usr/bin/env node
'use strict';
/*
 * brand_check.js — the brand kit validator.
 *
 * A brand kit is a set of colours dropped into slots that other people's
 * templates already decided how to use. The buyer picks the colours; this file
 * checks them against the places they are actually going to land — white 8.5pt
 * text on the header fill, a light tint on a dark strip, a logo in a 1400 DXA
 * cell — and exits non-zero when one of those combinations does not work.
 *
 * Nothing here is a matter of taste. Every violation is a computed number
 * against a stated threshold, and the report prints the number.
 *
 * Zero dependencies. Reads the config and the logo file directly, so it runs
 * wherever Node runs, with nothing installed.
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
 *   2  usage error, or the config could not be read or parsed
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// Thresholds — declared once, printed in every message that uses one.
// ---------------------------------------------------------------------------
const T = {
  CONTRAST_BODY: 4.5,      // WCAG 2.2 AA, text below 18pt / 14pt bold
  CONTRAST_LARGE: 3.0,     // WCAG 2.2 AA, large text
  DE_ALT_ACCENT: 25,       // CIE76 dE*ab, ACCENT vs ALT_ACCENT
  HUE_ALT_ACCENT: 30,      // degrees in CIE LCh, ACCENT vs ALT_ACCENT
  DE_ACHROMATIC_ALT: 40,   // dE required instead of hue when either is near-grey
  CHROMA_ACHROMATIC: 10,   // C* below this is treated as grey; hue is meaningless
  DE_GOLD: 20,             // GOLD must not read as the accent
  HUE_GOLD_MIN: 40,        // ...and must not sit in the accent's hue family (warn)
  DE_DACCENT_MIN: 8,       // DACCENT must be visibly distinct from ACCENT
  HUE_DACCENT_MAX: 40,     // ...but it is a darker PAIR, not a second colour (warn)
  LOGO_MIN_DPI: 150,       // effective resolution once scaled into the header cell
  LOGO_ASPECT_MAX: 6.0,    // wider than 6:1 overflows the header cell's height budget
  LOGO_ASPECT_MIN: 0.33,   // taller than 1:3 forces a header row nothing else uses
  LOGO_TRIM_PCT: 2.0,      // uniform border wider than this means it was not trimmed
  ORG_NAME_MAX: 48,        // the QRG header's right cell
};

const SCHEMA_ID = 'hpw-brand-kit/1';

// ---------------------------------------------------------------------------
// Colour maths — sRGB -> linear -> XYZ (D65) -> CIELAB -> LCh
// ---------------------------------------------------------------------------

const HEX_RE = /^[0-9A-F]{6}$/;

function toRgb(hex) {
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. Note the 0.03928 cutoff — this is the WCAG curve. */
function relLuminance(hex) {
  const lin = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function toXyz(hex) {
  const lin = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = lin;
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  ];
}

function toLab(hex) {
  // D65 reference white.
  const WX = 0.95047, WY = 1.00000, WZ = 1.08883;
  const [X, Y, Z] = toXyz(hex);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X / WX), fy = f(Y / WY), fz = f(Z / WZ);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function toLch(hex) {
  const [L, a, b] = toLab(hex);
  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

/** CIE76 dE*ab. Named explicitly because CIE76 and CIEDE2000 disagree. */
function deltaE76(a, b) {
  const A = toLab(a), B = toLab(b);
  return Math.sqrt(
    Math.pow(A[0] - B[0], 2) + Math.pow(A[1] - B[1], 2) + Math.pow(A[2] - B[2], 2)
  );
}

/** Shortest angular distance between two hues, in degrees, 0-180. */
function hueDelta(a, b) {
  const d = Math.abs(toLch(a).h - toLch(b).h) % 360;
  return d > 180 ? 360 - d : d;
}

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// PNG decode — enough of it to find the content bounding box.
//
// Only zlib, which is built in. Supports bit depth 8, colour types 0/2/3/4/6,
// non-interlaced. Anything else is skipped with a named warning rather than
// guessed at.
// ---------------------------------------------------------------------------

function readPng(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    return { ok: false, reason: 'not a PNG (missing 89 50 4E 47 signature)' };
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    return { ok: false, reason: 'first chunk is not IHDR' };
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];

  const meta = { ok: true, width, height, bitDepth, colorType, interlace };

  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(colorType)) {
    meta.pixels = null;
    meta.skipReason =
      'bit depth ' + bitDepth + ', colour type ' + colorType +
      (interlace ? ', interlaced' : '') + ' — outside the subset this checker decodes';
    return meta;
  }

  // Walk the chunks: collect IDAT, and PLTE/tRNS for palette images.
  let off = 8;
  const idat = [];
  let plte = null, trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    if (dataStart + len > buf.length) break;
    if (type === 'IDAT') idat.push(buf.subarray(dataStart, dataStart + len));
    else if (type === 'PLTE') plte = buf.subarray(dataStart, dataStart + len);
    else if (type === 'tRNS') trns = buf.subarray(dataStart, dataStart + len);
    else if (type === 'IEND') break;
    off = dataStart + len + 4; // + CRC
  }
  if (!idat.length) { meta.pixels = null; meta.skipReason = 'no IDAT chunk found'; return meta; }

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); }
  catch (e) { meta.pixels = null; meta.skipReason = 'IDAT would not inflate: ' + e.message; return meta; }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = channels;                 // bit depth 8 only
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) {
    meta.pixels = null;
    meta.skipReason = 'decompressed data is shorter than the declared image';
    return meta;
  }

  // Undo the per-scanline filters.
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          meta.pixels = null;
          meta.skipReason = 'unknown scanline filter ' + ft;
          return meta;
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }

  // Normalise to RGBA so the bbox pass has one shape to reason about.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    const s = i * bpp;
    if (colorType === 0) { r = g = b = out[s]; }
    else if (colorType === 4) { r = g = b = out[s]; a = out[s + 1]; }
    else if (colorType === 2) { r = out[s]; g = out[s + 1]; b = out[s + 2]; }
    else if (colorType === 6) { r = out[s]; g = out[s + 1]; b = out[s + 2]; a = out[s + 3]; }
    else { // palette
      const idx = out[s];
      if (!plte || idx * 3 + 2 >= plte.length) { r = g = b = 0; }
      else { r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2]; }
      if (trns && idx < trns.length) a = trns[idx];
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }

  meta.pixels = rgba;
  return meta;
}

/**
 * The bounding box of non-background pixels.
 *
 * Background means transparent where there is an alpha channel, and otherwise
 * "the same colour as the four corners" — which is how an untrimmed export
 * actually looks. If the corners disagree with each other the image has no
 * uniform ground and the trim question does not apply.
 */
function contentBox(px, w, h) {
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const anyAlpha = corners.some((c) => c[3] < 250);

  let isBg;
  if (anyAlpha) {
    isBg = (p) => p[3] < 16;
  } else {
    const c0 = corners[0];
    const same = corners.every((c) =>
      Math.abs(c[0] - c0[0]) <= 4 && Math.abs(c[1] - c0[1]) <= 4 && Math.abs(c[2] - c0[2]) <= 4);
    if (!same) return null; // no uniform ground; nothing to trim against
    isBg = (p) =>
      Math.abs(p[0] - c0[0]) <= 8 && Math.abs(p[1] - c0[1]) <= 8 && Math.abs(p[2] - c0[2]) <= 8;
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBg(at(x, y))) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { empty: true };
  return { minX, minY, maxX, maxY, empty: false };
}

// ---------------------------------------------------------------------------
// The findings list
// ---------------------------------------------------------------------------

const findings = [];
const violation = (id, msg, fix) => findings.push({ level: 'VIOLATION', id, msg, fix });
const warn = (id, msg, fix) => findings.push({ level: 'WARN', id, msg, fix });
const pass = (id, msg) => findings.push({ level: 'PASS', id, msg, fix: null });

// ---------------------------------------------------------------------------
// The contrast pairs.
//
// Every entry is a place one of the shipped skills puts text on a fill. This
// list is the reason the checker is worth running: the buyer picks a colour
// looking at it on its own, and these are the fourteen combinations that
// colour is about to be used in.
// ---------------------------------------------------------------------------
const PAIRS = [
  // The four header runs are listed separately even though they now share a
  // foreground: they are four distinct text runs at four sizes, the report
  // names the one that broke, and if a future design puts a tint back on the
  // accent the check is already sitting where it needs to be.
  { id: 'hdr.title',    fg: 'WHITE',    bg: 'ACCENT',     size: 'body',  where: 'QRG header — document title, 13pt bold' },
  { id: 'hdr.subtitle', fg: 'WHITE',    bg: 'ACCENT',     size: 'body',  where: 'QRG header — subtitle, 8.5pt' },
  { id: 'hdr.org',      fg: 'WHITE',    bg: 'ACCENT',     size: 'body',  where: 'QRG header — organization name, 8.5pt bold' },
  { id: 'hdr.date',     fg: 'WHITE',    bg: 'ACCENT',     size: 'body',  where: 'QRG header — effective date, 7.5pt' },
  { id: 'strip.label',  fg: 'WHITE',    bg: 'DACCENT',    size: 'body',  where: 'priority strip — leading label, bold' },
  { id: 'strip.body',   fg: 'LACCENT2', bg: 'DACCENT',    size: 'body',  where: 'priority strip — the sequence text' },
  { id: 'tbl.header',   fg: 'WHITE',    bg: 'DACCENT',    size: 'body',  where: 'every data table header row (hcell), 8.5pt bold' },
  { id: 'path.a',       fg: 'WHITE',    bg: 'ACCENT',     size: 'body',  where: 'QRG decision block — primary path header' },
  { id: 'path.b',       fg: 'WHITE',    bg: 'ALT_ACCENT', size: 'body',  where: 'QRG decision block — alternate path header' },
  { id: 'postaction',   fg: 'DARK',     bg: 'LACCENT2',   size: 'body',  where: 'QRG post-action block — body text on the tint' },
  { id: 'label.section',fg: 'ACCENT',   bg: 'WHITE',      size: 'body',  where: 'section labels on the page ground, 8.5pt bold' },
  { id: 'head.doc',     fg: 'DACCENT',  bg: 'WHITE',      size: 'body',  where: 'SOP header — document title on the page ground' },
  { id: 'info.head',    fg: 'WHITE',    bg: 'GOLD',       size: 'body',  where: 'infoBox header bar' },
  { id: 'info.body',    fg: 'DARK',     bg: 'BGLTGOLD',   size: 'body',  where: 'infoBox body text on its fill' },
  { id: 'purpose.label',fg: 'GOLD',     bg: 'WHITE',      size: 'body',  where: 'PURPOSE accent-bar block — label on the page ground' },
];

// Fixed structural colours the pairs above refer to. These are not brand slots
// — they are the neutral text colours sop_helpers.js declares.
const FIXED = { WHITE: 'FFFFFF', DARK: '212121', MID: '555555' };

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const strict = argv.includes('--strict');
  const positional = argv.filter((a) => !a.startsWith('--'));

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node brand_check.js [path/to/brand.json] [--json] [--strict]');
    process.exit(2);
  }

  // Resolve the config the same way the loader does, so a passing check and a
  // successful build are talking about the same file.
  let configPath = positional[0] ? path.resolve(positional[0]) : null;
  if (!configPath) {
    try {
      const kitmod = require(path.join(__dirname, 'brand_kit.js'));
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
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('brand_check: ' + configPath);
    console.error('  could not read or parse: ' + e.message);
    process.exit(2);
  }

  // --- schema -------------------------------------------------------------
  if (cfg.schema !== SCHEMA_ID) {
    violation('schema.id',
      'schema is ' + JSON.stringify(cfg.schema) + ', expected "' + SCHEMA_ID + '"',
      'Set "schema": "' + SCHEMA_ID + '" at the top level.');
  } else {
    pass('schema.id', SCHEMA_ID);
  }

  const P = (cfg.palette && typeof cfg.palette === 'object') ? cfg.palette : {};
  const SLOTS = ['ACCENT', 'DACCENT', 'LACCENT', 'LACCENT2', 'ALT_ACCENT', 'GOLD', 'BGLTGOLD'];

  // --- colour format ------------------------------------------------------
  // docx takes bare uppercase hex. A leading '#' does not error; it produces a
  // fill the renderer cannot parse, and the cell comes out unshaded.
  let formatOk = true;
  for (const slot of SLOTS) {
    const v = P[slot];
    if (v === undefined) {
      violation('palette.missing.' + slot, 'palette.' + slot + ' is not set',
        'Add "' + slot + '" to palette. All seven slots are required — there is no partial kit.');
      formatOk = false;
    } else if (typeof v !== 'string' || !HEX_RE.test(v)) {
      violation('palette.format.' + slot,
        'palette.' + slot + ' is ' + JSON.stringify(v) + ' — not six uppercase hex digits',
        'Write it as RRGGBB with no "#" and no lowercase: e.g. "2E75B6". docx does not ' +
        'reject a malformed fill, it renders the cell unshaded, so this never surfaces at build time.');
      formatOk = false;
    }
  }
  if (formatOk) pass('palette.format', 'all seven slots are well-formed six-digit uppercase hex');

  // Everything below needs parseable colours.
  if (formatOk) {
    const C = Object.assign({}, FIXED, P);

    // --- contrast ---------------------------------------------------------
    let worst = null;
    for (const pr of PAIRS) {
      const fg = C[pr.fg], bg = C[pr.bg];
      const ratio = contrastRatio(fg, bg);
      const need = pr.size === 'large' ? T.CONTRAST_LARGE : T.CONTRAST_BODY;
      if (!worst || ratio < worst.ratio) worst = { ratio, id: pr.id };
      if (ratio < need) {
        // Name the slot the buyer can actually move. WHITE, DARK and MID are
        // fixed text colours the templates use everywhere; telling someone to
        // "lighten WHITE" is how a checker loses their trust in one line.
        let fix;
        if (FIXED[pr.fg] !== undefined && FIXED[pr.bg] === undefined) {
          fix = 'Adjust ' + pr.bg + '. ' + pr.fg + ' is a fixed text colour, not a brand slot — ' +
                'the fill is the only side of this you can move.';
        } else if (FIXED[pr.bg] !== undefined && FIXED[pr.fg] === undefined) {
          fix = 'Darken ' + pr.fg + '. It is being printed on the page ground, where a mid-tone ' +
                'brand colour that looks confident on screen goes weak on paper.';
        } else {
          fix = 'Move ' + pr.bg + ' away from ' + pr.fg + ' in lightness.';
        }
        violation('contrast.' + pr.id,
          pr.fg + ' on ' + pr.bg + ' is ' + r2(ratio) + ':1, below ' + need + ':1  (' + pr.where + ')',
          fix + ' This is the place that colour actually lands in a built document; a swatch will not show you this.');
      }
    }
    if (!findings.some((f) => f.level === 'VIOLATION' && f.id.startsWith('contrast.'))) {
      pass('contrast', 'all ' + PAIRS.length + ' text-on-fill pairs clear ' + T.CONTRAST_BODY +
        ':1  (tightest: ' + worst.id + ' at ' + r2(worst.ratio) + ':1)');
    }

    // --- lightness ordering ----------------------------------------------
    const L = {};
    for (const s of SLOTS) L[s] = toLch(C[s]).L;

    if (!(L.DACCENT < L.ACCENT)) {
      violation('order.daccent',
        'DACCENT L*=' + r1(L.DACCENT) + ' is not darker than ACCENT L*=' + r1(L.ACCENT),
        'DACCENT is the darker member of the pair — it fills table header rows that ACCENT sits ' +
        'above. Swap them, or darken DACCENT.');
    } else if (!(L.ACCENT < L.LACCENT && L.LACCENT < L.LACCENT2)) {
      violation('order.light',
        'the light ramp is out of order: ACCENT L*=' + r1(L.ACCENT) +
        ', LACCENT L*=' + r1(L.LACCENT) + ', LACCENT2 L*=' + r1(L.LACCENT2),
        'LACCENT is a tint of ACCENT and LACCENT2 is a tint of LACCENT. The ramp must ascend ' +
        'in L*, or the header subtitle reads darker than the fill it sits on.');
    } else {
      pass('order', 'L* ramp ascends: DACCENT ' + r1(L.DACCENT) + ' < ACCENT ' + r1(L.ACCENT) +
        ' < LACCENT ' + r1(L.LACCENT) + ' < LACCENT2 ' + r1(L.LACCENT2));
    }

    // --- ALT_ACCENT distinctness -----------------------------------------
    const dAlt = deltaE76(C.ACCENT, C.ALT_ACCENT);
    const hAlt = hueDelta(C.ACCENT, C.ALT_ACCENT);
    const chromaA = toLch(C.ACCENT).C;
    const chromaB = toLch(C.ALT_ACCENT).C;
    const achromatic = chromaA < T.CHROMA_ACHROMATIC || chromaB < T.CHROMA_ACHROMATIC;

    if (achromatic) {
      if (dAlt < T.DE_ACHROMATIC_ALT) {
        violation('alt.distance',
          'ALT_ACCENT is dE*ab ' + r1(dAlt) + ' from ACCENT, below ' + T.DE_ACHROMATIC_ALT +
          ' (one of them is near-neutral, C*=' + r1(Math.min(chromaA, chromaB)) + ', so hue cannot separate them)',
          'ALT_ACCENT signals "this is the other path". Pick something further away in lightness.');
      } else {
        pass('alt.distance', 'ALT_ACCENT separated from ACCENT by dE*ab ' + r1(dAlt) + ' (near-neutral pair)');
      }
    } else if (dAlt < T.DE_ALT_ACCENT || hAlt < T.HUE_ALT_ACCENT) {
      violation('alt.distance',
        'ALT_ACCENT is dE*ab ' + r1(dAlt) + ' and ' + r1(hAlt) + ' degrees of hue from ACCENT ' +
        '(need ' + T.DE_ALT_ACCENT + ' and ' + T.HUE_ALT_ACCENT + ')',
        'ALT_ACCENT\'s only job is to say "this is the other path". Two close tints of one brand ' +
        'colour read as one path with a rendering bug — the reader does not see a decision, they ' +
        'see a printing error. Pick a different hue family, not a shade.');
    } else {
      pass('alt.distance', 'ALT_ACCENT is dE*ab ' + r1(dAlt) + ' and ' + r1(hAlt) + ' degrees of hue from ACCENT');
    }

    // --- DACCENT is a pair, not a second colour ---------------------------
    const dDark = deltaE76(C.ACCENT, C.DACCENT);
    const hDark = hueDelta(C.ACCENT, C.DACCENT);
    if (dDark < T.DE_DACCENT_MIN) {
      violation('daccent.distance',
        'DACCENT is only dE*ab ' + r1(dDark) + ' from ACCENT (need ' + T.DE_DACCENT_MIN + ')',
        'Table header rows fill with DACCENT and sit under ACCENT rules. At this distance the ' +
        'two read as one flat block.');
    } else if (hDark > T.HUE_DACCENT_MAX && chromaA >= T.CHROMA_ACHROMATIC) {
      warn('daccent.hue',
        'DACCENT is ' + r1(hDark) + ' degrees of hue from ACCENT — it reads as a second colour, not a darker pair',
        'Not a failure, but check it on a printed page: the SOP header rule and the table headers ' +
        'are meant to look related.');
    } else {
      pass('daccent.distance', 'DACCENT is a darker pair of ACCENT (dE*ab ' + r1(dDark) + ', hue ' + r1(hDark) + ' degrees)');
    }

    // --- GOLD is not the accent ------------------------------------------
    const dGold = deltaE76(C.ACCENT, C.GOLD);
    if (dGold < T.DE_GOLD) {
      violation('gold.distance',
        'GOLD is dE*ab ' + r1(dGold) + ' from ACCENT (need ' + T.DE_GOLD + ')',
        'infoBox uses GOLD to mean "aside, read this". If it matches the accent, every aside ' +
        'reads as a section header.');
    } else {
      pass('gold.distance', 'GOLD is dE*ab ' + r1(dGold) + ' from ACCENT');
    }

    // --- GOLD's hue distance from the accent family -----------------------
    // Decision 70. GOLD is fixed across every kit; ACCENT and DACCENT come from
    // the buyer's brand. On a cool kit gold is most of the wheel away from the
    // accent and every element that uses it to mean "pay attention here" reads
    // as different. On a warm kit it is a near neighbour and reads as another
    // section header. dE*ab does not see this -- the ratios come out nearly
    // identical, because the two colours differ in hue and not in lightness --
    // which is why gold.distance passes on both kits and the eye disagrees.
    //
    // This WARNS and does not fail, and the reason matters. The attention
    // elements now carry a glyph as well as a colour, so a warm kit is not
    // broken; it is a kit where the glyph is doing the work. Failing here would
    // reject a perfectly good brand for a problem that has already been fixed
    // somewhere else. Decision 70 glyphed two of the four gold elements and
    // Decision 75 the other two, so the remedy named below is now true of all
    // of them rather than of the two that happened to be confirmed first.
    const hGold = hueDelta(C.ACCENT, C.GOLD);
    if (chromaA < T.CHROMA_ACHROMATIC) {
      pass('gold.hue', 'ACCENT is near-grey, so hue distance from GOLD is not meaningful');
    } else if (hGold < T.HUE_GOLD_MIN) {
      warn('gold.hue',
        'GOLD is only ' + r1(hGold) + ' degrees of hue from ACCENT (want ' + T.HUE_GOLD_MIN +
        ') — on this palette gold no longer reads as "pay attention"',
        'Not a defect in the kit, and nothing to fix here. It means the four gold attention ' +
        'elements — the agenda decision band, the requirement-doc extension marker, the SOP info ' +
        'box and the QRG alert card — are carried by their glyph and their wording on your brand, ' +
        'not by their colour. Do not remove those glyphs. If you want the colour to carry it too, ' +
        'move ACCENT further from gold.');
    } else {
      pass('gold.hue', 'GOLD is ' + r1(hGold) + ' degrees of hue from ACCENT');
    }
  }

  // --- typography ---------------------------------------------------------
  const ty = cfg.type || {};
  if (typeof ty.FONT !== 'string' || !ty.FONT.trim()) {
    violation('type.font', 'type.FONT is not set',
      'Set the document font by name, e.g. "Arial". It is applied once at document level; ' +
      'a build that sets it per-run renders headings in one face over tables in another.');
  } else {
    // Whether the font is installed on the reader's machine is not knowable
    // from here, and a warning that fires on every single run is a warning
    // nobody reads. It is stated as a limit of the check, once, in the PASS
    // line — not dressed up as a finding.
    pass('type.font', 'FONT = ' + ty.FONT + '  (installation on reader machines is not checkable offline)');
  }
  // The slot is gone (Decision 133). A .docx names one font and cannot carry a
  // substitute — Word and LibreOffice both ignore the font table's altName — so
  // a kit that still declares one is told it is not read, not left believing it.
  if (ty.fallback !== undefined) {
    warn('type.fallback', 'type.fallback is set, and nothing reads it',
      'A Word file names its font and carries no substitute; a reader without FONT sees whatever ' +
      'their copy of Word picks. Delete the key. If FONT may be missing on readers\' machines, ' +
      'choose a FONT that is installed on them instead.');
  }

  // --- naming -------------------------------------------------------------
  const nm = cfg.naming || {};
  const PREFIX_RE = /^[A-Z][A-Z0-9]{1,7}$/;
  const SEG_RE = /^[A-Z][A-Z0-9]{1,9}$/;
  const RESERVED = ['SOP', 'QRG'];

  if (typeof nm.PREFIX !== 'string' || !PREFIX_RE.test(nm.PREFIX)) {
    violation('naming.prefix',
      'naming.PREFIX is ' + JSON.stringify(nm.PREFIX) + ' — must match ' + PREFIX_RE,
      'Uppercase letters and digits, 2 to 8 characters, starting with a letter. No underscore: ' +
      'the underscore is the field delimiter in {PREFIX}_{SEGMENT}_{Topic}_SOP.docx, and one ' +
      'inside a field silently shifts every field after it, which breaks the SOP-QRG pairing check.');
  } else {
    pass('naming.prefix', 'PREFIX = ' + nm.PREFIX);
  }

  const segs = Array.isArray(nm.SEGMENTS) ? nm.SEGMENTS : null;
  if (!segs || !segs.length) {
    violation('naming.segments', 'naming.SEGMENTS is not a non-empty array',
      'List the process areas this brand files documents under, e.g. ["OPS","SVC"]. ' +
      'The segment is never omitted from a filename.');
  } else {
    const bad = segs.filter((s) => typeof s !== 'string' || !SEG_RE.test(s));
    const reserved = segs.filter((s) => RESERVED.includes(s));
    if (bad.length) {
      violation('naming.segments',
        'invalid segment(s): ' + bad.map((s) => JSON.stringify(s)).join(', ') + ' — must match ' + SEG_RE,
        'Uppercase letters and digits, 2 to 10 characters. No underscore, for the same reason as PREFIX.');
    } else if (reserved.length) {
      violation('naming.segments.reserved',
        'segment(s) ' + reserved.join(', ') + ' collide with the document-type suffix',
        'SOP and QRG are the final field of every filename. A segment with the same name makes ' +
        '{SEGMENT}_{Topic} ambiguous and the pairing validator cannot tell the two apart.');
    } else {
      pass('naming.segments', segs.length + ' segment(s): ' + segs.join(', '));
    }

    if (nm.defaultSegment !== undefined && !segs.includes(nm.defaultSegment)) {
      violation('naming.default',
        'naming.defaultSegment ' + JSON.stringify(nm.defaultSegment) + ' is not in SEGMENTS',
        'Either add it to SEGMENTS or point defaultSegment at one that is there.');
    }
  }

  // --- organization -------------------------------------------------------
  // The agenda and the requirements document print org.name at full width.
  // The QRG header's right-hand cell prints org.shortName, which brand_kit.js
  // fills from org.name when a kit leaves it out — so the length limit falls
  // on whichever of the two lands in that cell, and never on a long full name
  // that has a short form beside it.
  const org = cfg.org || {};
  const hasShort = typeof org.shortName === 'string' && org.shortName.trim() !== '';
  const WRAPS = 'It wraps in the QRG header cell and pushes the effective date onto a second line, ' +
    'which changes the header height on a document whose whole constraint is one page. ';
  if (typeof org.name !== 'string' || !org.name.trim()) {
    violation('org.name', 'org.name is not set',
      'The agenda and the requirements document print it, and the QRG header prints it when ' +
      'org.shortName is not set. Set it.');
  } else if (hasShort && org.shortName.length > T.ORG_NAME_MAX) {
    violation('org.shortName.length',
      'org.shortName is ' + org.shortName.length + ' characters, over ' + T.ORG_NAME_MAX,
      WRAPS + 'Shorten it.');
  } else if (!hasShort && org.name.length > T.ORG_NAME_MAX) {
    violation('org.name.length',
      'org.name is ' + org.name.length + ' characters, over ' + T.ORG_NAME_MAX + ', and no org.shortName is set',
      WRAPS + 'Set org.shortName to a form that fits; the QRG header prints that, and org.name stays whole everywhere else.');
  } else if (hasShort) {
    pass('org.name', 'QRG header prints org.shortName, ' + org.shortName.length + ' characters, fits the header cell');
  } else {
    pass('org.name', org.name.length + ' characters, fits the header cell');
  }

  // --- logo ---------------------------------------------------------------
  const lg = cfg.logo || {};
  if (lg.absent === true || !lg.path) {
    pass('logo.absent', 'no logo declared — headers collapse to the single-cell title-only variant');
    if (cfg.header && cfg.header.style === 'logo-left') {
      violation('logo.header.mismatch',
        'header.style is "logo-left" but no logo is declared',
        'An empty logo cell leaves an unexplained indent on every page that reads as a layout bug. ' +
        'Set header.style to "title-only", or declare a logo.');
    }
  } else {
    const logoPath = path.isAbsolute(lg.path) ? lg.path : path.resolve(path.dirname(configPath), lg.path);
    if (!fs.existsSync(logoPath)) {
      violation('logo.missing', 'logo.path does not resolve: ' + logoPath,
        'The path is read relative to brand.json, not to the folder you build from. ' +
        'Move the file or fix the path.');
    } else {
      const buf = fs.readFileSync(logoPath);
      const png = readPng(buf);
      if (!png.ok) {
        violation('logo.format', 'logo is not a usable PNG: ' + png.reason,
          'The document builder embeds PNG. Convert it, and keep transparency if the header ' +
          'fill is ever anything but white.');
      } else {
        const aspect = png.width / png.height;
        pass('logo.format', png.width + 'x' + png.height + ' PNG, aspect ' + r2(aspect) + ':1');

        // Resolution is only meaningful at the size the image is rendered.
        // A short wordmark is not low-resolution because it is short; it is
        // low-resolution if it runs out of pixels inside the header cell.
        const cellDxa = lg.headerCellDxa || 1400;
        const renderedIn = cellDxa / 1440;
        const dpi = png.width / renderedIn;
        if (dpi < T.LOGO_MIN_DPI) {
          warn('logo.resolution',
            r1(dpi) + ' effective dpi at the ' + cellDxa + ' DXA header cell, under ' + T.LOGO_MIN_DPI,
            'It will be visibly soft in print. Re-export at a larger pixel width, from vector if you have it.');
        } else {
          pass('logo.resolution', r1(dpi) + ' effective dpi in the ' + cellDxa + ' DXA header cell');
        }
        if (aspect > T.LOGO_ASPECT_MAX) {
          violation('logo.aspect',
            'aspect ratio ' + r2(aspect) + ':1 is wider than ' + T.LOGO_ASPECT_MAX + ':1',
            'Scaled to the ' + (lg.headerCellDxa || 1400) + ' DXA header cell it becomes a hairline. ' +
            'Use a stacked or badge lockup for documents.');
        } else if (aspect < T.LOGO_ASPECT_MIN) {
          violation('logo.aspect',
            'aspect ratio ' + r2(aspect) + ':1 is taller than 1:' + Math.round(1 / T.LOGO_ASPECT_MIN),
            'A tall lockup forces a header row deeper than the rest of the document expects. ' +
            'Use a horizontal variant.');
        }

        if (!png.pixels) {
          warn('logo.trim', 'trim not checked — ' + png.skipReason,
            'Confirm by eye that the logo has no blank margin baked into the canvas. ' +
            'Re-save as 8-bit non-interlaced PNG to have this checked mechanically.');
        } else {
          const box = contentBox(png.pixels, png.width, png.height);
          if (box === null) {
            warn('logo.trim', 'trim not checked — the four corners are different colours, so there is no uniform ground to trim against',
              'If the logo is on a photographic or gradient background, crop it deliberately instead.');
          } else if (box.empty) {
            violation('logo.blank', 'every pixel is background — the logo file is blank',
              'Check the export. A blank logo embeds without error and prints as nothing.');
          } else {
            const pct = (n, total) => (n / total) * 100;
            const m = {
              left: pct(box.minX, png.width),
              right: pct(png.width - 1 - box.maxX, png.width),
              top: pct(box.minY, png.height),
              bottom: pct(png.height - 1 - box.maxY, png.height),
            };
            const worstSide = Object.keys(m).reduce((a, b) => (m[a] > m[b] ? a : b));
            if (m[worstSide] > T.LOGO_TRIM_PCT) {
              violation('logo.trim',
                'untrimmed: ' + r1(m[worstSide]) + '% blank margin on the ' + worstSide +
                ' (left ' + r1(m.left) + '%, right ' + r1(m.right) + '%, top ' + r1(m.top) + '%, bottom ' + r1(m.bottom) + '%)',
                'The embedder scales to the canvas, not to the artwork, so baked-in margin shrinks ' +
                'the visible logo and shifts it off the header baseline. Crop to the content ' +
                'bounding box before embedding.');
            } else {
              pass('logo.trim', 'trimmed — largest blank margin is ' + r1(m[worstSide]) + '% (' + worstSide + ')');
            }
          }
        }
      }
    }
  }

  // --- report -------------------------------------------------------------
  const violations = findings.filter((f) => f.level === 'VIOLATION');
  const warnings = findings.filter((f) => f.level === 'WARN');
  const passes = findings.filter((f) => f.level === 'PASS');

  if (asJson) {
    console.log(JSON.stringify({
      config: configPath,
      thresholds: T,
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
      console.log('PASS — clean. ' + passes.length + ' checks, ' + warnings.length + ' warning' +
        (warnings.length === 1 ? '' : 's') + '.');
    }
  }

  const failed = violations.length > 0 || (strict && warnings.length > 0);
  process.exit(failed ? 1 : 0);
}

main();
