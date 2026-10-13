/**
 * Geo imagery — cities: Natural Earth populated places and urban areas, plus
 * Wikidata for the places Natural Earth leaves out.
 *
 * The loaded data (CITIES, URBAN, urbanFallbackNote) is exported as live
 * bindings: other modules read it, only this one assigns it.
 */

import { clamp } from "../../shared/util.js";
import { cleanText } from "../../shared/text.js";
import { isNum } from "../../shared/geo.js";
import { WDQS } from "../../shared/net.js";
import { CITY_MIN_KM, METRO_MULT, NIGHT_MIN_KM, PLACES_URLS, URBAN_URLS } from "./config.js";

/* ═══════════════════════════════════════════════════════════
   Cities

   Natural Earth populated places supply the index — name, country,
   subdivision and population, which is what makes same-name cities
   separable. Urban-area polygons supply the actual built-up footprint;
   where none matches, a population-derived radius stands in.
   ═══════════════════════════════════════════════════════════ */

export let CITIES = [];
export let URBAN = [];
let cityLoad = null; // in-flight promise, so a double click loads once

export function toRad(d) {
  return (d * Math.PI) / 180;
}

/*
  Rough built-up radius in km when no urban polygon is available.
  Fitted through two anchors — 100k ≈ 5 km, 5M ≈ 30 km — which puts a city
  the size of Berlin near 26 km against a real built-up radius of about 22.
*/
export function radiusFromPopulation(pop) {
  const p = Math.max(1000, pop || 1000);
  return clamp(0.0256 * Math.pow(p, 0.458), 2.5, 60);
}

/* ═══════════════════════════════════════════════════════════
   Wikidata, for the places Natural Earth leaves out

   Natural Earth states that it favours regional significance over population
   when choosing places, so a city can be large and still be absent — Touba in
   Senegal is the second largest in the country but is neither a national nor
   a regional capital. This fills those gaps on request rather than swapping
   the whole dataset for a heavier one.
   ═══════════════════════════════════════════════════════════ */

export function cityQuery(term) {
  // The search term reaches the API service as a quoted literal, so quotes
  // and backslashes are escaped and control characters never get that far.
  const safe = term
    .replace(/[\\"]/g, " ")
    // eslint-disable-next-line no-control-regex -- removing control characters is the point
    .replace(/[\u0000-\u001F]/g, " ")
    .slice(0, 60);
  return `SELECT ?item ?itemLabel ?coord ?pop ?iso ?countryLabel ?adminLabel WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam mwapi:search "${safe}" .
    bd:serviceParam mwapi:language "en" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P31/wdt:P279* wd:Q486972 .
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P1082 ?pop }
  OPTIONAL { ?item wdt:P17 ?country . OPTIONAL { ?country wdt:P297 ?iso } }
  OPTIONAL { ?item wdt:P131 ?admin }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 25`;
}

/* Names arrive from a public wiki, so they are stripped and capped here. */
export const cleanName = (raw, max) => cleanText(raw, max || 80);

/* "Point(-15.8833 14.85)" — longitude first, as WKT has it. */
export function parsePoint(wkt) {
  const m = /^Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(
    String(wkt || "").trim(),
  );
  if (!m) return null;
  const lon = parseFloat(m[1]),
    lat = parseFloat(m[2]);
  if (!isNum(lon) || !isNum(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lon, lat };
}

export async function searchWikidataCities(term) {
  const r = await fetch(WDQS + "?format=json&query=" + encodeURIComponent(cityQuery(term)));
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  const rows = (data && data.results && data.results.bindings) || [];

  const byId = new Map();
  for (const row of rows) {
    const id = (/\/(Q\d+)$/.exec((row.item && row.item.value) || "") || [])[1];
    if (!id || byId.has(id)) continue;
    const name = cleanName(row.itemLabel && row.itemLabel.value, 80);
    if (!name || /^Q\d+$/.test(name)) continue; // no English label is no name
    const pt = parsePoint(row.coord && row.coord.value);
    if (!pt) continue;
    const pop = parseFloat(row.pop && row.pop.value);
    byId.set(id, {
      name,
      ascii: name,
      country: cleanName(row.countryLabel && row.countryLabel.value, 80),
      region: cleanName(row.adminLabel && row.adminLabel.value, 80),
      iso: cleanName(row.iso && row.iso.value, 3),
      pop: Number.isFinite(pop) && pop > 0 ? pop : 0,
      capital: false,
      lon: pt.lon,
      lat: pt.lat,
      urban: undefined,
      wikidata: id,
    });
  }
  return [...byId.values()].sort((a, b) => b.pop - a.pop);
}

export function buildCity(f) {
  const pr = f.properties || {};
  const name = typeof pr.name === "string" ? pr.name.slice(0, 80).trim() : "";
  if (!name) return null;
  const g = f.geometry;
  if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates;
  if (!isNum(lon) || !isNum(lat)) return null;
  return {
    name,
    ascii: typeof pr.nameascii === "string" ? pr.nameascii.slice(0, 80) : name,
    country: typeof pr.adm0name === "string" ? pr.adm0name.slice(0, 80) : "",
    region: typeof pr.adm1name === "string" ? pr.adm1name.slice(0, 80) : "",
    iso: typeof pr.iso_a2 === "string" ? pr.iso_a2.slice(0, 3) : "",
    pop: isNum(pr.pop_max) ? pr.pop_max : 0,
    capital: pr.adm0cap === 1,
    lon,
    lat,
    urban: undefined, // resolved lazily
  };
}

/* Urban polygons, reduced to a bbox plus a decimated ring for hit testing. */
export function buildUrban(f) {
  const g = f.geometry;
  if (!g) return [];
  const polys =
    g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  const out = [];
  for (const rings of polys) {
    const outer = rings[0];
    if (!Array.isArray(outer) || outer.length < 4) continue;
    let lo = Infinity,
      hi = -Infinity,
      la = Infinity,
      lb = -Infinity;
    for (const pt of outer) {
      if (!isNum(pt[0]) || !isNum(pt[1])) continue;
      lo = Math.min(lo, pt[0]);
      hi = Math.max(hi, pt[0]);
      la = Math.min(la, pt[1]);
      lb = Math.max(lb, pt[1]);
    }
    if (!Number.isFinite(lo)) continue;
    out.push({ rings, lon0: lo, lon1: hi, lat0: la, lat1: lb });
  }
  return out;
}

export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* The urban polygons making up this city, in core or metro extent. */
export function urbanFor(city, metro) {
  if (city.urban === undefined) {
    let hit = null;
    for (const u of URBAN) {
      if (city.lon < u.lon0 || city.lon > u.lon1 || city.lat < u.lat0 || city.lat > u.lat1)
        continue;
      if (pointInRing(city.lon, city.lat, u.rings[0])) {
        hit = u;
        break;
      }
    }
    city.urban = hit;
  }
  if (!city.urban) return null;
  if (!metro) return [city.urban];

  // Metro: absorb neighbouring built-up patches, the same transitive rule
  // that keeps an archipelago together.
  const seed = city.urban;
  const reach = 0.16; // degrees, ~15 km
  const group = [seed];
  const seen = new Set([seed]);
  let grew = true;
  while (grew && group.length < 400) {
    grew = false;
    for (const u of URBAN) {
      if (seen.has(u)) continue;
      for (const g of group) {
        if (
          u.lon0 - reach <= g.lon1 &&
          u.lon1 + reach >= g.lon0 &&
          u.lat0 - reach <= g.lat1 &&
          u.lat1 + reach >= g.lat0
        ) {
          group.push(u);
          seen.add(u);
          grew = true;
          break;
        }
      }
      if (grew) break;
    }
  }
  return group;
}

/**
 * The box to frame a city in.
 *
 * @param {any} city
 * @param {boolean} metro frame the whole metropolitan area
 * @param {{night: boolean, res: number}} imagery the layer being shown; framing
 *   is never tighter than its resolution can support
 */
export function cityBBox(city, metro, imagery) {
  const patches = urbanFor(city, metro);
  let bb;
  if (patches) {
    let lo = Infinity,
      hi = -Infinity,
      la = Infinity,
      lb = -Infinity;
    for (const u of patches) {
      lo = Math.min(lo, u.lon0);
      hi = Math.max(hi, u.lon1);
      la = Math.min(la, u.lat0);
      lb = Math.max(lb, u.lat1);
    }
    bb = { lon0: lo, lon1: hi, lat0: la, lat1: lb };
  } else {
    const rKm = radiusFromPopulation(city.pop) * (metro ? METRO_MULT : 1);
    const dLat = rKm / 110.57;
    const dLon = rKm / (111.32 * Math.max(0.15, Math.cos(toRad(city.lat))));
    bb = {
      lon0: city.lon - dLon,
      lon1: city.lon + dLon,
      lat0: city.lat - dLat,
      lat1: city.lat + dLat,
    };
  }
  // Never frame tighter than the imagery can support.
  const floorKm = Math.max(
    CITY_MIN_KM,
    imagery.night ? NIGHT_MIN_KM : (imagery.res * 1600) / 1000 / 8,
  );
  return widenTo(bb, floorKm);
}

/* Grow a box symmetrically until it spans at least minKm in both directions. */
export function widenTo(bb, minKm) {
  const cLat = (bb.lat0 + bb.lat1) / 2;
  const kmPerLon = 111.32 * Math.max(0.15, Math.cos(toRad(cLat)));
  const hKm = (bb.lat1 - bb.lat0) * 110.57;
  const wKm = (bb.lon1 - bb.lon0) * kmPerLon;
  const out = { ...bb };
  if (hKm < minKm) {
    const d = (minKm - hKm) / 2 / 110.57;
    out.lat0 -= d;
    out.lat1 += d;
  }
  if (wKm < minKm) {
    const d = (minKm - wKm) / 2 / kmPerLon;
    out.lon0 -= d;
    out.lon1 += d;
  }
  out.lat0 = Math.max(-89.5, out.lat0);
  out.lat1 = Math.min(89.5, out.lat1);
  return out;
}

/*
  Try each mirror in turn. Reports what every candidate did, because "couldn't
  load" on its own is impossible to act on.
*/
/* Read a response body in chunks, reporting bytes as they decode. */
export async function readJson(response, expected, onBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    return response.json(); // no streaming: no progress
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    text += decoder.decode(value, { stream: true });
    onBytes(received, expected);
  }
  text += decoder.decode();
  return JSON.parse(text);
}

export async function fetchFirst(sources, label, onBytes) {
  const tried = [];
  for (const src of sources) {
    const where = src.url.replace(/^https:\/\/cdn\.jsdelivr\.net\//, "");
    try {
      const r = await fetch(src.url);
      if (!r.ok) {
        tried.push(`${where} → HTTP ${r.status}`);
        continue;
      }
      const data = await readJson(r, src.bytes, onBytes || (() => {}));
      if (!data || !Array.isArray(data.features)) {
        tried.push(`${where} → not GeoJSON`);
        continue;
      }
      return { data, url: src.url, tried };
    } catch (e) {
      tried.push(`${where} → ${e && e.name === "SyntaxError" ? "not JSON" : "unreachable"}`);
    }
  }
  const err = new Error("no source worked");
  err.tried = tried;
  throw err;
}

/**
 * Load the places index (required) and built-up footprints (optional), once.
 *
 * @param {(label: string, frac?: number | null, bytes?: number) => void} progress
 */
export async function loadCities(progress) {
  if (cityLoad) return cityLoad;
  cityLoad = (async () => {
    const places = await fetchFirst(PLACES_URLS, "places", (got, total) =>
      progress("Downloading places", total ? got / total : null, got),
    ); // required

    progress("Indexing places", null);
    await new Promise((r) => setTimeout(r, 0)); // let the bar paint
    CITIES = places.data.features
      .map(buildCity)
      .filter(Boolean)
      .sort((a, b) => b.pop - a.pop);
    if (!CITIES.length) {
      const e = new Error("no usable places");
      e.tried = [places.url.split("/").pop() + " → parsed but held no places"];
      throw e;
    }

    // Footprints are a refinement, not a requirement.
    try {
      const urban = await fetchFirst(URBAN_URLS, "urban", (got, total) =>
        progress("Downloading built-up areas", total ? got / total : null, got),
      );
      progress("Indexing built-up areas", null);
      await new Promise((r) => setTimeout(r, 0));
      URBAN = urban.data.features.flatMap(buildUrban);
    } catch (e) {
      URBAN = [];
      urbanFallbackNote =
        "Built-up outlines are unavailable, so city extents come from a population model and the footprint overlay is off.";
    }
  })().catch((err) => {
    cityLoad = null;
    throw err;
  }); // let a retry work
  return cityLoad;
}

export let urbanFallbackNote = "";
