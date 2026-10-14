/**
 * Landmarks — reading a country's precomputed candidate list.
 *
 * The files in data/ are written monthly by scripts/landmarks/build-data.mjs
 * from Wikidata. They are served by this site, but their content still came
 * from a public wiki, so every field is checked again here: ids and codes
 * against their patterns, text cleaned and capped, file names free of path
 * or markup characters. A malformed entry is dropped, not trusted.
 *
 * Pure apart from `loadCountry`, so `parseCountryFile` can be unit-tested.
 */

import { cleanText } from "../../shared/text.js";
import { MAX_ITEMS } from "./config.js";

/**
 * @typedef {object} Landmark
 * @property {string} id Wikidata id
 * @property {string} name
 * @property {number} sl Wikipedias with an article about it
 * @property {number} rank 1 for the best known
 * @property {string} file Commons file name of its photograph
 * @property {"built" | "natural" | "both" | ""} kind
 * @property {string[]} types
 * @property {boolean} whs
 * @property {{id: string, name: string} | null} partOf
 * @property {string[]} also other countries it lies in
 * @property {string} cat Commons category with more photographs
 */

const KINDS = new Set(["built", "natural", "both", ""]);
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const UNSAFE_NAME = /[\\/<>|{}[\]#\u0000-\u001f]/;

/**
 * @param {unknown} v
 * @param {number} max
 */
const text = (v, max) => (typeof v === "string" ? cleanText(v, max) : "");

/**
 * Check and clean one country's file.
 *
 * @param {any} data
 * @param {string} iso the country asked for
 * @returns {Landmark[]} best known first
 * @throws when the file isn't a candidate list for that country
 */
export function parseCountryFile(data, iso) {
  if (!data || typeof data !== "object" || data.country !== iso || !Array.isArray(data.items))
    throw new Error("unexpected data file");
  /** @type {Landmark[]} */
  const out = [];
  const seen = new Set();
  for (const it of data.items.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== "object") continue;
    const id = typeof it.id === "string" && /^Q\d{1,12}$/.test(it.id) ? it.id : "";
    const name = text(it.name, 120);
    const file = text(it.file, 240);
    if (!id || seen.has(id) || !name || !file || UNSAFE_NAME.test(file)) continue;
    if (!/\.(jpe?g|png|gif|webp|tiff?)$/i.test(file)) continue;
    seen.add(id);
    const p = it.partOf;
    const partOf =
      p && typeof p === "object" && typeof p.id === "string" && /^Q\d{1,12}$/.test(p.id)
        ? { id: p.id, name: text(p.name, 120) }
        : null;
    const cat = text(it.cat, 200);
    out.push({
      id,
      name,
      sl: Number.isInteger(it.sl) && it.sl >= 0 && it.sl < 2000 ? it.sl : 0,
      rank: 0,
      file,
      kind: KINDS.has(it.kind) ? it.kind : "",
      types: (Array.isArray(it.types) ? it.types : [])
        .map((t) => text(t, 60))
        .filter(Boolean)
        .slice(0, 4),
      whs: it.whs === true,
      partOf,
      also: (Array.isArray(it.also) ? it.also : [])
        .filter((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c) && c !== iso)
        .slice(0, 30),
      cat: UNSAFE_NAME.test(cat) ? "" : cat,
    });
  }
  out.sort((a, b) => b.sl - a.sl);
  out.forEach((l, i) => (l.rank = i + 1));
  return out;
}

/**
 * Fetch a country's file from this site.
 *
 * @param {string} iso
 * @returns {Promise<Landmark[] | null>} null when there is no file for it
 */
export async function loadCountry(iso) {
  if (!/^[A-Z]{2}$/.test(iso)) return null;
  const r = await fetch(`data/${iso}.json`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  return parseCountryFile(await r.json(), iso);
}

/**
 * Whether a landmark passes the Built / Natural filter.
 *
 * @param {Landmark} l
 * @param {"all" | "built" | "natural"} filter
 */
export const kindMatches = (l, filter) =>
  filter === "all" || l.kind === filter || l.kind === "both";
