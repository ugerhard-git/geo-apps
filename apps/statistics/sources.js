/**
 * Country statistics — fetching from each data source.
 *
 * Every loader here returns plain data and caches what is expensive, so the
 * same file is never downloaded twice in a session.
 */

import { URL_TERRITORIES, parseTerritories } from "../../shared/cldr.js";
import { URL_COUNTRY_CODES, getJson, httpError, parseCsv } from "../../shared/net.js";
import { bareName, cleanText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import {
  FACTBOOK,
  FACTBOOK_FOLDERS,
  FOLDER_BY_INTERMEDIATE,
  FOLDER_BY_SUBREGION,
  OWID,
  RELIGION_YEAR,
  URL_LANGUAGE_NAMES,
  URL_RELIGION,
  URL_TERRITORY_INFO,
  WORLD_BANK,
} from "./config.js";

/** @typedef {{label: string, value: number}} Slice */

/* ═══════════════════════════════════════════════════════════
   CLDR: countries and their languages
   ═══════════════════════════════════════════════════════════ */

/**
 * @typedef {object} Reference
 * @property {import("../../shared/cldr.js").Territory[]} countries sorted by name
 * @property {Record<string, any>} territoryInfo CLDR's supplemental territory info
 */

/**
 * The country list, and CLDR's per-territory language data.
 *
 * @returns {Promise<Reference>}
 */
export async function loadReference() {
  const [terr, info] = await Promise.all([getJson(URL_TERRITORIES), getJson(URL_TERRITORY_INFO)]);
  const countries = parseTerritories(terr).sort((a, b) =>
    bareName(a.name).localeCompare(bareName(b.name)),
  );
  if (!countries.length) throw new Error("no countries returned");
  const ti = info && info.supplemental && info.supplemental.territoryInfo;
  if (!ti) throw new Error("unexpected territory info");
  /*
    Guard the shape rather than discovering later that every country
    silently has no languages.
  */
  const withLanguages = Object.keys(ti).filter((k) => {
    const rec = own(ti, k);
    return rec && rec.languagePopulation && Object.keys(rec.languagePopulation).length;
  }).length;
  if (!withLanguages) throw new Error("territory info carried no language data");
  return { countries, territoryInfo: ti };
}

/** @type {Record<string, string>} */
let languageNamesCache = {};

/**
 * Language display names, loaded only when a language chart is first wanted.
 *
 * @returns {Promise<Record<string, string>>} by language code
 */
export async function languageNames() {
  if (Object.keys(languageNamesCache).length) return languageNamesCache;
  const data = await getJson(URL_LANGUAGE_NAMES);
  const l =
    data &&
    data.main &&
    data.main.en &&
    data.main.en.localeDisplayNames &&
    data.main.en.localeDisplayNames.languages;
  languageNamesCache = l && typeof l === "object" ? l : {};
  return languageNamesCache;
}

/* ═══════════════════════════════════════════════════════════
   Pew Research: religion
   ═══════════════════════════════════════════════════════════ */

/** @type {Map<string, Slice[]> | null} */
let religionRows = null;

/**
 * Religious composition by country, keyed by bare country name.
 *
 * The CSV is published as ISO-8859-1, so decoding it as UTF-8 would mangle
 * names like Côte d'Ivoire — which is also the key the rows are matched on.
 *
 * @returns {Promise<Map<string, Slice[]>>}
 */
export async function loadReligion() {
  if (religionRows) return religionRows;
  const r = await fetch(URL_RELIGION);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const buf = await r.arrayBuffer();
  const text = new TextDecoder("iso-8859-1").decode(buf);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("religion data was empty");
  const head = rows[0].map((h) => cleanText(h, 40));
  const iYear = head.indexOf("Year");
  const iCountry = head.indexOf("Country");
  if (iYear < 0 || iCountry < 0) throw new Error("unexpected religion columns");
  const groups = head
    .map((h, i) => ({ label: h, i }))
    .filter((g) => g.i !== iYear && g.i !== iCountry && g.label !== "Region");
  /** @type {Map<string, Slice[]>} */
  const byCountry = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < head.length) continue;
    if (cleanText(row[iYear], 8) !== RELIGION_YEAR) continue;
    const country = cleanText(row[iCountry], 80);
    if (!country || /^all countries$/i.test(country)) continue;
    byCountry.set(
      bareName(country),
      groups
        .map((g) => ({ label: g.label, value: parseFloat(row[g.i]) }))
        .filter((s) => Number.isFinite(s.value) && s.value > 0),
    );
  }
  religionRows = byCountry;
  return byCountry;
}

/* ═══════════════════════════════════════════════════════════
   Country codes: ISO to FIPS (for the Factbook) and ISO3 (for OWID)
   ═══════════════════════════════════════════════════════════ */

/**
 * @typedef {object} CodeEntry
 * @property {string} fips FIPS 10-4 / GEC code, e.g. "GM" for Germany
 * @property {string} iso3
 * @property {string} sub UN sub-region, lower case
 * @property {string} mid UN intermediate region, lower case
 */

/** @type {Map<string, CodeEntry> | null} */
let codesByIso = null;

/*
  The mapping is spot-checked on load: a silently wrong code would serve one
  country's data under another's name, which is worse than no data at all.
*/
const CODE_SPOT_CHECK = [
  ["DE", "GM"],
  ["AT", "AU"],
  ["CH", "SZ"],
  ["ES", "SP"],
  ["ZA", "SF"],
];

/**
 * The ISO → FIPS/ISO3/region crosswalk, from a published table rather than
 * from memory.
 *
 * @returns {Promise<Map<string, CodeEntry>>} by ISO alpha-2 code
 */
export async function loadCountryCodes() {
  if (codesByIso) return codesByIso;
  const r = await fetch(URL_COUNTRY_CODES);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const rows = parseCsv(await r.text());
  if (rows.length < 2) throw new Error("country codes were empty");
  const head = rows[0].map((h) => cleanText(h, 60));
  const iFips = head.indexOf("FIPS");
  const iIso = head.indexOf("ISO3166-1-Alpha-2");
  const iIso3 = head.indexOf("ISO3166-1-Alpha-3");
  const iSub = head.indexOf("Sub-region Name");
  const iMid = head.indexOf("Intermediate Region Name");
  if (iFips < 0 || iIso < 0) throw new Error("no FIPS/ISO columns");
  /** @type {Map<string, CodeEntry>} */
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length <= Math.max(iFips, iIso)) continue;
    const iso = cleanText(row[iIso], 4).toUpperCase();
    const fips = cleanText(row[iFips], 4).toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso) || !/^[A-Z0-9]{2}$/.test(fips)) continue;
    map.set(iso, {
      fips,
      iso3: cleanText(iIso3 >= 0 ? row[iIso3] : "", 4).toUpperCase(),
      sub: cleanText(iSub >= 0 ? row[iSub] : "", 60).toLowerCase(),
      mid: cleanText(iMid >= 0 ? row[iMid] : "", 60).toLowerCase(),
    });
  }
  const wrong = CODE_SPOT_CHECK.filter(([iso, fips]) => {
    const got = map.get(iso);
    return !got || got.fips !== fips;
  });
  if (wrong.length)
    throw new Error("crosswalk failed its check on " + wrong.map((w) => w[0]).join(", "));
  codesByIso = map;
  return map;
}

/* ═══════════════════════════════════════════════════════════
   The Factbook archive
   ═══════════════════════════════════════════════════════════ */

/**
 * The Factbook region folders to try, likeliest first. Most countries resolve
 * on the first guess; none needs more than a few.
 *
 * @param {CodeEntry | undefined} entry
 * @returns {string[]}
 */
function folderOrder(entry) {
  const first = [];
  if (entry) {
    const a = own(FOLDER_BY_INTERMEDIATE, entry.mid);
    const b = own(FOLDER_BY_SUBREGION, entry.sub);
    if (a) first.push(a);
    if (b && !first.includes(b)) first.push(b);
  }
  return [...first, ...FACTBOOK_FOLDERS.filter((f) => !first.includes(f))];
}

/** @type {Map<string, any>} */
const factbookCache = new Map();

/**
 * A country's Factbook entry. Its files are keyed by GEC codes, which descend
 * from FIPS 10-4.
 *
 * @param {string} iso2
 * @returns {Promise<any | null>}
 */
export async function loadFactbook(iso2) {
  if (factbookCache.has(iso2)) return factbookCache.get(iso2);
  const map = await loadCountryCodes();
  const entry = map.get(iso2);
  if (!entry) {
    factbookCache.set(iso2, null);
    return null;
  }
  const code = entry.fips.toLowerCase();
  if (!/^[a-z0-9]{2}$/.test(code)) {
    factbookCache.set(iso2, null);
    return null;
  }
  for (const folder of folderOrder(entry)) {
    try {
      const data = await getJson(`${FACTBOOK}/${folder}/${code}.json`);
      if (data && typeof data === "object") {
        factbookCache.set(iso2, data);
        return data;
      }
    } catch {
      /* wrong folder, try the next */
    }
  }
  factbookCache.set(iso2, null);
  return null;
}

/* ═══════════════════════════════════════════════════════════
   Our World in Data
   ═══════════════════════════════════════════════════════════ */

/*
  Labels come from whatever columns the chart returns rather than from a list
  written here: OWID can rename or add a source, and a hardcoded list would
  then quietly drop it.
*/
const OWID_STRIP = [
  /^share of electricity (?:generation |production )?from\s+/i,
  /^electricity (?:generation |production )?from\s+/i,
  /\s*\(%\s*[^)]*\)\s*$/,
  /\s*-\s*%.*$/,
];

/**
 * A chart column name made readable for a legend.
 *
 * @param {string} column
 * @returns {string}
 */
function owidLabel(column) {
  let t = String(column || "");
  // Should the short names arrive anyway, "solar_share_elec" becomes "Solar".
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(t))
    t = t.replace(/_(share_elec|share_energy|elec|energy)$/i, "").replace(/_/g, " ");
  for (const re of OWID_STRIP) t = t.replace(re, "");
  t = cleanText(t, 42);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

const ISO3 = /^[A-Z]{3}$/;

/**
 * The latest row of an OWID chart for one country, as slices.
 *
 * @param {string} slug the chart's URL name
 * @param {string} iso3
 * @returns {Promise<{slices: Slice[], year: string} | null>} `null` when the
 *   chart has nothing for this country
 */
export async function owidShares(slug, iso3) {
  if (!ISO3.test(iso3)) return null;
  // OWID's own documentation disagrees with itself over the default for
  // useColumnShortNames, so it is stated rather than assumed: the long names
  // are the readable ones and become the legend.
  const url =
    `${OWID}/${encodeURIComponent(slug)}.csv` +
    `?csvType=filtered&useColumnShortNames=false` +
    `&country=${encodeURIComponent(iso3)}&time=latest`;
  const r = await fetch(url);
  // A chart that simply has nothing for this country is an absence, not a
  // failure; anything else is worth raising.
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw httpError(r.status);
  const rows = parseCsv(await r.text());
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => cleanText(h, 120));
  const iCode = head.findIndex((h) => /^code$/i.test(h));
  const iYear = head.findIndex((h) => /^(year|day)$/i.test(h));
  const skip = new Set([head.findIndex((h) => /^entity$/i.test(h)), iCode, iYear]);
  // The newest row for this country, whatever "latest" returned.
  /** @type {{year: number, row: string[]} | null} */
  let best = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < head.length) continue;
    if (iCode >= 0 && cleanText(row[iCode], 4).toUpperCase() !== iso3) continue;
    const year = iYear >= 0 ? parseInt(row[iYear], 10) : 0;
    if (!best || year > best.year) best = { year, row };
  }
  if (!best) return null;
  const newest = best;
  /** @type {Slice[]} */
  const slices = [];
  head.forEach((h, i) => {
    if (skip.has(i)) return;
    const value = parseFloat(newest.row[i]);
    if (!Number.isFinite(value) || value <= 0) return;
    const label = owidLabel(h);
    if (label) slices.push({ label, value });
  });
  if (!slices.length) return null;
  return { slices, year: newest.year ? String(newest.year) : "" };
}

/* ═══════════════════════════════════════════════════════════
   World Bank
   ═══════════════════════════════════════════════════════════ */

const ISO2 = /^[A-Z]{2}$/;

/**
 * The most recent value of a World Bank indicator for a country.
 *
 * @param {string} iso2
 * @param {string} indicator e.g. "SP.URB.TOTL.IN.ZS"
 * @returns {Promise<{value: number, year: string, updated: string} | null>}
 */
export async function worldBank(iso2, indicator) {
  if (!ISO2.test(iso2) || !/^[A-Z0-9.]{4,20}$/.test(indicator)) return null;
  const url =
    `${WORLD_BANK}/country/${encodeURIComponent(iso2)}` +
    `/indicator/${encodeURIComponent(indicator)}?format=json&mrnev=1`;
  const data = await getJson(url);
  if (!Array.isArray(data) || data.length < 2) return null;
  const meta = data[0] || {};
  const row = Array.isArray(data[1]) ? data[1][0] : null;
  if (!row || typeof row.value !== "number" || !Number.isFinite(row.value)) return null;
  return {
    value: row.value,
    year: cleanText(row.date, 8),
    updated: cleanText(meta.lastupdated, 12),
  };
}
