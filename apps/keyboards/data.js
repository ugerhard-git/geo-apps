/**
 * Keyboard layouts — reading data/layouts.json (built by
 * scripts/keyboards/build-data.mjs from Unicode CLDR).
 *
 * The file is ours, but it is still checked before use: ids, codes and
 * shapes must match their patterns, legends must be short strings, and the
 * whole file is size-capped. Legends only ever reach a canvas as text.
 */

import { own } from "../../shared/util.js";

/** Far above the real file (about 115 KB). */
export const MAX_BYTES = 2_000_000;

const ID = /^[A-Za-z0-9-]{2,40}$/;
const POS = /^[A-E]\d\d$/;
const SHAPES = new Set(["iso", "ansi", "jis"]);

/**
 * @typedef {object} Layout
 * @property {string} id
 * @property {string} name
 * @property {import("./keys.js").Shape} shape
 * @property {Record<string, string[]>} keys position → [base, shift, altgr, altgrShift, printed, printedShift]
 * @property {string} dead dead-key characters
 * @property {string} latin the Latin layout printed beside a non-Latin one
 */

/**
 * @typedef {object} KeyboardData
 * @property {Map<string, Layout>} layouts
 * @property {Map<string, string[]>} countries ISO code → layout ids, the usual one first
 */

/** @param {unknown} s @param {number} max */
const str = (s, max) => (typeof s === "string" && [...s].length <= max ? s : null);

/**
 * Check and convert the parsed file.
 *
 * @param {any} json
 * @returns {KeyboardData}
 * @throws when the file doesn't have the expected shape
 */
export function parseData(json) {
  if (!json || typeof json !== "object" || !json.layouts || !json.countries)
    throw new Error("unexpected layout data");
  /** @type {Map<string, Layout>} */
  const layouts = new Map();
  for (const id of Object.keys(json.layouts)) {
    const l = own(json.layouts, id);
    if (!ID.test(id) || !l || typeof l !== "object") continue;
    const name = str(l.name, 80);
    if (!name || !SHAPES.has(l.shape) || !l.keys || typeof l.keys !== "object") continue;
    /** @type {Record<string, string[]>} */
    const keys = {};
    for (const pos of Object.keys(l.keys)) {
      const k = own(l.keys, pos);
      if (!POS.test(pos) || !Array.isArray(k) || k.length > 6) continue;
      const legends = k.map((s) => str(s, 6) ?? "");
      keys[pos] = legends;
    }
    if (Object.keys(keys).length < 30) continue;
    const latin = typeof l.latin === "string" && ID.test(l.latin) ? l.latin : "en";
    layouts.set(id, { id, name, shape: l.shape, keys, dead: str(l.dead, 40) || "", latin });
  }
  /** @type {Map<string, string[]>} */
  const countries = new Map();
  for (const cc of Object.keys(json.countries)) {
    const ids = own(json.countries, cc);
    if (!/^[A-Z]{2}$/.test(cc) || !Array.isArray(ids)) continue;
    const ok = ids.filter((id) => typeof id === "string" && layouts.has(id)).slice(0, 8);
    if (ok.length) countries.set(cc, ok);
  }
  if (!layouts.has("en") || !countries.size) throw new Error("the layout data is incomplete");
  for (const l of layouts.values()) if (!layouts.has(l.latin)) l.latin = "en";
  return { layouts, countries };
}

/**
 * Fetch and check the data.
 *
 * @returns {Promise<KeyboardData>}
 */
export async function loadData() {
  const r = await fetch("data/layouts.json");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new Error("the layout file is too large");
  return parseData(JSON.parse(text));
}
