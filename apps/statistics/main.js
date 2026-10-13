import { clamp, own } from "../../shared/util.js";
import { $, bindColour, note, progress, setSeg } from "../../shared/dom.js";
import { parseHex, safeColour } from "../../shared/colour.js";
import { bareName, cleanText, norm } from "../../shared/text.js";
import { frameSpec } from "../../shared/sheet.js";
import { getJson, parseCsv } from "../../shared/net.js";
import { CLDR_VERSION, NOT_A_COUNTRY, URL_TERRITORIES } from "../../shared/cldr.js";

/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const CDN = "https://cdn.jsdelivr.net";

const URL_TERRITORY_INFO = `${CDN}/npm/cldr-core@${CLDR_VERSION}/supplemental/territoryInfo.json`;
const URL_RELIGION = `${CDN}/gh/datasets/world-religion-projections@main/rounded_percentage.csv`;
const WORLD_BANK = "https://api.worldbank.org/v2";
const URL_COUNTRY_CODES = `${CDN}/gh/datasets/country-codes@main/data/country-codes.csv`;
const FACTBOOK = `${CDN}/gh/factbook/factbook.json@master`;

/*
  Our World in Data's chart API returns one country's rows rather than the
  whole world. This is actual generation, not installed capacity — the figure
  the Factbook carried, which flattered intermittent sources.
*/
const OWID = "https://ourworldindata.org/grapher";

/*
  Each chart, and — critically — whether its numbers are already shares of a
  whole or absolute quantities. A pie can divide either, but only the first
  kind should be checked for adding up to 100, and only the second needs its
  unit naming so "34%" is read as "34% of calories" rather than "34%".
*/
const OWID_CHARTS = {
  electricity: { slug: "share-elec-by-source", shares: true },
  deaths: { slug: "share-of-deaths-by-cause", shares: true },
  employment: { slug: "employment-by-economic-sector", shares: true },
  diet: {
    slug: "dietary-compositions-by-commodity-group",
    shares: false,
    unit: "kilocalories per person per day",
  },
  meat: { slug: "per-capita-meat-type", shares: false, unit: "kilograms per person per year" },
  ghg: { slug: "ghg-emissions-by-sector", shares: false, unit: "tonnes of CO₂-equivalent" },
};

/*
  The Factbook was discontinued on 4 February 2026 and its site taken down, so
  this is an archived snapshot that will never update. Said on every chart it
  feeds, not just in the sources panel.
*/
const FACTBOOK_ARCHIVED = "archived Jan 2026";

/* Its files sit in region folders that match no standard, so the UN sub-region
   orders the guesses and the rest follow as a fallback. */
const FACTBOOK_FOLDERS = [
  "africa",
  "europe",
  "north-america",
  "south-america",
  "central-america-n-caribbean",
  "east-n-southeast-asia",
  "south-asia",
  "central-asia",
  "middle-east",
  "australia-oceania",
];

const FOLDER_BY_SUBREGION = {
  "northern africa": "africa",
  "sub-saharan africa": "africa",
  "northern america": "north-america",
  "latin america and the caribbean": "central-america-n-caribbean",
  "central asia": "central-asia",
  "eastern asia": "east-n-southeast-asia",
  "south-eastern asia": "east-n-southeast-asia",
  "southern asia": "south-asia",
  "western asia": "middle-east",
  "eastern europe": "europe",
  "northern europe": "europe",
  "southern europe": "europe",
  "western europe": "europe",
  "australia and new zealand": "australia-oceania",
  melanesia: "australia-oceania",
  micronesia: "australia-oceania",
  polynesia: "australia-oceania",
};
const FOLDER_BY_INTERMEDIATE = {
  caribbean: "central-america-n-caribbean",
  "central america": "central-america-n-caribbean",
  "south america": "south-america",
};

const MAX_CHARTS = 4;

/* Religion data is Pew's estimate for this year; later columns are projections. */
const RELIGION_YEAR = "2020";

const PALETTES = [
  {
    id: "okabe",
    name: "Okabe–Ito (colour-blind safe)",
    colours: [
      "#0072b2",
      "#e69f00",
      "#009e73",
      "#cc79a7",
      "#56b4e9",
      "#d55e00",
      "#f0e442",
      "#7f7f7f",
    ],
  },
  {
    id: "earth",
    name: "Muted earth",
    colours: [
      "#7a6a53",
      "#a8894c",
      "#5f7a6a",
      "#9c5f4e",
      "#7c7f93",
      "#b09a6b",
      "#4f5d63",
      "#8d8378",
    ],
  },
  {
    id: "bright",
    name: "High contrast",
    colours: [
      "#e6194b",
      "#3cb44b",
      "#ffe119",
      "#4363d8",
      "#f58231",
      "#42d4f4",
      "#f032e6",
      "#9a6324",
    ],
  },
  {
    id: "mono",
    name: "Single hue (prints grey)",
    colours: [
      "#1b3a5c",
      "#2d5885",
      "#3f76ae",
      "#5f93c6",
      "#86aed4",
      "#aac8e2",
      "#cbdcee",
      "#e4eef7",
    ],
  },
];

/*
  Every statistic: where it comes from, what it is called, and how it is drawn.
  Titles name the measure, never the country, so they are safe on an export.
*/
/* Thirteen in a flat list is a wall; four headings make it a menu. */
const GROUPS = [
  { id: "people", name: "People" },
  { id: "work", name: "Economy and work" },
  { id: "land", name: "Land and energy" },
  { id: "health", name: "Health and food" },
];

const STATS = [
  {
    id: "languages",
    group: "people",
    title: "Languages spoken",
    chart: "bar",
    source: "CLDR",
    blurb: "Share of the population speaking each language.",
  },
  {
    id: "religion",
    group: "people",
    title: "Religion",
    chart: "pie",
    source: "Pew Research",
    blurb: "Share of the population by religious group.",
  },
  {
    id: "gdp",
    group: "work",
    title: "GDP by sector",
    chart: "pie",
    source: "World Bank",
    blurb: "Value added by agriculture, industry and services.",
  },
  {
    id: "land",
    group: "land",
    title: "Land use",
    chart: "pie",
    source: "World Bank",
    blurb: "Agricultural land, forest and everything else.",
  },
  {
    id: "urban",
    group: "people",
    title: "Where people live",
    chart: "bar",
    source: "World Bank",
    blurb: "Urban against rural population.",
  },
  {
    id: "age",
    group: "people",
    title: "Age structure",
    chart: "bar",
    source: "World Bank",
    blurb: "Population under 15, 15 to 64, and 65 and over.",
  },
  {
    id: "ethnicity",
    group: "people",
    title: "Ethnic groups",
    chart: "bar",
    source: "Factbook",
    blurb: "Share of the population by ethnic group.",
  },
  {
    id: "electricity",
    group: "land",
    title: "Electricity generation",
    chart: "pie",
    source: "OWID",
    blurb: "Share of electricity generated by each source.",
  },
  {
    id: "deaths",
    group: "health",
    title: "Causes of death",
    chart: "pie",
    source: "OWID",
    blurb: "Share of deaths from each cause.",
  },
  {
    id: "employment",
    group: "work",
    title: "Employment by sector",
    chart: "pie",
    source: "OWID",
    blurb: "Where people work, as opposed to where the money comes from.",
  },
  {
    id: "diet",
    group: "health",
    title: "Diet by food group",
    chart: "pie",
    source: "OWID",
    blurb: "Share of the daily calorie supply from each food group.",
  },
  {
    id: "meat",
    group: "health",
    title: "Meat by type",
    chart: "pie",
    source: "OWID",
    blurb: "Share of meat eaten, by animal.",
  },
  {
    id: "ghg",
    group: "land",
    title: "Greenhouse gases by sector",
    chart: "pie",
    source: "OWID",
    blurb: "Share of emissions from each sector.",
  },
];

const WB_INDICATORS = {
  gdp: [
    ["NV.AGR.TOTL.ZS", "Agriculture"],
    ["NV.IND.TOTL.ZS", "Industry"],
    ["NV.SRV.TOTL.ZS", "Services"],
  ],
  land: [
    ["AG.LND.AGRI.ZS", "Agricultural land"],
    ["AG.LND.FRST.ZS", "Forest"],
  ],
  urban: [["SP.URB.TOTL.IN.ZS", "Urban"]],
  age: [
    ["SP.POP.0014.TO.ZS", "Under 15"],
    ["SP.POP.1564.TO.ZS", "15 to 64"],
    ["SP.POP.65UP.TO.ZS", "65 and over"],
  ],
};

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Reference data
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [],
  TERRITORY_INFO = null,
  RELIGION_ROWS = null,
  LANGUAGE_NAMES = {};

async function loadReference() {
  const [terr, info] = await Promise.all([getJson(URL_TERRITORIES), getJson(URL_TERRITORY_INFO)]);

  const t =
    terr &&
    terr.main &&
    terr.main.en &&
    terr.main.en.localeDisplayNames &&
    terr.main.en.localeDisplayNames.territories;
  if (!t) throw new Error("unexpected territories data");

  const byCode = new Map();
  for (const key of Object.keys(t)) {
    const value = own(t, key);
    if (typeof value !== "string") continue;
    const code = key.split("-")[0];
    if (!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) continue;
    const entry = byCode.get(code) || { code, name: "", aliases: [] };
    if (key === code) entry.name = cleanText(value, 80);
    else entry.aliases.push(cleanText(value, 80));
    byCode.set(code, entry);
  }
  COUNTRIES = [...byCode.values()]
    .filter((e) => e.name)
    .sort((a, b) => bareName(a.name).localeCompare(bareName(b.name)));
  if (!COUNTRIES.length) throw new Error("no countries returned");

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
  TERRITORY_INFO = ti;
}

/* Language display names, loaded only when a language chart is first wanted. */
async function languageNames() {
  if (Object.keys(LANGUAGE_NAMES).length) return LANGUAGE_NAMES;
  const data = await getJson(
    `${CDN}/npm/cldr-localenames-full@${CLDR_VERSION}/main/en/languages.json`,
  );
  const l =
    data &&
    data.main &&
    data.main.en &&
    data.main.en.localeDisplayNames &&
    data.main.en.localeDisplayNames.languages;
  LANGUAGE_NAMES = l && typeof l === "object" ? l : {};
  return LANGUAGE_NAMES;
}

/* ═══════════════════════════════════════════════════════════
   The religion CSV

   Published as ISO-8859-1, so decoding it as UTF-8 mangles names like
   Côte d'Ivoire — which is also the key the rows are matched on.
   ═══════════════════════════════════════════════════════════ */

async function loadReligion() {
  if (RELIGION_ROWS) return RELIGION_ROWS;
  const r = await fetch(URL_RELIGION);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const buf = await r.arrayBuffer();
  const text = new TextDecoder("iso-8859-1").decode(buf);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("religion data was empty");

  const head = rows[0].map((h) => cleanText(h, 40));
  const iYear = head.indexOf("Year"),
    iCountry = head.indexOf("Country");
  if (iYear < 0 || iCountry < 0) throw new Error("unexpected religion columns");

  const groups = head
    .map((h, i) => ({ label: h, i }))
    .filter((g) => g.i !== iYear && g.i !== iCountry && g.label !== "Region");

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
        .map((g) => ({
          label: g.label,
          value: parseFloat(row[g.i]),
        }))
        .filter((s) => Number.isFinite(s.value) && s.value > 0),
    );
  }
  RELIGION_ROWS = byCountry;
  return byCountry;
}

/* ═══════════════════════════════════════════════════════════
   The Factbook archive

   Its files are keyed by GEC codes, which descend from FIPS 10-4, so the
   crosswalk comes from a published table rather than from memory. The
   mapping is spot-checked on load: a silently wrong code would serve one
   country's data under another's name, which is worse than no data at all.
   ═══════════════════════════════════════════════════════════ */

let FIPS_BY_ISO = null;

const CODE_SPOT_CHECK = [
  ["DE", "GM"],
  ["AT", "AU"],
  ["CH", "SZ"],
  ["ES", "SP"],
  ["ZA", "SF"],
];

async function loadCountryCodes() {
  if (FIPS_BY_ISO) return FIPS_BY_ISO;
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

  FIPS_BY_ISO = map;
  return map;
}

/* Most countries resolve on the first guess; none needs more than a few. */
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

const factbookCache = new Map();

async function loadFactbook(iso2) {
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
    } catch (e) {
      /* wrong folder, try the next */
    }
  }
  factbookCache.set(iso2, null);
  return null;
}

/* Split on commas that are not inside brackets, so a parenthetical
   breakdown stays with the category it belongs to. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0,
    cur = "";
  for (const ch of String(text)) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((t) => t.trim()).filter(Boolean);
}

const YEAR_NOTE = /\((?:\d{4}(?:\s*est\.?)?|est\.?)\)\s*$/i;
const SHARE = /^(.*?)[\s,]+(\d+(?:\.\d+)?)\s*%$/;

/*
  "Hungarian 84.3%, Romani 2.1%, other 1.2%, unspecified 13.7% (2022 est.)"
  Anything that will not yield a single clean number — a range, a "<1%" — is
  dropped and counted rather than guessed at.
*/
function parseShareList(raw) {
  const plain = String(raw || "").replace(/<[^>]*>/g, " ");
  const yearMatch = /\((\d{4})[^)]*\)\s*$/.exec(plain);
  const year = yearMatch ? yearMatch[1] : "";
  const body = plain.replace(YEAR_NOTE, "").trim();

  const slices = [];
  let dropped = 0;
  for (const part of splitTopLevel(body)) {
    const cleaned = part.replace(/\([^)]*\)/g, " ").trim();
    const m = SHARE.exec(cleaned);
    if (!m) {
      if (/\d/.test(cleaned)) dropped++;
      continue;
    }
    const label = cleanText(m[1], 42);
    const value = parseFloat(m[2]);
    if (!label || !Number.isFinite(value) || value <= 0) {
      dropped++;
      continue;
    }
    slices.push({ label, value });
  }
  return { slices, dropped, year };
}

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

async function owidShares(slug, iso3) {
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
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    e.status = r.status;
    throw e;
  }
  const rows = parseCsv(await r.text());
  if (rows.length < 2) return null;

  const head = rows[0].map((h) => cleanText(h, 120));
  const iCode = head.findIndex((h) => /^code$/i.test(h));
  const iYear = head.findIndex((h) => /^(year|day)$/i.test(h));
  const skip = new Set([head.findIndex((h) => /^entity$/i.test(h)), iCode, iYear]);

  // The newest row for this country, whatever "latest" returned.
  let best = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < head.length) continue;
    if (iCode >= 0 && cleanText(row[iCode], 4).toUpperCase() !== iso3) continue;
    const year = iYear >= 0 ? parseInt(row[iYear], 10) : 0;
    if (!best || year > best.year) best = { year, row };
  }
  if (!best) return null;

  const slices = [];
  head.forEach((h, i) => {
    if (skip.has(i)) return;
    const value = parseFloat(best.row[i]);
    if (!Number.isFinite(value) || value <= 0) return;
    const label = owidLabel(h);
    if (label) slices.push({ label, value });
  });
  if (!slices.length) return null;
  return { slices, year: best.year ? String(best.year) : "" };
}

/* ═══════════════════════════════════════════════════════════
   World Bank
   ═══════════════════════════════════════════════════════════ */

const ISO2 = /^[A-Z]{2}$/;

async function worldBank(iso2, indicator) {
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

/* ═══════════════════════════════════════════════════════════
   Building each series
   ═══════════════════════════════════════════════════════════ */

/*
  Pies are unreadable past about eight slices, so the small ones are gathered
  rather than drawn as slivers. The gathered count is reported, so nobody
  mistakes "Other" for a single thing.
*/
function condense(slices, limit) {
  const sorted = slices.slice().sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) return { slices: sorted, folded: 0 };
  const keep = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  const sum = rest.reduce((s, r) => s + r.value, 0);
  if (sum > 0) keep.push({ label: "Other", value: sum, isOther: true });
  return { slices: keep, folded: rest.length };
}

async function buildSeries(id, country) {
  if (id === "languages") {
    const rec = own(TERRITORY_INFO, country.code);
    const pop = rec && rec.languagePopulation;
    if (!pop) return null;
    const names = await languageNames();
    const slices = [];
    for (const code of Object.keys(pop)) {
      const entry = own(pop, code);
      const pct = entry && parseFloat(entry._populationPercent);
      if (!Number.isFinite(pct) || pct <= 0) continue;
      slices.push({ label: cleanText(own(names, code) || code, 40), value: pct });
    }
    if (!slices.length) return null;
    const { slices: kept, folded } = condense(slices, 8);
    /*
      These are shares of the population, not slices of one: CLDR puts German
      at 91% and English at 56% for Germany, because a second language counts
      too. So they must not be renormalised, and a pie would be a lie.
    */
    return { slices: kept, folded, absolute: true, note: "CLDR " + CLDR_VERSION };
  }

  if (id === "religion") {
    const table = await loadReligion();
    const forms = [country.name, ...(country.aliases || [])].map(bareName);
    let slices = null;
    for (const f of forms) {
      if (table.has(f)) {
        slices = table.get(f);
        break;
      }
    }
    if (!slices || !slices.length) return null;
    const { slices: kept, folded } = condense(slices, 8);
    return { slices: kept, folded, note: `Pew Research, ${RELIGION_YEAR}` };
  }

  const chart = own(OWID_CHARTS, id);
  if (chart) {
    const map = await loadCountryCodes();
    const entry = map.get(country.code);
    if (!entry || !entry.iso3) return null;
    const got = await owidShares(chart.slug, entry.iso3);
    if (!got) return null;
    const { slices: kept, folded } = condense(got.slices, 8);
    const sum = got.slices.reduce((t, x) => t + x.value, 0);
    return {
      slices: kept,
      folded,
      note: `Our World in Data${got.year ? " " + got.year : ""}`,
      unit: chart.unit || "",
      // Only a set that claims to be shares can fail to add up to 100.
      offTotal: chart.shares && Math.abs(sum - 100) > 5 ? Math.round(sum) : 0,
    };
  }

  if (id === "ethnicity") {
    const book = await loadFactbook(country.code);
    if (!book) return null;
    const people = own(book, "People and Society");
    const field = people && own(people, "Ethnic groups");
    const parsed = parseShareList(field && field.text);
    if (!parsed.slices.length) return null;
    const { slices: kept, folded } = condense(parsed.slices, 10);
    const sum = parsed.slices.reduce((t, x) => t + x.value, 0);
    return {
      slices: kept,
      folded,
      dropped: parsed.dropped,
      absolute: true,
      note: `CIA World Factbook${parsed.year ? " " + parsed.year : ""}, ${FACTBOOK_ARCHIVED}`,
      overHundred: sum > 100.5,
    };
  }

  const spec = own(WB_INDICATORS, id);
  if (!spec) return null;

  const results = [];
  for (const [code, label] of spec) {
    let got = null;
    try {
      got = await worldBank(country.code, code);
    } catch (e) {
      got = null;
    }
    if (got) results.push({ label, value: got.value, year: got.year });
  }
  if (!results.length) return null;

  const year =
    results
      .map((r) => r.year)
      .filter(Boolean)
      .sort()
      .pop() || "";
  const slices = results.map((r) => ({ label: r.label, value: r.value }));

  // Two of these describe a part of a whole; the rest is real and must be shown.
  if (id === "land") {
    const used = slices.reduce((s, x) => s + x.value, 0);
    if (used < 99.5) slices.push({ label: "Other land", value: Math.max(0, 100 - used) });
  }
  if (id === "urban") {
    const urban = slices[0] ? slices[0].value : 0;
    slices.push({ label: "Rural", value: Math.max(0, 100 - urban) });
  }
  return { slices, folded: 0, note: `World Bank, ${year}` };
}

/* ═══════════════════════════════════════════════════════════
   Chart drawing
   ═══════════════════════════════════════════════════════════ */

function palette() {
  const chosen = PALETTES.find((p) => p.id === $("palette").value) || PALETTES[0];
  return chosen.colours;
}

function fitText(ctx, text, max, px, weight) {
  let size = px;
  ctx.font = `${weight || 400} ${size}px "Inter", sans-serif`;
  while (size > 8 && ctx.measureText(text).width > max) {
    size -= 1;
    ctx.font = `${weight || 400} ${size}px "Inter", sans-serif`;
  }
  return size;
}

function drawChartTitle(ctx, title, x, y, w, px, opts) {
  ctx.fillStyle = opts.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const size = fitText(ctx, title, w, px, 600);
  ctx.fillText(title, x, y + size);
  return size * 1.5;
}

function drawSourceLine(ctx, text, x, y, w, px, opts) {
  if (!text) return 0;
  ctx.fillStyle = opts.fg;
  ctx.globalAlpha = 0.5;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const size = fitText(ctx, text, w, px, 400);
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
  return size;
}

/* A value that is already a share of the population stands as it is. */
function formatShare(value, total, absolute) {
  const pct = absolute ? value : total > 0 ? (value / total) * 100 : 0;
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

/* What one legend row needs at a given type size. */
function legendMetrics(ctx, series, total, px, opts) {
  const chip = px * 0.85;
  let maxLabel = 0,
    maxPct = 0;
  ctx.font = `400 ${px}px "Inter", sans-serif`;
  for (const s of series.slices) maxLabel = Math.max(maxLabel, ctx.measureText(s.label).width);
  if (opts.values) {
    ctx.font = `500 ${px}px "Inter", sans-serif`;
    for (const s of series.slices)
      maxPct = Math.max(
        maxPct,
        ctx.measureText(formatShare(s.value, total, series.absolute)).width,
      );
  }
  const rowW = chip + px * 0.5 + maxLabel + (maxPct ? px * 0.6 + maxPct : 0);
  return { rowW, rowH: px * 1.75, chip, maxLabel, maxPct };
}

/*
  Fit the legend to its text rather than to a fixed fraction of the box, and
  drop it underneath the pie when the box is too narrow to carry it alongside.
  Shrinking the type or moving the legend both beat truncating a label to "…".
*/
function pieLayout(ctx, series, total, w, h, opts) {
  const n = series.slices.length;
  const maxPx = clamp(Math.round(h * 0.1), 10, 32);
  const readable = clamp(Math.round(h * 0.048), 10, 18);
  const options = [];

  for (let px = maxPx; px >= 9; px--) {
    const m = legendMetrics(ctx, series, total, px, opts);

    const sidePie = Math.min(w - m.rowW - w * 0.04, h);
    if (m.rowH * n <= h && sidePie > 0)
      options.push({ mode: "side", px, m, pie: sidePie, cols: 1, rows: n });

    const cols = clamp(Math.floor(w / (m.rowW + w * 0.03)), 1, n);
    const rows = Math.ceil(n / cols);
    const belowPie = Math.min(w, h - m.rowH * rows - h * 0.04);
    if (m.rowW <= w && belowPie > 0)
      options.push({ mode: "below", px, m, pie: belowPie, cols, rows });
  }
  if (!options.length) return null;

  // Prefer layouts whose type is still readable, then the largest pie.
  const comfortable = options.filter((o) => o.px >= readable);
  const pool = comfortable.length ? comfortable : options;
  pool.sort((a, b) => b.pie - a.pie || b.px - a.px);
  return pool[0];
}

function drawPieWedges(ctx, series, total, cx, cy, r) {
  const cols = palette();
  let angle = -Math.PI / 2;
  series.slices.forEach((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = cols[i % cols.length];
    ctx.fill();
    angle += sweep;
  });
}

function drawPie(ctx, series, x, y, w, h, opts) {
  const total = series.slices.reduce((s, v) => s + v.value, 0);
  if (total <= 0) return;

  const plan = pieLayout(ctx, series, total, w, h, opts);
  if (!plan) {
    return;
  }

  if (plan.mode === "side") {
    const r = plan.pie / 2;
    drawPieWedges(ctx, series, total, x + r, y + h / 2, r);
    drawLegend(
      ctx,
      series,
      total,
      x + plan.pie + w * 0.04,
      y,
      w - plan.pie - w * 0.04,
      h,
      opts,
      plan,
    );
  } else {
    const r = plan.pie / 2;
    drawPieWedges(ctx, series, total, x + w / 2, y + r, r);
    const ly = y + plan.pie + h * 0.04;
    drawLegend(ctx, series, total, x, ly, w, h - plan.pie - h * 0.04, opts, plan);
  }
}

/* Rows down one column, or wrapped into several when the legend sits below. */
function drawLegend(ctx, series, total, x, y, w, h, opts, plan) {
  const cols = palette();
  const px = plan.px,
    m = plan.m;
  const nCols = plan.mode === "below" ? plan.cols : 1;
  const perCol = Math.ceil(series.slices.length / nCols);
  const colW = nCols > 1 ? w / nCols : w;
  const blockH = m.rowH * perCol;
  const top = y + Math.max(0, (h - blockH) / 2);

  series.slices.forEach((s, i) => {
    const c = Math.floor(i / perCol),
      rowIdx = i % perCol;
    const cx = x + c * colW;
    const ly = top + rowIdx * m.rowH + m.rowH / 2;

    ctx.fillStyle = cols[i % cols.length];
    ctx.fillRect(cx, ly - m.chip / 2, m.chip, m.chip);

    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.fg;
    let pctW = 0;
    if (opts.values) {
      const pct = formatShare(s.value, total, series.absolute);
      ctx.font = `500 ${px}px "Inter", sans-serif`;
      pctW = m.maxPct + px * 0.6;
      ctx.textAlign = "right";
      ctx.fillText(pct, cx + Math.min(colW, m.rowW), ly);
    }
    ctx.textAlign = "left";
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    const room = Math.min(colW, m.rowW) - m.chip - px * 0.5 - pctW;
    let label = s.label;
    // Only ever a last resort: the layout is chosen so this rarely fires.
    while (label.length > 4 && ctx.measureText(label).width > room) label = label.slice(0, -2);
    if (label !== s.label) label = label.replace(/\s+\S*$/, "") + "…";
    ctx.globalAlpha = 0.9;
    ctx.fillText(label, cx + m.chip + px * 0.5, ly);
    ctx.globalAlpha = 1;
  });
}

function drawBars(ctx, series, x, y, w, h, opts) {
  const cols = palette();
  const total = series.slices.reduce((s, v) => s + v.value, 0);
  const max = series.slices.reduce((m, v) => Math.max(m, v.value), 0);
  if (max <= 0) return;

  const n = series.slices.length;
  const lineH = h / n;
  const px = clamp(Math.round(lineH * 0.3), 9, 34);
  ctx.font = `400 ${px}px "Inter", sans-serif`;

  let labelW = 0;
  for (const s of series.slices) labelW = Math.max(labelW, ctx.measureText(s.label).width);
  labelW = Math.min(labelW + px * 0.6, w * 0.4);

  const pctW = opts.values ? px * 2.8 : 0;
  const barMax = w - labelW - pctW;

  series.slices.forEach((s, i) => {
    const ly = y + i * lineH + lineH / 2;
    const bw = Math.max(1, (s.value / max) * barMax);
    const bh = Math.min(lineH * 0.55, px * 1.7);

    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.9;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    ctx.fillText(s.label, x + labelW - px * 0.5, ly);
    ctx.globalAlpha = 1;

    ctx.fillStyle = cols[i % cols.length];
    ctx.fillRect(x + labelW, ly - bh / 2, bw, bh);

    if (opts.values) {
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left";
      ctx.font = `500 ${px}px "Inter", sans-serif`;
      ctx.fillText(formatShare(s.value, total, series.absolute), x + labelW + bw + px * 0.4, ly);
    }
  });
}

function drawChart(ctx, stat, series, x, y, w, h, opts) {
  const titlePx = clamp(Math.round(h * 0.11), 12, 40);
  const used = drawChartTitle(ctx, stat.title, x, y, w, titlePx, opts);
  let bodyH = h - used;
  let bodyY = y + used;

  if (opts.source && series.note) {
    const srcPx = Math.max(9, Math.round(titlePx * 0.52));
    bodyH -= srcPx * 2.1;
    drawSourceLine(ctx, series.note, x, y + h, w, srcPx, opts);
  }
  if (bodyH < 20) return;

  if (stat.chart === "bar") drawBars(ctx, series, x, bodyY, w, bodyH, opts);
  else drawPie(ctx, series, x, bodyY, w, bodyH, opts);
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let chosen = null;
let available = new Map(); // stat id -> series, or null when unavailable
let selected = []; // stat ids, in the order chosen
let busy = 0;

function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#e8eaf0"),
    bg: safeColour($("bgColor").value, "#12141a"),
    transparent: $("optTransparent").checked,
    values: $("optValues").checked,
    source: $("optSource").checked,
    country: $("optCountry").checked,
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true",
  };
}

/* ═══════════════════════════════════════════════════════════
   Laying the sheet out
   ═══════════════════════════════════════════════════════════ */

/* One fills the page; two split the long side; three is two over one; four is a grid. */
function chartBoxes(n, x, y, w, h) {
  const gap = Math.min(w, h) * 0.06;
  if (n <= 1) return [[x, y, w, h]];
  if (n === 2) {
    if (w >= h) {
      const cw = (w - gap) / 2;
      return [
        [x, y, cw, h],
        [x + cw + gap, y, cw, h],
      ];
    }
    const ch = (h - gap) / 2;
    return [
      [x, y, w, ch],
      [x, y + ch + gap, w, ch],
    ];
  }
  const cw = (w - gap) / 2,
    ch = (h - gap) / 2;
  const grid = [
    [x, y, cw, ch],
    [x + cw + gap, y, cw, ch],
    [x, y + ch + gap, cw, ch],
    [x + cw + gap, y + ch + gap, cw, ch],
  ];
  if (n === 3) return [grid[0], grid[1], [x, y + ch + gap, w, ch]];
  return grid;
}

function drawSheet(canvas, opts) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  if (!opts.transparent) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad,
    bottom = H - pad;

  if (opts.caption) {
    const capPx = Math.round(H * 0.045);
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = fitText(ctx, opts.caption, W - pad * 2, capPx, 600);
    ctx.font = `600 ${size}px "Source Serif 4", Georgia, serif`;
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + size * 0.6);
      top += size * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - size * 0.6);
      bottom -= size * 1.9;
    }
  }

  if (opts.country && chosen) {
    const px = Math.round(H * 0.03);
    ctx.font = `500 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chosen.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  const drawable = selected.filter((id) => available.get(id));
  if (!drawable.length) return;

  const boxes = chartBoxes(drawable.length, pad, top, W - pad * 2, bottom - top);
  drawable.forEach((id, i) => {
    const stat = STATS.find((s) => s.id === id);
    const series = available.get(id);
    const [bx, by, bw, bh] = boxes[i];
    if (stat && series) drawChart(ctx, stat, series, bx, by, bw, bh, opts);
  });
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/* One card per statistic, under the heading for its group. */
function statCard(stat) {
  const series = available.get(stat.id);
  const wrap = document.createElement("div");
  wrap.className = "stat" + (selected.includes(stat.id) ? " on" : "") + (series ? "" : " missing");

  const top = document.createElement("div");
  top.className = "top";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = selected.includes(stat.id);
  box.disabled = !series;
  box.addEventListener("change", () => toggleStat(stat.id, box.checked));
  const name = document.createElement("strong");
  name.textContent = stat.title; // text, never markup
  top.append(box, name);

  const p = document.createElement("p");
  if (!series) p.textContent = "No data for this country.";
  else {
    const bits = [`${series.slices.length} categories`, series.note];
    if (series.folded) bits.push(`${series.folded} small ones gathered`);
    if (series.unit) bits.push(`shares of ${series.unit}`);
    if (series.dropped) bits.push(`${series.dropped} couldn't be read`);
    if (series.overHundred) bits.push("shares total over 100%");
    p.textContent = bits.filter(Boolean).join(" · ");
  }

  wrap.append(top, p);
  return wrap;
}

function renderStats() {
  const nodes = [];
  for (const group of GROUPS) {
    const inGroup = STATS.filter((st) => st.group === group.id);
    if (!inGroup.length) continue;
    const ready = inGroup.filter((st) => available.get(st.id)).length;

    const h = document.createElement("h3");
    h.textContent = group.name;
    // Say how many of the group are usable, so an all-grey heading explains itself.
    if (chosen) {
      const count = document.createElement("span");
      count.textContent = ready ? `${ready} of ${inGroup.length} available` : "none available here";
      h.append(count);
    }
    nodes.push(h, ...inGroup.map(statCard));
  }
  $("statList").replaceChildren(...nodes);
  $("picker").hidden = !chosen;
}

function renderSources() {
  const dl = $("sourceList");
  dl.replaceChildren();
  const row = (term, href, label) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label; // text, never markup
      dd.append(a);
    } else dd.textContent = label;
    dl.append(dt, dd);
  };

  const used = new Set(
    selected
      .filter((id) => available.get(id))
      .map((id) => (STATS.find((s) => s.id === id) || {}).source),
  );

  if (used.has("CLDR"))
    row(
      "Languages",
      "https://cldr.unicode.org/",
      `Unicode CLDR ${CLDR_VERSION} — territory language population`,
    );
  if (used.has("Pew Research"))
    row(
      "Religion",
      "https://www.pewresearch.org/religion/2015/04/02/religious-projections-2010-2050/",
      `Pew Research Center, ${RELIGION_YEAR} estimate — via datasets/world-religion-projections, CC BY 4.0`,
    );
  if (used.has("World Bank"))
    row(
      "Indicators",
      "https://data.worldbank.org/",
      "World Bank open data — most recent year with a value, per indicator",
    );
  if (used.has("OWID"))
    row(
      "Electricity",
      "https://ourworldindata.org/grapher/share-elec-by-source",
      "Our World in Data, CC BY 4.0 — adapted from Ember and the Energy Institute",
    );
  if (used.has("Factbook")) {
    row(
      "Factbook archive",
      "https://github.com/factbook/factbook.json",
      "CIA World Factbook, public domain — archived snapshot, January 2026",
    );
    row(
      "Country codes",
      "https://github.com/datasets/country-codes",
      "FIPS to ISO 3166-1 crosswalk, public domain dedication",
    );
  }

  const caveats = [];
  if (selected.includes("languages"))
    caveats.push(
      "Language shares are each a percentage of the population and add up to more than 100%, because someone who speaks two languages counts in both. That is why they are drawn as bars rather than a pie.",
    );
  if (selected.includes("religion"))
    caveats.push(
      `Religion figures are Pew estimates for ${RELIGION_YEAR}; shares below 1% were rounded up to 1% in the published data, so a total can drift past 100%.`,
    );
  if (selected.some((id) => available.get(id) && available.get(id).folded))
    caveats.push(
      "Where a chart had more categories than a pie can carry, the smallest were gathered into Other.",
    );
  if (used.has("Factbook"))
    caveats.push(
      "The CIA discontinued the World Factbook on 4 February 2026 and removed the site, so the Factbook figures come from an archived January 2026 snapshot and will not be updated. Its ethnic categories are the US government's coding of other countries' populations.",
    );
  if (
    selected.includes("ethnicity") &&
    available.get("ethnicity") &&
    available.get("ethnicity").overHundred
  )
    caveats.push(
      "Ethnic shares total more than 100% because people could name more than one group, which is why they are bars rather than a pie.",
    );
  const droppedTotal = selected.reduce((t, id) => t + ((available.get(id) || {}).dropped || 0), 0);
  if (droppedTotal)
    caveats.push(
      `${droppedTotal} ${droppedTotal === 1 ? "category was" : "categories were"} left out because the published figure was a range or an inequality rather than a number.`,
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !selected.length;
}

function toggleStat(id, want) {
  if (want) {
    if (selected.length >= MAX_CHARTS) {
      note(`Four charts is as many as fit on one sheet.`);
      renderStats();
      return;
    }
    if (!selected.includes(id)) selected.push(id);
  } else {
    selected = selected.filter((s) => s !== id);
  }
  note("");
  renderStats();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

let countryMatches = [],
  countryCursor = 0;

function searchCountries(q) {
  const n = norm(q);
  if (!n) return [];
  const scored = [];
  for (const c of COUNTRIES) {
    const forms = [c.name, ...(c.aliases || [])].filter(Boolean).map(bareName);
    const code = c.code.toLowerCase();
    let score = -1;
    if (n.length === 2 && code === n) score = 0;
    else if (forms.includes(n)) score = 1;
    else if (forms.some((f) => f.startsWith(n))) score = 2;
    else if (code.startsWith(n) && n.length <= 2) score = 3;
    else if (forms.some((f) => f.includes(n))) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
    .slice(0, 9)
    .map((s) => s.c);
}

function renderCountryResults() {
  $("countryResults").replaceChildren(
    ...countryMatches.map((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.code = c.code;
      if (i === countryCursor) b.className = "on";
      const code = document.createElement("code");
      code.textContent = c.code; // text, never markup
      const label = document.createElement("span");
      label.textContent = c.name;
      b.append(code, label);
      return b;
    }),
  );
}

async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  $("country").value = c.name;
  countryMatches = [];
  renderCountryResults();
  available = new Map();
  selected = [];
  renderStats();
  note("");
  await refresh();

  progress("Fetching statistics", true);
  const missing = [];
  for (const stat of STATS) {
    progress(`Fetching ${stat.title.toLowerCase()}`, true);
    let series = null;
    try {
      series = await buildSeries(stat.id, c);
    } catch (e) {
      series = null;
    }
    available.set(stat.id, series);
    if (!series) missing.push(stat.title);
    renderStats();
  }
  progress(null);

  // Offer a sensible starting set rather than an empty sheet.
  selected = STATS.map((s) => s.id)
    .filter((id) => available.get(id))
    .slice(0, MAX_CHARTS);
  renderStats();
  note(missing.length ? `No data for: ${missing.join(", ")}. The rest are ready.` : "");
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh() {
  const token = ++busy;
  syncExportState();
  const drawable = selected.filter((id) => available.get(id));
  if (!drawable.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = chosen ? "none" : "block";
    $("sources").hidden = true;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions());
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    renderSources();
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  }
  syncExportState();
}

function syncExportState() {
  const ready = selected.some((id) => available.get(id));
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
}

function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          note("The browser refused to encode the image.", true);
          return;
        }
        // The filename shouldn't give away what the sheet is hiding.
        let slug;
        if (opts.country && chosen) {
          slug = chosen.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        } else {
          let h = 0;
          const seed = (chosen ? chosen.code : "") + "|" + selected.join("|");
          for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
          slug = h.toString(36).slice(0, 6);
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `statistics-${slug || "sheet"}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      type,
      0.95,
    );
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("country").addEventListener("input", (e) => {
  countryMatches = searchCountries(e.target.value);
  countryCursor = 0;
  renderCountryResults();
});
$("country").addEventListener("keydown", (e) => {
  if (!countryMatches.length) return;
  if (e.key === "ArrowDown") {
    countryCursor = (countryCursor + 1) % countryMatches.length;
    renderCountryResults();
    e.preventDefault();
  }
  if (e.key === "ArrowUp") {
    countryCursor = (countryCursor - 1 + countryMatches.length) % countryMatches.length;
    renderCountryResults();
    e.preventDefault();
  }
  if (e.key === "Enter") {
    pickCountry(countryMatches[countryCursor]);
    e.preventDefault();
  }
  if (e.key === "Escape") {
    countryMatches = [];
    renderCountryResults();
  }
});
$("countryResults").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) pickCountry(COUNTRIES.find((c) => c.code === b.dataset.code));
});

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
let sizeTimer;
["customW", "customH"].forEach((id) =>
  $(id).addEventListener("input", () => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(refresh, 400);
  }),
);

["optValues", "optSource", "optCountry", "optTransparent"].forEach((id) =>
  $(id).addEventListener("change", () => {
    syncExportState();
    refresh();
  }),
);

$("palette").addEventListener("change", () => {
  renderSwatches();
  refresh();
});

let capTimer;
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  clearTimeout(capTimer);
  capTimer = setTimeout(refresh, 300);
});
$("capTop").addEventListener("click", () => {
  setSeg($("capTop"), $("capBottom"));
  refresh();
});
$("capBottom").addEventListener("click", () => {
  setSeg($("capBottom"), $("capTop"));
  refresh();
});

bindColour("fgColor", "fgHex", refresh);
bindColour("bgColor", "bgHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

function renderSwatches() {
  const cols = palette();
  $("swatches").replaceChildren(
    ...cols.map((c) => {
      const i = document.createElement("i");
      i.style.background = safeColour(c, "#888888");
      return i;
    }),
  );
}

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("palette").replaceChildren(
  ...PALETTES.map((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    return o;
  }),
);
renderSwatches();
$("capPosField").hidden = !cleanText($("capText").value, 120);
syncExportState();
progress("Loading reference data", true);
loadReference()
  .then(() => {
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
  })
  .catch((err) => {
    progress(null);
    note(
      "Couldn't load the reference data: " +
        cleanText(err && err.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  });
