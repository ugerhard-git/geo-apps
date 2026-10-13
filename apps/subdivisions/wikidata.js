/**
 * Subdivision clouds — a country's first-level divisions from Wikidata.
 *
 * Divisions come from the country's own "contains administrative territorial
 * entity" (P150) statements, skipping any that have been superseded.
 * Wikidata's idea of a first level is its own: the United Kingdom gives four
 * countries, and the United States includes the federal district and the
 * territories alongside the fifty states.
 */

import { WDQS, getJson } from "../../shared/net.js";
import { cleanText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { AREA_UNITS } from "./config.js";

/**
 * @typedef {object} Subdivision
 * @property {string} id Wikidata Q-id
 * @property {string} name English label
 * @property {number | null} population
 * @property {number | null} area in square kilometres
 * @property {string} url Wikidata page
 */

const ISO2 = /^[A-Z]{2}$/;

/**
 * @param {string} iso2 already checked against {@link ISO2}, so safe to embed
 * @returns {string}
 */
function subdivisionQuery(iso2) {
  return `SELECT ?sub ?subLabel ?population ?area WHERE {
  ?country wdt:P297 "${iso2}" .
  ?country p:P150 ?statement .
  ?statement ps:P150 ?sub .
  FILTER NOT EXISTS { ?statement pq:P582 ?ended }
  OPTIONAL { ?sub wdt:P1082 ?population }
  OPTIONAL {
    ?sub p:P2046/psv:P2046 [ wikibase:quantityAmount ?area ; wikibase:quantityUnit ?areaUnit ]
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 400`;
}

/**
 * The first-level divisions of a country, sorted by name.
 *
 * @param {string} iso2
 * @returns {Promise<Subdivision[]>}
 */
export async function loadSubdivisions(iso2) {
  if (!ISO2.test(iso2)) return [];
  const url = WDQS + "?format=json&query=" + encodeURIComponent(subdivisionQuery(iso2));
  const data = await getJson(url);
  const rows = (data && data.results && data.results.bindings) || [];
  /** @type {Map<string, Subdivision>} */
  const byId = new Map();
  for (const row of rows) {
    const uri = row.sub && typeof row.sub.value === "string" ? row.sub.value : "";
    const id = /\/(Q\d+)$/.exec(uri);
    if (!id) continue;
    const label = cleanText(row.subLabel && row.subLabel.value, 60);
    // A missing English label comes back as the bare Q-number; that is not a name.
    if (!label || /^Q\d+$/.test(label)) continue;
    /** @param {string} k */
    const num = (k) => {
      const v = row[k] && row[k].value;
      const n = v === undefined ? NaN : parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    // Convert the area into one unit, or drop it if the unit is unfamiliar.
    let area = num("area");
    if (area !== null) {
      const unitUri =
        row.areaUnit && typeof row.areaUnit.value === "string" ? row.areaUnit.value : "";
      const unitId = (/\/(Q\d+)$/.exec(unitUri) || [])[1] || "";
      const factor = own(AREA_UNITS, unitId);
      area = typeof factor === "number" ? area * factor : null;
    }
    const existing = byId.get(id[1]);
    const rec = {
      id: id[1],
      name: label,
      population: num("population"),
      area,
      url: "https://www.wikidata.org/wiki/" + id[1],
    };
    // Several statements can name the same entity; keep the fullest.
    if (!existing) byId.set(id[1], rec);
    else {
      existing.population = existing.population || rec.population;
      existing.area = existing.area || rec.area;
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
