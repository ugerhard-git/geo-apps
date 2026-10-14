/**
 * The GeoNames city list, shared by City dots and Climate charts.
 *
 * The list comes from the all-the-cities package: every place GeoNames knows
 * with at least 1000 inhabitants, packed as a stream of length-prefixed
 * Protocol Buffers messages. The format is simple enough that a small reader
 * here beats loading a library onto a page that shares its origin (and its
 * saved API keys) with every other app.
 *
 * The file comes from a CDN, so it is treated as untrusted: every length and
 * varint is checked against the end of the buffer, unknown fields are skipped
 * by wire type, and records with impossible values are dropped. Nothing read
 * from it ever reaches the page as markup.
 *
 * `decodeCities` is pure — no DOM, no network — so it can be unit-tested.
 *
 * @module shared/geonames
 */

import { fetchBytes } from "./net.js";
import { cleanText } from "./text.js";

/**
 * Every place in GeoNames with at least 1000 inhabitants, packed by the
 * all-the-cities package (MIT; data from GeoNames, CC BY 4.0). A pinned
 * version, so the file can't change under the page, and one URL for every
 * app, so the browser downloads it once.
 */
export const CITIES_URL = "https://cdn.jsdelivr.net/npm/all-the-cities@3.1.0/cities.pbf";

/** The file is about 6.4 MB; anything far bigger is not the file we expect. */
export const MAX_BYTES = 24 * 1024 * 1024;

/** It holds about 138,000 records. */
export const MAX_RECORDS = 400_000;

/*
  GeoNames feature codes that are not towns in their own right: parts of a
  city (PPLX), and places that are historical, abandoned or destroyed. A city
  and its districts would otherwise show up as a cluster of dots.
*/
export const SKIP_FEATURES = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"]);

/** Credit line GeoNames' licence asks for. */
export const GEONAMES_CREDIT = "Cities: GeoNames, CC BY 4.0";

/**
 * @typedef {object} City
 * @property {number} lon degrees
 * @property {number} lat degrees
 * @property {number} pop population (0 when GeoNames has none)
 * @property {boolean} capital the national capital (GeoNames feature PPLC)
 * @property {string} [name] only when decoded with `names`
 */

/** A malformed file. */
class FormatError extends Error {}

/**
 * A bounds-checked cursor over a byte buffer.
 */
class Reader {
  /**
   * @param {Uint8Array} buf
   * @param {number} pos
   * @param {number} end
   */
  constructor(buf, pos, end) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }

  /**
   * An unsigned varint. Values above 2^49 are rejected: nothing in this file
   * is that large, and stopping there keeps the arithmetic exact.
   *
   * @returns {number}
   */
  varint() {
    let value = 0;
    let mul = 1;
    for (let i = 0; i < 7; i++) {
      if (this.pos >= this.end) throw new FormatError("truncated varint");
      const b = this.buf[this.pos++];
      value += (b & 0x7f) * mul;
      if (b < 0x80) return value;
      mul *= 128;
    }
    throw new FormatError("varint too long");
  }

  /** A zigzag-encoded signed varint. */
  svarint() {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  /**
   * The bounds of a length-delimited field, after which the cursor sits past it.
   *
   * @returns {[number, number]} start and end offsets
   */
  span() {
    const len = this.varint();
    const start = this.pos;
    if (len > this.end - start) throw new FormatError("length runs past the end");
    this.pos = start + len;
    return [start, this.pos];
  }

  /**
   * Skip a field of an unknown tag.
   *
   * @param {number} wire
   */
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 2) this.span();
    else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      if (n > this.end - this.pos) throw new FormatError("truncated field");
      this.pos += n;
    } else throw new FormatError("unknown wire type " + wire);
  }
}

/**
 * Short ASCII strings (country codes, feature codes) straight from the bytes.
 * Anything else, or anything longer than `max`, comes back empty.
 *
 * @param {Uint8Array} buf
 * @param {number} start
 * @param {number} end
 * @param {number} max
 */
function ascii(buf, start, end, max) {
  if (end - start > max) return "";
  let s = "";
  for (let i = start; i < end; i++) {
    const c = buf[i];
    if (c < 0x20 || c > 0x7e) return "";
    s += String.fromCharCode(c);
  }
  return s;
}

const UTF8 = new TextDecoder("utf-8", { fatal: false });

/**
 * Decode the city list and group it by country.
 *
 * Coordinates are stored as differences from the previous record, in units
 * of 10⁻⁵ degrees, so every record is read in order even when it is dropped.
 *
 * Names are only read when asked for: they are untrusted text, cleaned and
 * capped here, and decoding them costs time and memory City dots doesn't need.
 *
 * @param {Uint8Array} buf the contents of `cities.pbf`
 * @param {{names?: boolean}} [opts]
 * @returns {Map<string, City[]>} by ISO alpha-2 country code, largest first
 * @throws when the file is malformed
 */
export function decodeCities(buf, opts = {}) {
  const withNames = !!opts.names;
  const r = new Reader(buf, 0, buf.length);
  /** @type {Map<string, City[]>} */
  const byCountry = new Map();
  let lon = 0;
  let lat = 0;
  let records = 0;
  while (r.pos < r.end) {
    if (++records > MAX_RECORDS) throw new FormatError("too many records");
    const [start, end] = r.span();
    const m = new Reader(buf, start, end);
    let country = "";
    let feature = "";
    let pop = 0;
    /** @type {[number, number] | null} */
    let nameSpan = null;
    while (m.pos < m.end) {
      const key = m.varint();
      const tag = Math.floor(key / 8);
      const wire = key % 8;
      if (tag === 3 && wire === 2) {
        const [a, b] = m.span();
        country = ascii(buf, a, b, 2);
      } else if (tag === 2 && wire === 2) {
        nameSpan = m.span();
      } else if (tag === 7 && wire === 2) {
        const [a, b] = m.span();
        feature = ascii(buf, a, b, 10);
      } else if (tag === 9 && wire === 0) pop = m.varint();
      else if (tag === 10 && wire === 0) lon += m.svarint();
      else if (tag === 11 && wire === 0) lat += m.svarint();
      else m.skip(wire);
    }
    if (!/^[A-Z]{2}$/.test(country) || SKIP_FEATURES.has(feature)) continue;
    const x = lon / 1e5;
    const y = lat / 1e5;
    if (!(x >= -180 && x <= 180 && y >= -90 && y <= 90)) continue;
    let list = byCountry.get(country);
    if (!list) byCountry.set(country, (list = []));
    /** @type {City} */
    const city = { lon: x, lat: y, pop: Math.min(pop, 5e7), capital: feature === "PPLC" };
    if (withNames && nameSpan && nameSpan[1] - nameSpan[0] <= 400)
      city.name = cleanText(UTF8.decode(buf.subarray(nameSpan[0], nameSpan[1])), 80);
    list.push(city);
  }
  for (const list of byCountry.values()) list.sort((a, b) => b.pop - a.pop);
  return byCountry;
}

/**
 * Whether a decode failure was the file's fault rather than the code's.
 *
 * @param {unknown} e
 */
export const isFormatError = (e) => e instanceof FormatError;

/**
 * Download and decode the city list.
 *
 * @param {(frac: number | undefined) => void} onProgress
 * @param {{names?: boolean}} [opts]
 * @returns {Promise<Map<string, City[]>>}
 */
export async function loadCities(onProgress, opts) {
  const bytes = await fetchBytes(CITIES_URL, MAX_BYTES, onProgress);
  const cities = decodeCities(bytes, opts);
  if (!cities.size) throw new Error("no cities in the file");
  return cities;
}
