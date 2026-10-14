/**
 * Landmarks data — turning QLever's rows into one country's candidate list.
 *
 * Pure (no network, no files), so the rules can be unit-tested. The query
 * that produces the rows is in query.js; the runner is build-data.mjs.
 *
 * Everything from Wikidata is cleaned here before it is written to the
 * repository: ids and codes must match their patterns, text is stripped of
 * control characters and capped, and the photo must be a plain Commons file
 * name. The app checks the files again when it reads them.
 */

import { cleanText } from "../../shared/text.js";

/** How many candidates are kept per country. */
export const KEEP = 80;

/** Fewer Wikipedia articles than this and a place is too obscure to be a clue. */
export const MIN_SITELINKS = 8;

/** Language order for names, when there is no English one. */
const NAME_LANGS = ["en", "en-gb", "en-us", "mul", "fr", "es", "de", "it", "pt", "nl"];

/*
  Broad geography rather than a single sight. An item is dropped when every
  one of its types is like this ("strait", "mountain range"); one sight-like
  type ("mountain", "lake") keeps it.
*/
const BROAD =
  /\b(sea|strait|gulf|bay|bight|channel|plain|plateau|region|basin|peninsula|archipelago|island group|island|islands|ecoregion|bioregion|lowland|upland|belt|arc|depression|physiographic province|drainage basin|mountain range|massif|landscape|ocean|geographic location|geographic region|peneplain|cordillera|river|delta|watershed|continent|continental fragment)$/i;

/*
  Places people live in. Matched against the whole type name — "city" or
  "port city" but not "city gate" or "city palace".
*/
const SETTLEMENT =
  /^(?:(?:big|small|port|border|capital|ancient|old|new|largest|global|imperial|free|statutory|county|market|spa|seaside|university|mining|resort)\s+)?(city|town|village|hamlet|municipality|metropolis|commune|suburb|neighbou?rhood|quarter|district|prefecture|province|county|department|state|region|capital|urban area|settlement)$|^(city|town|village|municipality|commune|prefecture|province|county|department|capital|district|region) (of|in) /i;

/* Built things that can't be shown as one recognisable picture. */
const NOT_A_SIGHT =
  /\b(tunnel|power station|power plant|circuit|racetrack|race track|racing track|railway line|railway|road|highway|motorway|expressway|route|pipeline|transmission line|mine|oil field|gas field)$/i;

/* A type that makes a thing a sight even when another type is NOT_A_SIGHT. */
const SIGHT =
  /\b(bridge|dam|tower|arch|gate|monument|palace|castle|temple|church|cathedral|mosque|museum|stadium|landmark)$/i;

/**
 * @typedef {object} Landmark
 * @property {string} id Wikidata id
 * @property {string} name
 * @property {number} sl sitelinks: Wikipedias with an article about it
 * @property {string} file Commons file name of its photograph
 * @property {number} lat
 * @property {number} lon
 * @property {"built" | "natural" | "both" | ""} kind
 * @property {string[]} types up to four English type names
 * @property {boolean} whs a World Heritage Site, or part of one
 * @property {{id: string, name: string} | null} partOf the site it belongs to
 * @property {string[]} also other countries it lies in (ISO codes)
 * @property {string} cat its Commons category, for other photographs
 */

/** @param {any} row @param {string} k */
const val = (row, k) => (row && row[k] && typeof row[k].value === "string" ? row[k].value : "");
/** @param {string} uri */
const qid = (uri) =>
  (/^http:\/\/www\.wikidata\.org\/entity\/(Q\d{1,12})$/.exec(uri) || [])[1] || "";

/**
 * A Commons file name from a P18 value ("http://commons.wikimedia.org/wiki/Special:FilePath/X.jpg").
 *
 * @param {string} uri
 * @returns {string} "" when it isn't one
 */
export function fileName(uri) {
  const m = /^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/([^?#/]+)$/.exec(uri);
  if (!m) return "";
  let name;
  try {
    name = decodeURIComponent(m[1]).replace(/_/g, " ");
  } catch {
    return "";
  }
  // A file name, nothing that could be a path or carry markup.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\\/<>|{}[\]#\u0000-\u001f]/.test(name) || name.length > 240) return "";
  return /\.(jpe?g|png|gif|webp|tiff?)$/i.test(name) ? name : "";
}

/**
 * The best name: English, then other languages in NAME_LANGS order.
 *
 * @param {string} english
 * @param {string} others "lang::name" pairs joined with " || "
 */
export function pickName(english, others) {
  if (english) return cleanText(english, 120);
  /** @type {Map<string, string>} */
  const byLang = new Map();
  for (const pair of others.split(" || ")) {
    const [lang, ...rest] = pair.split("::");
    if (lang && rest.length && !byLang.has(lang)) byLang.set(lang, rest.join("::"));
  }
  for (const lang of NAME_LANGS) if (byLang.get(lang)) return cleanText(byLang.get(lang), 120);
  const any = [...byLang.values()][0];
  return any ? cleanText(any, 120) : "";
}

/**
 * Why a candidate is left out, or "" to keep it.
 *
 * @param {{types: string[], also: string[], isClass: boolean, hasCoord: boolean, hasPop: boolean, arch: boolean, file: string, sl: number}} c
 */
export function dropReason(c) {
  if (!c.file) return "no usable photograph";
  if (c.sl < MIN_SITELINKS) return "too obscure";
  if (c.isClass) return "a type, not a place";
  if (!c.hasCoord) return "no coordinates";
  if (c.also.length >= 3) return `spans ${c.also.length + 1} countries`;
  // A population means a town, region or country — even an ancient one
  // (Cairo, Calais). Ancient sites nobody lives in (Thebes) have none.
  if (c.hasPop) return "has a population (town, region or country)";
  if (!c.arch && c.types.some((t) => SETTLEMENT.test(t))) return "town or region";
  if (!c.arch && c.types.some((t) => PEOPLED.test(t)) && !c.types.some((t) => SIGHT.test(t)))
    return "town or region";
  if (c.types.length && c.types.every((t) => BROAD.test(t))) return "broad geography";
  if (c.types.some((t) => NOT_A_SIGHT.test(t)) && !c.types.some((t) => SIGHT.test(t)))
    return "not a single sight";
  return "";
}

/**
 * Clean, filter and rank one country's rows.
 *
 * @param {any[]} rows QLever bindings for one country
 * @param {string} iso the country, so it can be left out of `also`
 * @param {string[]} [parents] countries a territory belongs to, also left out
 * @returns {{kept: Landmark[], dropped: Array<{id: string, name: string, sl: number, reason: string}>}}
 */
export function selectLandmarks(rows, iso, parents = []) {
  const notAlso = new Set([iso, ...parents]);
  /** @type {Landmark[]} */
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const r of rows) {
    const id = qid(val(r, "item"));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const sl = parseInt(val(r, "sl"), 10) || 0;
    const types = [
      ...new Set(
        val(r, "types")
          .split(" | ")
          .map((t) => cleanText(t, 60))
          .filter(Boolean),
      ),
    ];
    const groups = new Set(val(r, "groups").split(" ").filter(Boolean));
    const also = [
      ...new Set(
        val(r, "also")
          .split(" ")
          .filter((c) => /^[A-Z]{2}$/.test(c) && !notAlso.has(c)),
      ),
    ].sort();
    const pt = /^Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(
      val(r, "coord").trim(),
    );
    const lon = pt ? parseFloat(pt[1]) : NaN;
    const lat = pt ? parseFloat(pt[2]) : NaN;
    const hasCoord =
      Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    const c = {
      types,
      also,
      isClass: val(r, "isClass") === "1",
      hasCoord,
      hasPop: val(r, "hasPop") === "1",
      arch: val(r, "arch") === "1",
      file: fileName(val(r, "image")),
      sl,
    };
    const name = pickName(val(r, "label"), val(r, "otherLabels"));
    const reason = !name ? "no name" : dropReason(c);
    if (reason) {
      dropped.push({ id, name, sl, reason });
      continue;
    }
    const partId = qid(val(r, "site"));
    const cat = cleanText(val(r, "cat"), 200);
    kept.push({
      id,
      name,
      sl,
      file: c.file,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      kind:
        groups.has("built") && groups.has("natural")
          ? "both"
          : groups.has("built")
            ? "built"
            : groups.has("natural")
              ? "natural"
              : "",
      types: types.slice(0, 4),
      whs: val(r, "whs") === "1",
      partOf:
        partId && partId !== id ? { id: partId, name: cleanText(val(r, "siteLabel"), 120) } : null,
      also,
      // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
      cat: /[<>{}[\]|#\u0000-\u001f]/.test(cat) ? "" : cat,
    });
  }
  kept.sort((a, b) => b.sl - a.sl || a.name.localeCompare(b.name));
  return { kept: kept.slice(0, KEEP), dropped };
}
