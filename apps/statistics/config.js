/**
 * Country statistics — the statistics on offer, and where each comes from.
 */

import { cldrUrl } from "../../shared/cldr.js";

const GH = "https://cdn.jsdelivr.net/gh";

/** Which languages each territory speaks, and by what share of people. */
export const URL_TERRITORY_INFO = cldrUrl("cldr-core", "supplemental/territoryInfo.json");
/** English names of languages. */
export const URL_LANGUAGE_NAMES = cldrUrl("cldr-localenames-full", "main/en/languages.json");
/** Pew Research religion estimates and projections, by country. */
export const URL_RELIGION = `${GH}/datasets/world-religion-projections@main/rounded_percentage.csv`;
export const WORLD_BANK = "https://api.worldbank.org/v2";
/** An archive of the CIA World Factbook, one JSON file per country. */
export const FACTBOOK = `${GH}/factbook/factbook.json@master`;

/*
  Our World in Data's chart API returns one country's rows rather than the
  whole world. This is actual generation, not installed capacity — the figure
  the Factbook carried, which flattered intermittent sources.
*/
export const OWID = "https://ourworldindata.org/grapher";

/**
 * Each OWID chart, and — critically — whether its numbers are already shares
 * of a whole or absolute quantities. A pie can divide either, but only the
 * first kind should be checked for adding up to 100, and only the second needs
 * its unit naming so "34%" is read as "34% of calories" rather than "34%".
 *
 * @type {Record<string, {slug: string, shares: boolean, unit?: string}>}
 */
export const OWID_CHARTS = {
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
export const FACTBOOK_ARCHIVED = "archived Jan 2026";

/* Its files sit in region folders that match no standard, so the UN sub-region
   orders the guesses and the rest follow as a fallback. */
export const FACTBOOK_FOLDERS = [
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
export const FOLDER_BY_SUBREGION = {
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
export const FOLDER_BY_INTERMEDIATE = {
  caribbean: "central-america-n-caribbean",
  "central america": "central-america-n-caribbean",
  "south america": "south-america",
};

/** Most charts on one sheet. */
export const MAX_CHARTS = 4;

/** Religion data is Pew's estimate for this year; later columns are projections. */
export const RELIGION_YEAR = "2020";

/** Colour schemes for the charts, offered in the "Palette" menu. */
export const PALETTES = [
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

/** Thirteen statistics in a flat list is a wall; four headings make it a menu. */
export const GROUPS = [
  { id: "people", name: "People" },
  { id: "work", name: "Economy and work" },
  { id: "land", name: "Land and energy" },
  { id: "health", name: "Health and food" },
];

/**
 * @typedef {object} Stat
 * @property {string} id
 * @property {string} group one of {@link GROUPS}
 * @property {string} title names the measure, never the country, so it is safe on an export
 * @property {"bar" | "pie"} chart
 * @property {string} source which source fetches it (see series.js)
 * @property {string} blurb
 */

/**
 * Every statistic: where it comes from, what it is called, and how it is drawn.
 *
 * @type {Stat[]}
 */
export const STATS = [
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

/**
 * The World Bank indicators behind each World Bank statistic, with labels.
 *
 * @type {Record<string, Array<[string, string]>>}
 */
export const WB_INDICATORS = {
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
