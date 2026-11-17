// Unit tests for Picture Sheet: telling what a file is from its bytes, and
// turning away anything unsafe (apps/picture-sheet/files.js). Run with
// `npm run test:unit`. The browser side (decoding, the page) is in
// tests/picture-sheet.spec.js.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { MAX_PIXELS, MAX_SIDE } from "../../apps/picture-sheet/config.js";
import {
  checkHeader,
  fitWithin,
  imageSize,
  sheetLabel,
  sniffType,
} from "../../apps/picture-sheet/files.js";

/** @param {...(number | string | number[])} parts bytes, ASCII text or byte lists */
function bytes(...parts) {
  /** @type {number[]} */
  const out = [];
  for (const p of parts) {
    if (typeof p === "string") for (const ch of p) out.push(ch.charCodeAt(0));
    else if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return new Uint8Array(out);
}
const be16 = (/** @type {number} */ n) => [(n >> 8) & 255, n & 255];
const le16 = (/** @type {number} */ n) => [n & 255, (n >> 8) & 255];
const be32 = (/** @type {number} */ n) => [
  (n >>> 24) & 255,
  (n >> 16) & 255,
  (n >> 8) & 255,
  n & 255,
];
const le24 = (/** @type {number} */ n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const pad = (/** @type {number} */ n) => Array(n).fill(0);

/** A PNG's signature and header, declaring w × h. */
const png = (/** @type {number} */ w, /** @type {number} */ h) =>
  bytes([0x89], "PNG\r\n\x1a\n", be32(13), "IHDR", be32(w), be32(h), [8, 6, 0, 0, 0], pad(8));
/** A GIF's header. */
const gif = (/** @type {number} */ w, /** @type {number} */ h) =>
  bytes("GIF89a", le16(w), le16(h), pad(8));
/** A JPEG with an EXIF-sized segment before its frame header. */
const jpeg = (/** @type {number} */ w, /** @type {number} */ h, exif = 3000) =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe1],
    be16(exif + 2),
    pad(exif),
    [0xff, 0xff, 0xc2], // a fill byte, then a progressive frame
    be16(17),
    [8],
    be16(h),
    be16(w),
    pad(12),
  );
const webpLossy = (/** @type {number} */ w, /** @type {number} */ h) =>
  bytes(
    "RIFF",
    pad(4),
    "WEBP",
    "VP8 ",
    pad(4),
    [0, 0, 0],
    [0x9d, 0x01, 0x2a],
    le16(w),
    le16(h),
    pad(4),
  );
const webpLossless = (/** @type {number} */ w, /** @type {number} */ h) => {
  const a = w - 1;
  const b = h - 1;
  return bytes(
    "RIFF",
    pad(4),
    "WEBP",
    "VP8L",
    pad(4),
    [0x2f],
    [a & 255, ((a >> 8) & 0x3f) | ((b & 3) << 6), (b >> 2) & 255, (b >> 10) & 0x0f],
    pad(4),
  );
};
const webpExtended = (/** @type {number} */ w, /** @type {number} */ h) =>
  bytes("RIFF", pad(4), "WEBP", "VP8X", pad(4), pad(4), le24(w - 1), le24(h - 1), pad(4));

test("pictures are known by their first bytes, and their size read from the header", () => {
  const cases = /** @type {const} */ ([
    ["png", png(1200, 800)],
    ["gif", gif(320, 240)],
    ["jpeg", jpeg(4032, 3024)],
    ["webp", webpLossy(1600, 900)],
    ["webp", webpLossless(5000, 7)],
    ["webp", webpExtended(16383, 2)],
  ]);
  const sizes = [
    [1200, 800],
    [320, 240],
    [4032, 3024],
    [1600, 900],
    [5000, 7],
    [16383, 2],
  ];
  cases.forEach(([kind, b], i) => {
    assert.deepEqual(sniffType(b), { kind }, kind);
    assert.deepEqual(imageSize(b, kind), { w: sizes[i][0], h: sizes[i][1] }, `${kind} ${i}`);
    const c = checkHeader(b);
    assert.ok(c.ok, `${kind} ${i} passes`);
  });
});

test("SVG, web pages, scripts and other files are turned away, whatever they're called", () => {
  const bad = [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    "<!doctype html><html><script>alert(1)</script></html>",
    "<html><body><img src=x onerror=alert(1)></body></html>",
    "%PDF-1.7 a document, not a picture",
    "PK\x03\x04 a zip archive pretending",
    "BM a Windows bitmap, not accepted",
    "II*\0 a TIFF file, not accepted.....",
  ];
  for (const text of bad) {
    const c = checkHeader(bytes(text));
    assert.equal(c.ok, false, text);
    assert.match(/** @type {any} */ (c).why, /isn't a JPEG, PNG, GIF or WebP/);
  }
  // A JPEG's first bytes followed by SVG is still not a readable JPEG.
  assert.equal(checkHeader(bytes([0xff, 0xd8, 0xff], "<svg onload=alert(1)>....")).ok, false);
});

test("HEIC and AVIF get a message of their own", () => {
  const heic = bytes(be32(24), "ftypheic", pad(16));
  const c = checkHeader(heic);
  assert.equal(c.ok, false);
  assert.match(/** @type {any} */ (c).why, /HEIC and AVIF/);
});

test("a small file declaring an enormous picture is refused before decoding", () => {
  for (const b of [
    png(40_000, 40_000),
    png(MAX_SIDE + 1, 10),
    png(0xffffffff, 0xffffffff),
    gif(65_535, 65_535),
    jpeg(65_535, 65_535),
    webpExtended(16_777_216, 16_777_216),
    png(10_000, 6_001), // just over 60 megapixels
  ]) {
    const c = checkHeader(b);
    assert.equal(c.ok, false);
    assert.match(/** @type {any} */ (c).why, /too large/);
  }
  assert.ok(checkHeader(png(10_000, 6_000)).ok, "exactly the limit");
  assert.equal(10_000 * 6_000, MAX_PIXELS);
});

test("pictures with no pixels, or a header cut short, are refused", () => {
  assert.equal(checkHeader(png(0, 100)).ok, false);
  assert.equal(checkHeader(gif(100, 0)).ok, false);
  assert.equal(checkHeader(jpeg(0, 0)).ok, false);
  assert.equal(checkHeader(new Uint8Array(0)).ok, false);
  assert.equal(checkHeader(png(100, 100).slice(0, 20)).ok, false);
  // A JPEG whose image data comes before any frame header.
  assert.equal(checkHeader(bytes([0xff, 0xd8, 0xff, 0xda], be16(8), pad(20))).ok, false);
  // A JPEG segment claiming a length of 0 or 1 would never move on.
  assert.equal(checkHeader(bytes([0xff, 0xd8, 0xff, 0xe0], be16(0), pad(20))).ok, false);
  assert.equal(checkHeader(bytes([0xff, 0xd8, 0xff, 0xe0], be16(1), pad(20))).ok, false);
  // A JPEG whose size lies beyond what was read.
  assert.equal(checkHeader(jpeg(800, 600, 3000).slice(0, 2000)).ok, false);
  // WebP with a broken start code.
  const w = webpLossy(100, 100);
  w[23] = 0;
  assert.equal(checkHeader(w).ok, false);
});

test("no sequence of bytes makes the checks throw or run on", () => {
  // A fixed pseudo-random sequence, so a failure can be repeated.
  let seed = 12345;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const starts = [
    png(10, 10),
    gif(10, 10),
    jpeg(10, 10, 40),
    webpLossy(10, 10),
    webpLossless(10, 10),
    webpExtended(10, 10),
  ];
  const t0 = Date.now();
  for (let n = 0; n < 6000; n++) {
    const base = starts[n % starts.length];
    const len = Math.floor(rand() * 200);
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++)
      b[i] = i < base.length && rand() < 0.8 ? base[i] : Math.floor(rand() * 256);
    // JPEGs full of 0xFF and of tiny segments, the hardest case for the walk.
    if (n % 7 === 0) for (let i = 2; i < len; i++) if (rand() < 0.5) b[i] = 0xff;
    const c = checkHeader(b);
    if (c.ok) {
      assert.ok(Number.isInteger(c.w) && Number.isInteger(c.h), "whole numbers");
      assert.ok(
        c.w >= 1 && c.h >= 1 && c.w <= MAX_SIDE && c.h <= MAX_SIDE && c.w * c.h <= MAX_PIXELS,
      );
    } else assert.equal(typeof c.why, "string");
  }
  // A megabyte of 0xFF after a JPEG start: the walk still ends, quickly.
  const ff = new Uint8Array(1024 * 1024).fill(0xff);
  ff[1] = 0xd8;
  assert.equal(checkHeader(ff).ok, false);
  assert.ok(Date.now() - t0 < 5000, "fast");
  // Not even a Uint8Array.
  assert.equal(checkHeader(/** @type {any} */ (null)).ok, false);
  assert.equal(checkHeader(/** @type {any} */ ("GIF89a")).ok, false);
});

test("pictures are kept no longer than the limit, and never enlarged", () => {
  assert.deepEqual(fitWithin(4000, 3000, 2000), { w: 2000, h: 1500 });
  assert.deepEqual(fitWithin(3000, 4000, 2000), { w: 1500, h: 2000 });
  assert.deepEqual(fitWithin(800, 600, 2000), { w: 800, h: 600 });
  assert.deepEqual(fitWithin(20_000, 1, 2000), { w: 2000, h: 1 });
});

test("labels and numbers under the pictures are optional", () => {
  const both = { numbers: true, labels: true };
  assert.equal(sheetLabel(0, "Lisbon", both), "1. Lisbon");
  assert.equal(sheetLabel(4, "", both), "5");
  assert.equal(sheetLabel(0, "Lisbon", { numbers: false, labels: true }), "Lisbon");
  assert.equal(sheetLabel(2, "Lisbon", { numbers: true, labels: false }), "3");
  assert.equal(sheetLabel(2, "Lisbon", { numbers: false, labels: false }), "");
});

test("the page fetches nothing, shows no images by URL and builds no markup", () => {
  const html = readFileSync("apps/picture-sheet/index.html", "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /img-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/gif,image\/webp"/);
  for (const f of readdirSync("apps/picture-sheet").filter((x) => x.endsWith(".js"))) {
    const code = readFileSync(`apps/picture-sheet/${f}`, "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const bad of [
      /innerHTML/,
      /outerHTML/,
      /insertAdjacentHTML/,
      /\beval\(/,
      /new Function/,
      /createObjectURL/,
      /\bfetch\(/,
    ])
      assert.ok(!bad.test(code), `${f}: ${bad}`);
  }
});
