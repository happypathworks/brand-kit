#!/usr/bin/env node
'use strict';
/*
 * brand_rules.js — the brand kit checks.
 *
 * A brand kit is a set of colours dropped into slots that the document skills'
 * templates already decided how to use. checkKit() checks them against the
 * places they actually land — white 8.5pt text on the QRG header fill, a light
 * tint on a dark strip, a logo scaled into each box a document prints it in —
 * and returns a finding for each, PASS, WARN or VIOLATION.
 *
 * brand_kit.js runs these checks inside load(), so every build checks its kit
 * where it uses it. brand_check.js, in the skills that ship it, runs the same
 * checks from the command line and prints the report.
 *
 * Nothing here is a matter of taste. A violation is a field that is missing
 * or malformed, or a computed number against a stated threshold, and then
 * the finding carries the number.
 *
 * Zero dependencies. Reads the logo file directly, and takes the schema id,
 * naming grammar and colour normalisation from brand_kit.js beside it.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// Thresholds the findings are measured against. The logo helpers keep their
// own print boxes (logoBoxes), pixel tolerances (contentBox) and 96 dpi
// (fitBox); the near-white ground a margin is measured against is here.
// ---------------------------------------------------------------------------
const T = {
  CONTRAST_BODY: 4.5,      // WCAG 2.2 AA, text below 18pt / 14pt bold
  DE_ALT_ACCENT: 25,       // CIE76 dE*ab, ACCENT vs ALT_ACCENT
  HUE_ALT_ACCENT: 30,      // degrees in CIE LCh, ACCENT vs ALT_ACCENT
  DE_ACHROMATIC_ALT: 40,   // dE required instead of hue when either is near-grey
  CHROMA_ACHROMATIC: 10,   // C* below this is treated as grey; hue is meaningless
  CHROMA_TINT_MIN: 5,      // ...unless C* is at least this: a greyed shade that still reads as its hue
  DE_GOLD: 20,             // GOLD must not read as the accent
  HUE_GOLD_MIN: 40,        // ...and must not sit in the accent's hue family (warn)
  DE_DACCENT_MIN: 8,       // DACCENT must be visibly distinct from ACCENT
  HUE_DACCENT_MAX: 40,     // ...but it is a darker PAIR, not a second colour (warn)
  LOGO_MIN_DPI: 150,       // effective resolution at the largest size any document prints the logo
  LOGO_ASPECT_MAX: 6.0,    // wider than 6:1 prints as a hairline in the smallest logo box
  LOGO_ASPECT_MIN: 0.33,   // taller than 1:3 prints as a sliver in the smallest logo box
  LOGO_TRIM_PCT: 2.0,      // uniform border wider than this means it was not trimmed
  LOGO_FAINT_ALPHA: 64,    // under 25% opaque is a glow or halo, not the mark, when its shape is judged
  LOGO_SPECK_PX: 9,        // a blob under 3x3 px touching the canvas edge is a stray speck, not the mark
  LOGO_GROUND_MIN: 224,    // an opaque corner is blank canvas only when R, G and B are all at least this
  ORG_CELL_PT: 151,        // QRG header right cell: 3300 DXA less 280 DXA of padding
  ORG_SIZE_PT: 8.5,        // ...where the organization name prints bold at this size
};

// Where the documents print the logo: the box each one fits it into, in
// inches. Every builder scales the logo to fit inside its box and never past
// its own pixel size at 96 dpi, so a small file prints small rather than soft.
// The action list's box is its header-band logo cell (logo.headerCellDxa,
// 1400 DXA unless the kit says otherwise) less 160 DXA of padding a side, by
// 0.5 in high.
function logoBoxes(headerCellDxa) {
  const cell = (Number.isFinite(headerCellDxa) && headerCellDxa > 320) ? headerCellDxa : 1400;
  return [
    { where: 'SOP page header', w: 0.9, h: 0.6 },
    { where: 'agenda header', w: 2.6, h: 0.9 },
    { where: 'requirements document cover', w: 3.6, h: 1.6 },
    { where: 'action list header band', w: (cell - 320) / 1440, h: 0.5 },
  ];
}

// ---------------------------------------------------------------------------
// Colour maths — sRGB -> linear -> XYZ (D65) -> CIELAB -> LCh
// ---------------------------------------------------------------------------

const HEX6 = /^[0-9A-F]{6}$/;

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
// Text width — Arial Bold advance widths, from brand_kit.js's FONT table.
//
// Used only to measure the organization name against the QRG header cell. A
// kit FONT wider than Arial needs more room than this measures.
// ---------------------------------------------------------------------------
/** Width in points of `s` set in Arial Bold at `pt`. */
function boldWidthPt(s, pt) {
  let units = 0;
  const { FONT } = kitModule();
  for (const ch of s) units += FONT.advance(ch.codePointAt(0), true);
  return units * pt / 1000;
}

// ---------------------------------------------------------------------------
// PNG: the whole format checked as the PNG specification (ISO/IEC 15948)
// defines it, then decoded to find the content bounding box.
//
// Only zlib, which is built in. A file is refused as damaged when any part of
// it breaks the format: the 8-byte signature; a chunk's length, type or CRC;
// the chunk order (IHDR first, PLTE and tRNS before the image data, the IDAT
// chunks together, IEND last); a critical chunk PNG does not define; an IHDR
// field PNG does not have, including a bit depth its colour type does not
// allow; a palette image with no PLTE, a PLTE where the colour type forbids
// one, or a tRNS of the wrong size; image data that does not decompress to
// exactly the size the header declares, interlaced (Adam7) or not; a scanline
// filter PNG does not have; or a pixel naming a palette entry the PLTE does
// not hold. Every file that passes is decoded, at every colour type and bit
// depth; a 16-bit sample keeps its high byte, which is all a bounding box
// needs.
// ---------------------------------------------------------------------------

// The bit depths PNG allows each colour type ("type:depth").
const PNG_DEPTHS = new Set(['0:1', '0:2', '0:4', '0:8', '0:16', '2:8', '2:16', '3:1', '3:2', '3:4', '3:8',
  '4:8', '4:16', '6:8', '6:16']);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// Adam7's seven passes: first column, first row, column step, row step.
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

function readPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    return { ok: false, reason: 'not a PNG (missing its 8-byte signature, 89 50 4E 47 0D 0A 1A 0A)' };
  }
  // A file that breaks the format is damaged whatever its format: it embeds
  // without error and prints as nothing, so it is refused, never waved through.
  const damaged = (why) => ({ ok: false, damaged: true, reason: 'the file is damaged: ' + why });

  // Every chunk's frame and CRC, up to IEND.
  const chunks = [];
  let off = 8;
  while (!chunks.length || chunks[chunks.length - 1].type !== 'IEND') {
    if (off + 12 > buf.length) return damaged('it ends before its IEND chunk (cut off)');
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return damaged('chunk ' + (chunks.length + 1) + ' has a type that is not four letters');
    if (len > 0x7fffffff || off + 12 + len > buf.length) return damaged('it ends inside its ' + type + ' chunk (cut off)');
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) {
      return damaged('its ' + type + ' chunk fails its CRC check');
    }
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }

  if (chunks[0].type !== 'IHDR' || chunks[0].data.length !== 13) {
    return damaged('its first chunk is not a 13-byte IHDR');
  }
  const hd = chunks[0].data;
  const width = hd.readUInt32BE(0), height = hd.readUInt32BE(4);
  const [bitDepth, colorType, compression, filterMethod, interlace] = hd.subarray(8, 13);
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) {
    return damaged('the header declares a ' + width + 'x' + height + ' image');
  }
  if (!PNG_DEPTHS.has(colorType + ':' + bitDepth)) {
    return damaged('the header declares bit depth ' + bitDepth + ' with colour type ' + colorType + ', which PNG does not have');
  }
  if (compression !== 0 || filterMethod !== 0 || interlace > 1) {
    return damaged('the header declares compression ' + compression + ', filter method ' + filterMethod +
      ' and interlace ' + interlace + '; PNG has 0, 0, and 0 or 1');
  }

  // Chunk order and the palette rules.
  const idat = [];
  let plte = null, trns = null, idatDone = false;
  for (const { type, data } of chunks.slice(1)) {
    if (type === 'IDAT') {
      if (idatDone) return damaged('its IDAT chunks are not together: another chunk sits between them');
      idat.push(data);
      continue;
    }
    if (idat.length) idatDone = true;
    if (type === 'IHDR') return damaged('it holds a second IHDR chunk');
    if (type === 'PLTE') {
      if (plte || idat.length || trns) return damaged('its PLTE chunk is repeated, or comes after tRNS or the image data');
      if (colorType === 0 || colorType === 4) return damaged('it holds a PLTE chunk, which a greyscale image may not have');
      const n = data.length / 3;
      if (!Number.isInteger(n) || n < 1 || n > 256 || (colorType === 3 && n > 1 << bitDepth)) {
        return damaged('its PLTE chunk is ' + data.length + ' bytes, not 1 to ' +
          (colorType === 3 ? Math.min(256, 1 << bitDepth) : 256) + ' entries of 3');
      }
      plte = data;
    } else if (type === 'tRNS') {
      const size = { 0: 2, 2: 6 }[colorType];
      if (trns || idat.length || colorType === 4 || colorType === 6 || (colorType === 3 && !plte) ||
          (size !== undefined ? data.length !== size : data.length > plte.length / 3)) {
        return damaged('its tRNS chunk is repeated, misplaced, or the wrong size for colour type ' + colorType);
      }
      trns = data;
    } else if (type === 'IEND') {
      if (data.length) return damaged('its IEND chunk is not empty');
    } else if (/^[A-Z]/.test(type)) {
      return damaged('it holds a critical chunk, ' + type + ', that PNG does not define');
    }
  }
  if (colorType === 3 && !plte) return damaged('it is a palette image with no PLTE chunk');
  if (!idat.length) return damaged('it holds no image data (no IDAT chunk), so it was cut off or never written');

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); }
  catch (e) { return damaged('its image data will not decompress (' + e.message + ')'); }

  // The passes the data holds: the whole image, or Adam7's seven reduced ones.
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bits = channels * bitDepth;          // per pixel
  const bpp = Math.max(1, bits >> 3);        // the filters' unit: whole bytes per pixel, at least one
  const passes = (interlace ? ADAM7 : [[0, 0, 1, 1]]).map(([x0, y0, dx, dy]) =>
    ({ x0, y0, dx, dy, w: Math.max(0, Math.ceil((width - x0) / dx)), h: Math.max(0, Math.ceil((height - y0) / dy)) }))
    .filter((p) => p.w && p.h);
  const need = passes.reduce((n, p) => n + (Math.ceil((p.w * bits) / 8) + 1) * p.h, 0);
  if (raw.length !== need) {
    return damaged('its image data is ' + (raw.length < need ? 'shorter' : 'longer') + ' than the size its header declares');
  }

  // Sample k of a scanline, scaled to 0-255 (a palette index is not scaled).
  // One formula for every depth: samples are packed most significant bit
  // first, and a 16-bit one is read by its high byte.
  const eff = Math.min(bitDepth, 8);
  const mask = (1 << eff) - 1;
  const scale = colorType === 3 ? 1 : 255 / mask;
  const entries = plte ? plte.length / 3 : 0;
  // A tRNS on a greyscale or truecolour image is a colour key: a pixel whose
  // samples equal it, at full bit depth, is transparent.
  const key = trns && (colorType === 0 || colorType === 2)
    ? Array.from({ length: trns.length / 2 }, (_, k) => trns.readUInt16BE(k * 2)) : null;
  const rgba = Buffer.alloc(width * height * 4);
  let pos = 0;
  for (const p of passes) {
    const stride = Math.ceil((p.w * bits) / 8);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < p.h; y++) {
      const ft = raw[pos];
      const line = raw.subarray(pos + 1, pos + 1 + stride);
      pos += stride + 1;
      // Undo the scanline's filter.
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
            const q = a + b - c;
            const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default:
            return damaged('a scanline names filter ' + ft + ', which PNG does not have');
        }
        cur[i] = v & 0xff;
      }
      prev = cur;
      // Normalise to RGBA so the bbox pass has one shape to reason about.
      for (let x = 0; x < p.w; x++) {
        const at = (k) => {
          const bit = (x * channels + k) * bitDepth;
          return ((cur[bit >> 3] >> (8 - eff - (bit & 7))) & mask) * scale;
        };
        let r, g, b, a = 255;
        if (key) {
          const raw = (k) => {
            const bit = (x * channels + k) * bitDepth;
            return bitDepth === 16 ? cur.readUInt16BE(bit >> 3) : (cur[bit >> 3] >> (8 - eff - (bit & 7))) & mask;
          };
          if (key.every((v, k) => raw(k) === v)) a = 0;
        }
        if (colorType === 0) { r = g = b = at(0); }
        else if (colorType === 4) { r = g = b = at(0); a = at(1); }
        else if (colorType === 2) { r = at(0); g = at(1); b = at(2); }
        else if (colorType === 6) { r = at(0); g = at(1); b = at(2); a = at(3); }
        else { // palette
          const idx = at(0);
          if (idx >= entries) return damaged('a pixel names palette entry ' + idx + ', and its PLTE holds ' + entries);
          r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
          if (trns && idx < trns.length) a = trns[idx];
        }
        const o = ((p.y0 + y * p.dy) * width + p.x0 + x * p.dx) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
    }
  }
  return { ok: true, width, height, bitDepth, colorType, interlace, pixels: rgba };
}

/**
 * The bounding box of non-background pixels.
 *
 * Background is every transparent pixel, and every pixel of the colour the
 * opaque corners agree on: on an opaque canvas the corner colour is the
 * ground, white or not, and a margin may mix the two (a 1 px opaque frame
 * round a transparent margin, or one transparent pixel in an opaque white
 * one). Beside a transparent corner only a near-white colour is ground.
 * Returns null when the opaque corners disagree and no corner is
 * transparent (no uniform ground), else a box or { empty: true }, with
 * `opaqueGround` set when the ground is an opaque colour that is not
 * near-white: that may be the logo's own badge, so the report names it.
 */
function contentBox(px, w, h) {
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const opaque = corners.filter((c) => c[3] >= 250);
  const c0 = opaque[0];
  const same = !!c0 && opaque.every((c) =>
    Math.abs(c[0] - c0[0]) <= 4 && Math.abs(c[1] - c0[1]) <= 4 && Math.abs(c[2] - c0[2]) <= 4);
  if (opaque.length === 4 && !same) return null; // no uniform ground; nothing to trim against
  const nearWhite = same && c0[0] >= T.LOGO_GROUND_MIN && c0[1] >= T.LOGO_GROUND_MIN && c0[2] >= T.LOGO_GROUND_MIN;
  // Beside a transparent corner, an opaque corner in a colour is the artwork
  // reaching the edge; only a near-white one is canvas.
  const ground = same && (opaque.length === 4 || nearWhite) ? c0 : null;
  const isBg = (p) => p[3] < 16 || (ground !== null &&
    Math.abs(p[0] - ground[0]) <= 8 && Math.abs(p[1] - ground[1]) <= 8 && Math.abs(p[2] - ground[2]) <= 8);
  const opaqueGround = ground !== null && !nearWhite ? ground.slice(0, 3) : null;

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
  if (maxX < 0) return { empty: true, opaqueGround };
  return { minX, minY, maxX, maxY, empty: false, opaqueGround };
}

/**
 * The size of the mark, for judging its shape (G1FIX-BK3,
 * ruling-g1-cousins-pack1): the box of what prints on a white page. A pixel
 * is ink when it is at least LOGO_FAINT_ALPHA opaque (fainter is a glow or
 * halo) and not near-white (LOGO_GROUND_MIN, the model logo.invisible uses),
 * whatever the corners are: a coloured badge is ink edge to edge, a white
 * plate, frame or canvas is not. A blob of ink under LOGO_SPECK_PX pixels
 * touching the canvas edge is a stray speck. With no ink left (a reversed
 * white mark, an all-faint one), the mark is contentBox's `box`, or the canvas.
 */
function markBox(px, w, h, box) {
  const n = w * h, G = T.LOGO_GROUND_MIN;
  const ink = new Uint8Array(n);   // 1 ink, 2 being measured, 3 a speck
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    ink[i] = px[o + 3] >= T.LOGO_FAINT_ALPHA && (px[o] < G || px[o + 1] < G || px[o + 2] < G) ? 1 : 0;
  }
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
  for (const s of edge) {
    if (ink[s] !== 1) continue;
    // Fill from the edge pixel, stopping once the blob is big enough to keep.
    const blob = [s];
    ink[s] = 2;
    for (let k = 0; k < blob.length && blob.length < T.LOGO_SPECK_PX; k++) {
      const x = blob[k] % w, y = (blob[k] - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, j = ny * w + nx;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && ink[j] === 1) { ink[j] = 2; blob.push(j); }
        }
      }
    }
    const v = blob.length < T.LOGO_SPECK_PX ? 3 : 1;
    for (const j of blob) ink[j] = v;
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    if (ink[i] !== 1) continue;
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 >= 0) return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return box && !box.empty ? { w: box.maxX - box.minX + 1, h: box.maxY - box.minY + 1 } : { w, h };
}

/** Printed size in inches of a w x h px image fitted into a box: scaled down to fit, never up past 96 dpi. */
function fitBox(w, h, boxW, boxH) {
  const s = Math.min(1, boxW / (w / 96), boxH / (h / 96));
  return { w: (w / 96) * s, h: (h / 96) * s };
}

const hexOf = (rgb) => rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/** A control character (C0, DEL, C1), U+FFFE/U+FFFF, or a lone surrogate: not for a font name. */
const FONT_BAD_CHAR = /[\u0000-\u001F\u007F-\u009F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// ---------------------------------------------------------------------------
// The findings list
// ---------------------------------------------------------------------------

// Each checkKit() call collects its own list, so brand_kit.js can run the
// checks inside a build without one kit's findings leaking into the next.

// ---------------------------------------------------------------------------
// The contrast pairs.
//
// Every entry is a place one of the document skills puts text on a fill. This
// list is the reason the checker is worth running: the buyer picks a colour
// looking at it on its own, and these are the combinations that colour is
// about to be used in. The four QRG header runs are listed separately because
// they are four text runs, and the report names the one that broke.
// ---------------------------------------------------------------------------
const PAIRS = [
  { id: 'hdr.title',    fg: 'WHITE',    bg: 'ACCENT',     where: 'QRG header — document title, 13pt bold' },
  { id: 'hdr.subtitle', fg: 'WHITE',    bg: 'ACCENT',     where: 'QRG header — subtitle, 8.5pt' },
  { id: 'hdr.org',      fg: 'WHITE',    bg: 'ACCENT',     where: 'QRG header — organization name, 8.5pt bold' },
  { id: 'hdr.date',     fg: 'WHITE',    bg: 'ACCENT',     where: 'QRG header — effective date, 7.5pt' },
  { id: 'strip.label',  fg: 'WHITE',    bg: 'DACCENT',    where: 'QRG priority strip — leading label, bold' },
  { id: 'strip.body',   fg: 'LACCENT2', bg: 'DACCENT',    where: 'QRG priority strip — the sequence text' },
  { id: 'tbl.header',   fg: 'WHITE',    bg: 'DACCENT',    where: 'table header rows and section bars, 8.5pt bold' },
  { id: 'path.a',       fg: 'WHITE',    bg: 'ACCENT',     where: 'QRG decision block — primary path header' },
  { id: 'path.b',       fg: 'WHITE',    bg: 'ALT_ACCENT', where: 'QRG alternate path header; agenda consent-agenda bar' },
  { id: 'postaction',   fg: 'DARK',     bg: 'LACCENT2',   where: 'body text on the LACCENT2 tint — QRG post-action block, agenda open-forum box, SOP note box' },
  { id: 'label.section',fg: 'ACCENT',   bg: 'WHITE',      where: 'section labels and item numbers on the page ground, 8.5pt bold' },
  { id: 'head.doc',     fg: 'DACCENT',  bg: 'WHITE',      where: 'document titles and headings on the page ground' },
  { id: 'info.head',    fg: 'WHITE',    bg: 'GOLD',       where: 'the gold attention bar — SOP info box, QRG alert card, agenda decision band' },
  { id: 'info.body',    fg: 'DARK',     bg: 'BGLTGOLD',   where: 'body text on BGLTGOLD under the gold attention bar' },
  { id: 'purpose.label',fg: 'GOLD',     bg: 'WHITE',      where: 'GOLD text on the page ground — SOP PURPOSE label, requirement-document extension marker' },
];

// The pairs above refer to the fixed neutrals (WHITE, DARK) as well as to
// the slots; both lists are brand_kit.js's.

// brand_kit.js ships beside this file and carries the schema id, naming
// grammar, slot list, neutrals and metrics the checks apply.
let kitmodCache = null;
function kitModule() {
  if (kitmodCache) return kitmodCache;
  try {
    kitmodCache = require(path.join(__dirname, 'brand_kit.js'));
  } catch (e) {
    const err = new Error('brand_kit.js could not be loaded from ' + __dirname +
      ' (' + (e.code || e.message) + '). It ships beside brand_rules.js; re-install the skill.');
    err.checkerSetup = true;
    throw err;
  }
  return kitmodCache;
}

/**
 * Every check, on a parsed kit. Returns the findings, each
 * { level: 'PASS'|'WARN'|'VIOLATION', id, msg, fix }. brand_kit.js calls this
 * from load(), so a build and brand_check.js apply one set of rules.
 * @param {object} cfg  the parsed brand.json
 * @param {string} configPath  where it was read from; a logo path resolves against it
 */
function checkKit(cfg, configPath) {
  const { NAMING, SCHEMA_ID, normalizeHex, PALETTE_SLOTS, FIXED, RAMP, LACCENT_RULE, KIT_KEYS } = kitModule();
  const findings = [];
  const violation = (id, msg, fix) => findings.push({ level: 'VIOLATION', id, msg, fix });
  const warn = (id, msg, fix) => findings.push({ level: 'WARN', id, msg, fix });
  const pass = (id, msg) => findings.push({ level: 'PASS', id, msg, fix: null });

  // --- schema -------------------------------------------------------------
  if (cfg.schema !== SCHEMA_ID) {
    violation('schema.id',
      'schema is ' + JSON.stringify(cfg.schema) + ', expected "' + SCHEMA_ID + '"',
      'Set "schema": "' + SCHEMA_ID + '" at the top level.');
  } else {
    pass('schema.id', SCHEMA_ID);
  }

  // --- keys and types -----------------------------------------------------
  // Every key the kit holds is looked up in brand_kit.js KIT_KEYS. One it does
  // not know (under a parent it does), or one holding the wrong JSON type, is
  // named with the nearest key the shape has.
  const known = Object.keys(KIT_KEYS);
  const jsonType = (v) => Object.prototype.toString.call(v).slice(8, -1).toLowerCase();
  // Paths join with '.', so a key whose own name holds a dot ("logo.path" at
  // the top level) would pass for the nested key it spells. It is set aside
  // whole, with the section it sits in, and never joined.
  const dotted = [];
  const pathsOf = (o, pre) => Object.keys(o).flatMap((k) => (k.includes('.')
    ? (dotted.push([pre.slice(0, -1), k]), [])
    : [pre + k].concat(jsonType(o[k]) === 'object' && pre + k !== 'header' ? pathsOf(o[k], pre + k + '.') : [])));
  const keyPaths = pathsOf(cfg, '');
  const valueAt = (p) => p.split('.').reduce((o, k) => o[k], cfg);
  const editDistance = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) {
        next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] !== b[j - 1]));
      }
      row = next;
    }
    return row[b.length];
  };
  const nearest = (p) => known.map((q) => [editDistance(p, q), q]).sort((x, y) => x[0] - y[0])[0][1];
  const parentOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('.')));
  const strayKeys = dotted.filter(([parent]) => ['', ...known].includes(parent)).map(([parent, k]) =>
    'unknown key "' + k + '"' + (parent ? ' in ' + parent : ' at the top level') + ' (a dot inside a key name ' +
    'does not nest it; the nearest key a kit has is "' + nearest(parent ? parent + '.' + k : k) + '", written as ' +
    'nested sections)');
  const wrongTypes = [];
  for (const p of keyPaths) {
    const want = KIT_KEYS[p];
    const got = jsonType(valueAt(p));
    // A key under a parent the schema does not know is not named again: the
    // parent already is.
    if (want === undefined && ['', ...known].includes(parentOf(p))) {
      strayKeys.push('unknown key "' + p + '" (the nearest key a kit has is "' + nearest(p) + '")');
    } else if (want !== undefined && want !== 'any' && want !== got) {
      wrongTypes.push(p + ' is ' + got + ', not ' + want);
    }
  }
  const shapeFaults = strayKeys.concat(wrongTypes);
  if (shapeFaults.length) {
    violation('schema.keys', shapeFaults.join('; '),
      'Rename each unknown key to the one it meant, or delete it, and give each key the type ' +
      'named. Nothing reads a key the kit schema does not have, so the setting it was meant to ' +
      'make is silently not made.');
  }

  const P = (cfg.palette && typeof cfg.palette === 'object') ? cfg.palette : {};
  const SLOTS = PALETTE_SLOTS;

  // --- colour format ------------------------------------------------------
  // The loader reads "#2e75b6" as 2E75B6, so a "#" or lowercase is fine. What
  // is not six hex digits the document builder refuses ("Invalid hex value"),
  // and every build against the kit stops.
  let formatOk = true;
  const C = Object.assign({}, FIXED);
  const restated = [];
  for (const slot of SLOTS) {
    const v = P[slot];
    const norm = normalizeHex(v);
    if (v === undefined) {
      violation('palette.missing.' + slot, 'palette.' + slot + ' is not set',
        'Add "' + slot + '" to palette. All seven slots are required — there is no partial kit.');
      formatOk = false;
    } else if (typeof norm !== 'string' || !HEX6.test(norm)) {
      violation('palette.format.' + slot,
        'palette.' + slot + ' is ' + JSON.stringify(v) + ' — not a six-digit hex colour',
        'Write it as six hex digits, e.g. "2E75B6" ("#2E75B6" and lowercase are read the same way). ' +
        'The document builder refuses anything else ("Invalid hex value"), so every build against this kit would stop.');
      formatOk = false;
    } else {
      C[slot] = norm;
      if (norm !== v) restated.push(slot);
    }
  }
  if (formatOk) {
    pass('palette.format', 'all seven slots are six-digit hex' + (restated.length
      ? ' (' + restated.join(', ') + ' written with "#", lowercase or spaces; builds read them as bare uppercase)' : ''));
  }

  // Everything below needs parseable colours.
  if (formatOk) {
    // --- contrast ---------------------------------------------------------
    let worst = null;
    for (const pr of PAIRS) {
      const fg = C[pr.fg], bg = C[pr.bg];
      const ratio = contrastRatio(fg, bg);
      const need = T.CONTRAST_BODY;
      if (!worst || ratio < worst.ratio) worst = { ratio, id: pr.id };
      if (ratio < need) {
        // Name the slot the buyer can move. WHITE, DARK and MID are fixed text
        // colours every template uses, so the fix names the other side of the
        // pair.
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

    const [DK, AC, L1, L2] = RAMP;
    if (!(L[DK] < L[AC])) {
      violation('order.daccent',
        'DACCENT L*=' + r1(L.DACCENT) + ' is not darker than ACCENT L*=' + r1(L.ACCENT),
        'DACCENT is the darker member of the pair — it fills table header rows that ACCENT sits ' +
        'above. Swap them, or darken DACCENT.');
    } else if (!(L[AC] < L[L1] && L[L1] < L[L2])) {
      violation('order.light',
        'the light ramp is out of order: ACCENT L*=' + r1(L.ACCENT) +
        ', LACCENT L*=' + r1(L.LACCENT) + ', LACCENT2 L*=' + r1(L.LACCENT2),
        'LACCENT is a tint of ACCENT and LACCENT2 a lighter tint of LACCENT. ' + LACCENT_RULE +
        ' Out of order, a "light" border or fill prints as heavy as the accent itself. The ramp must ascend in L*.');
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
    // Greyed, but still tinted enough to read as a hue: a dark slate of a blue
    // accent is that blue, not a second hue family.
    const tinted = Math.min(chromaA, chromaB) >= T.CHROMA_TINT_MIN;

    if (achromatic && tinted && hAlt < T.HUE_ALT_ACCENT) {
      violation('alt.distance',
        'ALT_ACCENT is a greyed shade of ACCENT\'s own hue: ' + r1(hAlt) + ' degrees apart (need ' +
        T.HUE_ALT_ACCENT + '), with C*=' + r1(Math.min(chromaA, chromaB)) + ' still enough to read as that hue',
        'ALT_ACCENT signals "this is the other path", and a darker or greyer version of the accent ' +
        'reads as the same path. Pick a different hue family, or a true grey.');
    } else if (achromatic) {
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
        'ALT_ACCENT\'s job is to say "this is the other path". Two close tints of one brand ' +
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
        'The gold attention elements use GOLD to mean "aside, read this". If it matches the accent, ' +
        'every aside reads as a section header.');
    } else {
      pass('gold.distance', 'GOLD is dE*ab ' + r1(dGold) + ' from ACCENT');
    }

    // --- GOLD's hue distance from the accent ------------------------------
    // dE*ab does not see this: two colours that differ in hue and not in
    // lightness come out at nearly the same distance, so gold.distance passes
    // a warm accent the eye reads as gold's neighbour. It warns and does not
    // fail because the attention elements carry a glyph and wording as well as
    // the colour, so on such a palette the glyph does the work.
    const hGold = hueDelta(C.ACCENT, C.GOLD);
    if (chromaA < T.CHROMA_ACHROMATIC) {
      pass('gold.hue', 'ACCENT is near-grey, so hue distance from GOLD is not meaningful');
    } else if (hGold < T.HUE_GOLD_MIN) {
      warn('gold.hue',
        'GOLD is only ' + r1(hGold) + ' degrees of hue from ACCENT (want ' + T.HUE_GOLD_MIN +
        ') — on this palette gold no longer reads as "pay attention"',
        'Not a defect in the kit. It means the four gold attention elements — the agenda decision ' +
        'band, the requirement-doc extension marker, the SOP info box and the QRG alert card — are ' +
        'carried by their glyph and their wording on your brand, not by their colour. Do not remove ' +
        'those glyphs. If you want the colour to carry it too, move GOLD (and BGLTGOLD with it) or ' +
        'ACCENT further apart in hue; both are slots in your kit.');
    } else {
      pass('gold.hue', 'GOLD is ' + r1(hGold) + ' degrees of hue from ACCENT');
    }
  }

  // --- typography ---------------------------------------------------------
  const ty = (cfg.type && typeof cfg.type === 'object') ? cfg.type : {};
  if (typeof ty.FONT !== 'string' || !ty.FONT.trim()) {
    violation('type.font', 'type.FONT is not set',
      'Set the document font by name, e.g. "Arial". It is applied once at document level; ' +
      'a build that sets it per-run renders headings in one face over tables in another.');
  } else if (FONT_BAD_CHAR.test(ty.FONT)) {
    // The name is written raw into word/styles.xml: a control character, or
    // one XML 1.0 cannot carry, leaves a file Word calls corrupt (G1FIX-BK2).
    const ch = ty.FONT.match(FONT_BAD_CHAR)[0].charCodeAt(0);
    violation('type.font', 'type.FONT ' + JSON.stringify(ty.FONT) + ' holds U+' +
      ch.toString(16).toUpperCase().padStart(4, '0') + ', an invisible character that is part of no font name',
      'Retype the font name by hand, e.g. "Arial": written into a document as it is, it can leave a file ' +
      'Word reports as corrupt. An invisible character usually comes in with a copy and paste.');
  } else {
    // Whether the font is installed on the reader's machine is not knowable
    // from here, and a warning that fires on every single run is a warning
    // nobody reads. It is stated as a limit of the check, once, in the PASS
    // line.
    pass('type.font', 'FONT = ' + ty.FONT + '  (installation on reader machines is not checkable offline)');
  }
  if (ty.fallback !== undefined) {
    warn('type.fallback', 'type.fallback is set, and nothing reads it',
      'A Word file names its font and carries no substitute; a reader without FONT sees whatever ' +
      'their copy of Word picks. Delete the key. If FONT may be missing on readers\' machines, ' +
      'choose a FONT that is installed on them instead.');
  }

  // --- naming -------------------------------------------------------------
  // The grammar is brand_kit.js's NAMING, the one every skill that validates
  // a PREFIX or SEGMENT reads.
  const nm = (cfg.naming && typeof cfg.naming === 'object') ? cfg.naming : {};

  if (typeof nm.PREFIX !== 'string' || !NAMING.PREFIX_RE.test(nm.PREFIX)) {
    violation('naming.prefix',
      'naming.PREFIX is ' + JSON.stringify(nm.PREFIX) + ' — must match ' + NAMING.PREFIX_RE,
      'Uppercase letters and digits, 2 to 8 characters, starting with a letter, e.g. "ROAST". ' +
      'The underscore separates the fields of every filename the pack writes ' +
      '({PREFIX}_{SEGMENT}_{Topic}_...), so it cannot appear inside one. The document builders ' +
      'and filename checks that validate a PREFIX apply this same pattern, so a PREFIX that fails ' +
      'here fails there too.');
  } else {
    pass('naming.prefix', 'PREFIX = ' + nm.PREFIX);
  }

  const segs = Array.isArray(nm.SEGMENTS) ? nm.SEGMENTS : null;
  if (!segs || !segs.length) {
    violation('naming.segments', 'naming.SEGMENTS is not a non-empty array',
      'List the process areas this brand files documents under, e.g. ["OPS","SVC"]. ' +
      'The segment is never omitted from a filename.');
  } else {
    const bad = segs.filter((s) => typeof s !== 'string' || !NAMING.SEGMENT_RE.test(s));
    const noDefault = nm.defaultSegment === undefined || nm.defaultSegment === null;
    if (bad.length) {
      violation('naming.segments',
        'invalid segment(s): ' + bad.map((s) => JSON.stringify(s)).join(', ') + ' — must match ' + NAMING.SEGMENT_RE,
        'Uppercase letters and digits, 2 to 10 characters, starting with a letter. No underscore, ' +
        'for the same reason as PREFIX.');
    } else {
      pass('naming.segments', segs.length + ' segment(s): ' + segs.join(', ') +
        (noDefault ? '; no defaultSegment, so builds file under the first, ' + segs[0]
                   : '; default ' + nm.defaultSegment));
    }

    if (!noDefault && !segs.includes(nm.defaultSegment)) {
      violation('naming.default',
        'naming.defaultSegment ' + JSON.stringify(nm.defaultSegment) + ' is not in SEGMENTS',
        'Either add it to SEGMENTS or point defaultSegment at one that is there. Leave it out and ' +
        'builds use the first segment.');
    }
  }

  // --- organization -------------------------------------------------------
  // The agenda and the requirements document print org.name at full width.
  // The QRG header's right-hand cell prints org.shortName, which brand_kit.js
  // fills from org.name when a kit leaves it out — so the width limit falls on
  // whichever of the two lands in that cell, and never on a long full name
  // that has a short form beside it. The width is measured, in Arial Bold.
  const org = (cfg.org && typeof cfg.org === 'object') ? cfg.org : {};
  const hasShort = typeof org.shortName === 'string' && org.shortName.trim() !== '';
  const WRAPS = 'Measured in Arial Bold at ' + T.ORG_SIZE_PT + 'pt against the ' + T.ORG_CELL_PT +
    ' pt the QRG header\'s right-hand cell gives it. Past that it wraps to a second line and the ' +
    'header bar grows, on a document whose whole constraint is one page. ';
  const measure = (s) => r1(boldWidthPt(s, T.ORG_SIZE_PT));
  if (typeof org.name !== 'string' || !org.name.trim()) {
    violation('org.name', 'org.name is not set',
      'The agenda and the requirements document print it, and the QRG header prints it when ' +
      'org.shortName is not set. Set it.');
  } else if (hasShort && measure(org.shortName) > T.ORG_CELL_PT) {
    violation('org.shortName.length',
      'org.shortName measures ' + measure(org.shortName) + ' pt (' + org.shortName.length +
      ' characters), over the ' + T.ORG_CELL_PT + ' pt QRG header cell',
      WRAPS + 'Shorten it.');
  } else if (!hasShort && measure(org.name) > T.ORG_CELL_PT) {
    violation('org.name.length',
      'org.name measures ' + measure(org.name) + ' pt (' + org.name.length + ' characters), over the ' +
      T.ORG_CELL_PT + ' pt QRG header cell, and no org.shortName is set',
      WRAPS + 'Set org.shortName to a form that fits; the QRG header prints that, and org.name stays whole everywhere else.');
  } else if (hasShort) {
    pass('org.name', 'QRG header prints org.shortName: ' + measure(org.shortName) + ' of ' + T.ORG_CELL_PT +
      ' pt (Arial Bold ' + T.ORG_SIZE_PT + 'pt)');
  } else {
    pass('org.name', 'QRG header prints org.name: ' + measure(org.name) + ' of ' + T.ORG_CELL_PT +
      ' pt (Arial Bold ' + T.ORG_SIZE_PT + 'pt)');
  }

  // --- logo ---------------------------------------------------------------
  // A `header` section in an older kit is not read by anything and not checked.
  const lg = (cfg.logo && typeof cfg.logo === 'object') ? cfg.logo : {};
  const boxes = logoBoxes(lg.headerCellDxa);
  if (lg.absent === true || !lg.path) {
    pass('logo.absent', 'no logo declared — documents build without one');
  } else if (typeof lg.path !== 'string') {
    violation('logo.path', 'logo.path is ' + JSON.stringify(lg.path) + ' — not a file path',
      'Set it to the PNG\'s path relative to brand.json, e.g. "logo.png". For no logo, set ' +
      '"absent": true and "path": null.');
  } else {
    // A kit is brand.json and logo.png side by side. Any other path still
    // resolves here, but not once the kit travels as two attachments.
    if (lg.path !== 'logo.png') {
      warn('logo.name', 'logo.path is ' + JSON.stringify(lg.path) + ', not the bare file name logo.png' +
        (/[\\/]/.test(lg.path) ? ' — the logo is in a folder' : ''),
        'Name the logo logo.png, keep it in the same folder as brand.json, and set "path": "logo.png". ' +
        'A kit is those two files side by side, with no folder inside it, so it still works when it ' +
        'travels as two attachments.');
    }
    const logoPath = path.isAbsolute(lg.path) ? lg.path : path.resolve(path.dirname(configPath), lg.path);
    if (!fs.existsSync(logoPath) || !fs.statSync(logoPath).isFile()) {
      violation('logo.missing', 'logo.path does not resolve to a file: ' + logoPath,
        'The path is read relative to brand.json, not to the folder you build from. ' +
        'Move the file or fix the path.');
    } else {
      const buf = fs.readFileSync(logoPath);
      const png = readPng(buf);
      if (!png.ok) {
        violation('logo.format', 'logo is not a usable PNG: ' + png.reason,
          png.damaged
            ? 'A damaged image embeds without error and prints as nothing or as a broken-picture box. ' +
              'Export the logo again from the original artwork, and check it opens in an image viewer.'
            : 'The document builders embed PNG. Convert it, and keep transparency if the header ' +
              'fill is ever anything but white.');
      } else {
        const aspect = png.width / png.height;
        pass('logo.format', png.width + 'x' + png.height + ' PNG, aspect ' + r2(aspect) + ':1');

        // Resolution is only meaningful at the size the image prints. The
        // lowest figure is at the largest print, and that is the one checked.
        // `cap` is the width the box allows at this aspect: what the logo
        // prints at once it has the pixels to fill the box.
        const prints = boxes.map((b) => {
          const s = fitBox(png.width, png.height, b.w, b.h);
          return { where: b.where, box: b, w: s.w, h: s.h, dpi: png.width / s.w, cap: Math.min(b.w, b.h * aspect) };
        });
        const largest = prints.reduce((a, b) =>
          (b.dpi < a.dpi - 1e-9 || (Math.abs(b.dpi - a.dpi) <= 1e-9 && b.cap > a.cap) ? b : a));
        const size = (p) => r2(p.w) + ' x ' + r2(p.h) + ' in';
        if (largest.dpi < T.LOGO_MIN_DPI) {
          // Pixels needed for that box to scale it down to 150 dpi or better.
          const needW = Math.ceil(T.LOGO_MIN_DPI * largest.cap);
          warn('logo.resolution',
            r1(largest.dpi) + ' dpi where it prints largest, the ' + largest.where + ' (printed ' + size(largest) +
            ', box ' + r2(largest.box.w) + ' x ' + r2(largest.box.h) + ' in), under ' + T.LOGO_MIN_DPI,
            'It will be visibly soft in print. Re-export at least ' + needW + ' px wide, from vector if you have it.');
        } else {
          pass('logo.resolution', r1(largest.dpi) + ' dpi where it prints largest, the ' + largest.where +
            ' (' + size(largest) + ')');
        }

        // The shape judged is the mark's, inside any padding (G1FIX-BK): a
        // square mark on a 7:1 canvas is a trim question, and padding is the
        // buyer's to keep. markBox says what the mark is (G1FIX-BK3).
        const box = contentBox(png.pixels, png.width, png.height);
        const mark = markBox(png.pixels, png.width, png.height, box);
        // A blank logo has no shape to judge: it is refused as logo.blank below (G1FIX-BK3).
        if (!(box && box.empty && !box.opaqueGround)) {
          const aspect = mark.w / mark.h;
          if (aspect > T.LOGO_ASPECT_MAX || aspect < T.LOGO_ASPECT_MIN) {
            const wide = aspect > T.LOGO_ASPECT_MAX;
            const thinnest = prints.reduce((a, b) => ((wide ? b.h < a.h : b.w < a.w) ? b : a));
            const markSize = r2(thinnest.w * mark.w / png.width) + ' x ' + r2(thinnest.h * mark.h / png.height) + ' in';
            violation('logo.aspect',
              'aspect ratio ' + r2(aspect) + ':1 is ' + (wide ? 'wider than ' + T.LOGO_ASPECT_MAX + ':1'
                : 'taller than 1:' + Math.round(1 / T.LOGO_ASPECT_MIN)) +
                ', measured on the ' + mark.w + 'x' + mark.h + ' px mark',
              'In the ' + thinnest.where + ' it prints ' + markSize + ', ' +
              (wide ? 'a hairline too thin to read. Use a stacked or badge lockup for documents.'
                    : 'a sliver too narrow to read. Use a horizontal or square lockup for documents.'));
          }
        }

        if (box === null) {
          warn('logo.trim', 'trim not checked — the four corners are different colours, so there is no uniform ground to trim against',
            'If the logo is on a photographic or gradient background, crop it deliberately instead.');
        } else if (box.empty && box.opaqueGround) {
          warn('logo.trim', 'trim not checked — the whole canvas is opaque #' + hexOf(box.opaqueGround) +
            ', so there is no mark on it to measure a margin around',
            'If that block of colour is the logo, there is nothing to do. If the artwork is missing, check the export.');
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
          // A visible mark that is all near-white on a transparent or white
          // ground prints as nothing on the white page: the header comes out
          // blank (ruling-bk-trim-invisible). On a coloured ground it shows.
          let dark = false;
          if (!box.opaqueGround) {
            for (let i = 0; i < png.pixels.length && !dark; i += 4) {
              if (png.pixels[i + 3] >= 16 && !(png.pixels[i] >= T.LOGO_GROUND_MIN &&
                  png.pixels[i + 1] >= T.LOGO_GROUND_MIN && png.pixels[i + 2] >= T.LOGO_GROUND_MIN)) dark = true;
            }
            if (!dark) {
              const W = png.width, H = png.height;
              const clear = [0, W - 1, (H - 1) * W, H * W - 1].some((p) => png.pixels[p * 4 + 3] < 250);
              violation('logo.invisible',
                'every visible pixel is white or near-white on a ' + (clear ? 'transparent' : 'white') +
                ' ground, so on the white page the logo prints as nothing',
                (clear ? 'This is the reversed version, made for dark backgrounds. '
                  : 'The artwork is too pale to see against white paper. ') +
                'Use the colour or dark version of the logo.');
            }
          }
          // Padding is the buyer's to keep (ruling BK-TRIM-1 (c), 2026-10-12):
          // advice, never a refusal.
          if (m[worstSide] > T.LOGO_TRIM_PCT) {
            warn('logo.trim',
              'untrimmed: ' + r1(m[worstSide]) + '% blank margin on the ' + worstSide +
              ' (left ' + r1(m.left) + '%, right ' + r1(m.right) + '%, top ' + r1(m.top) + '%, bottom ' + r1(m.bottom) + '%)' +
              (box.opaqueGround ? ', measured against the opaque #' + hexOf(box.opaqueGround) + ' at its corners' : ''),
              (box.opaqueGround ? 'If #' + hexOf(box.opaqueGround) + ' is the logo\'s own badge or panel, the ' +
                'margin is part of the logo: as delivered is the version to recommend. ' : '') +
              'The builders scale the canvas, not the artwork, so the margin makes the visible logo ' +
              'smaller and lifts it off the header baseline. Show the logo three ways and let the owner ' +
              'pick: as delivered, trimmed to the content box, and trimmed with a border. Content box: ' +
              'x ' + box.minX + '-' + box.maxX + ', y ' + box.minY + '-' + box.maxY + ' (' +
              (box.maxX - box.minX + 1) + 'x' + (box.maxY - box.minY + 1) + ' px).');
          } else {
            pass('logo.trim', 'trimmed — largest blank margin is ' + r1(m[worstSide]) + '% (' + worstSide + ')');
          }
        }
      }
    }
  }

  return findings;
}

module.exports = { checkKit, PAIRS, T, logoBoxes, kitModule, readPng };
