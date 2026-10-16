/**
 * OWID chart plotter — the ready-made charts, and searching them.
 *
 * Each preset is a chart on ourworldindata.org: its slug (the last part of
 * the chart's address, with any query it needs), the name shown in the list,
 * its group, extra words people might search for, and its source and years
 * as shown under the name. `scripts/owid/preset-info.mjs` reads the source
 * and years from Our World in Data, for keeping these up to date.
 *
 * Adding a chart is one line here; the "Check every preset" tool then
 * confirms it loads.
 */

/**
 * Text made easy to compare: lower case, no accents, "CO₂" as "co2", and any
 * punctuation as a space, so "R&D" is found by "r d" and "foreign-born" by
 * "born".
 *
 * @param {string} s
 */
export const fold = (s) =>
  String(s)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * @typedef {object} Preset
 * @property {string} slug as typed into the slug field
 * @property {string} name shown in the list
 * @property {string} group one of {@link GROUPS}
 * @property {string} words more search words, space-separated
 * @property {string} source the data's source, short
 * @property {string} years the years covered, "1950–2023"
 */

/** The groups, in the order the list shows them. */
export const GROUPS = [
  "Population",
  "Health",
  "Economy and work",
  "Energy",
  "Climate and environment",
  "Education and research",
  "Society and technology",
  "Food and farming",
];

/**
 * @param {string} group
 * @param {string} slug
 * @param {string} name
 * @param {string} words
 * @param {string} source
 * @param {string} years
 * @returns {Preset}
 */
const p = (group, slug, name, words, source, years) => ({ slug, name, group, words, source, years });

/** @type {Preset[]} */
export const PRESETS = [
  p("Population", "population", "Population", "people inhabitants size", "", ""),
  p("Population", "population-growth-rates", "Population growth rate", "increase", "", ""),
  p("Population", "population-density", "Population density", "crowded per square kilometre", "", ""),
  p("Population", "children-born-per-woman", "Fertility rate", "births babies children", "", ""),
  p("Population", "median-age", "Median age", "old young ageing", "", ""),
  p("Population", "share-of-population-urban", "Urban population share", "cities towns rural urbanisation", "", ""),
  p("Population", "life-expectancy", "Life expectancy at birth", "lifespan longevity", "", ""),
  p("Population", "sex-ratio-at-birth", "Sex ratio at birth", "boys girls gender births", "", ""),
  p("Population", "migrant-stock-share", "Share of people born abroad", "migration immigrants foreign-born", "", ""),

  p("Health", "child-mortality", "Child mortality rate", "deaths under five", "", ""),
  p("Health", "infant-mortality", "Infant mortality rate", "deaths babies", "", ""),
  p("Health", "maternal-mortality", "Maternal mortality ratio", "mothers childbirth deaths", "", ""),
  p("Health", "happiness-cantril-ladder", "Self-reported life satisfaction", "happiness wellbeing", "", ""),
  p("Health", "share-of-adults-defined-as-obese", "Adult obesity rate", "overweight weight", "", ""),
  p("Health", "share-of-adults-who-smoke", "Adults who smoke", "smoking tobacco cigarettes", "", ""),
  p(
    "Health",
    "total-alcohol-consumption-per-capita-litres-of-pure-alcohol",
    "Alcohol consumption per adult",
    "drinking beer wine",
    "",
    "",
  ),
  p("Health", "physicians-per-1000-people", "Physicians per 1,000 people", "doctors medical", "", ""),
  p("Health", "total-healthcare-expenditure-gdp", "Health spending, share of GDP", "healthcare money", "", ""),
  p("Health", "prevalence-of-undernourishment", "Undernourishment", "hunger malnutrition food", "", ""),

  p("Economy and work", "gdp-per-capita-worldbank", "GDP per capita", "income wealth rich poor", "", ""),
  p("Economy and work", "share-of-population-in-extreme-poverty", "Extreme poverty rate", "poor income", "", ""),
  p("Economy and work", "unemployment-rate", "Unemployment rate", "jobs jobless work", "", ""),
  p("Economy and work", "annual-working-hours-per-worker", "Annual working hours per worker", "jobs time", "", ""),
  p("Economy and work", "inflation-of-consumer-prices", "Consumer price inflation", "prices cost of living", "", ""),
  p("Economy and work", "trade-as-share-of-gdp", "Trade, share of GDP", "exports imports openness", "", ""),
  p("Economy and work", "international-tourist-trips", "Tourist arrivals", "tourism travel visitors holidays", "", ""),

  p("Energy", "energy-mix?metric=per_capita&source=total", "Energy use per person", "consumption power", "", ""),
  p(
    "Energy",
    "electricity-mix?frequency=annual&metric=per_capita&source=total",
    "Electricity generation per person",
    "power production",
    "",
    "",
  ),
  p(
    "Energy",
    "share-of-the-population-with-access-to-electricity",
    "Access to electricity",
    "power grid development",
    "",
    "",
  ),
  p("Energy", "share-electricity-renewables", "Electricity from renewables", "green wind solar hydro clean", "", ""),

  p("Climate and environment", "co-emissions-per-capita", "CO₂ emissions per person", "carbon dioxide pollution", "", ""),
  p("Climate and environment", "annual-co2-emissions-per-country", "Annual CO₂ emissions", "carbon dioxide pollution", "", ""),
  p("Climate and environment", "cumulative-co-emissions", "Cumulative CO₂ emissions", "carbon dioxide historical", "", ""),
  p("Climate and environment", "total-ghg-emissions", "Total greenhouse gas emissions", "carbon methane climate", "", ""),
  p("Climate and environment", "methane-emissions", "Methane emissions", "greenhouse gas livestock", "", ""),
  p("Climate and environment", "temperature-anomaly", "Global temperature anomaly", "warming climate change heat", "", ""),
  p("Climate and environment", "annual-share-of-co2-emissions", "Share of global CO₂ emissions", "carbon dioxide", "", ""),
  p("Climate and environment", "forest-area-as-share-of-land-area", "Forest area, share of land", "trees woods", "", ""),

  p("Education and research", "mean-years-of-schooling-long-run", "Mean years of schooling", "school education", "", ""),
  p("Education and research", "literacy?age_group=adult&sex=both", "Adult literacy rate", "reading writing", "", ""),
  p("Education and research", "research-spending-gdp", "R&D spending, share of GDP", "science research innovation", "", ""),

  p("Society and technology", "human-development-index", "Human Development Index", "HDI development", "", ""),
  p("Society and technology", "share-of-individuals-using-the-internet", "Internet users", "online web digital", "", ""),
  p(
    "Society and technology",
    "mobile-cellular-subscriptions-per-100-people",
    "Mobile subscriptions per 100 people",
    "phones cellphones",
    "",
    "",
  ),
  p("Society and technology", "share-of-women-in-parliament", "Women in parliament", "gender politics", "", ""),
  p("Society and technology", "political-regime", "Political regime", "democracy autocracy politics", "", ""),
  p("Society and technology", "homicide-rate-unodc", "Homicide rate", "murder crime violence", "", ""),
  p("Society and technology", "military-expenditure-share-gdp", "Military spending, share of GDP", "army defence armed forces", "", ""),

  p("Food and farming", "daily-meat-consumption-per-person", "Meat consumption per person", "diet food", "", ""),
  p("Food and farming", "cereal-yield", "Cereal yields", "crops wheat rice maize farming agriculture", "", ""),
  p("Food and farming", "fish-and-seafood-consumption-per-capita", "Fish and seafood per person", "diet fishing", "", ""),
  p("Food and farming", "cocoa-bean-production", "Cocoa bean production", "chocolate crops", "", ""),
];

/**
 * The presets matching a search, best first: names that start with the
 * query, then names with a word starting with it, then names containing it,
 * then matches on the search words, group or source. Every word of the query
 * has to match somewhere. An empty query matches everything, in list order.
 *
 * @param {string} query
 * @param {Preset[]} [list]
 * @returns {Preset[]}
 */
export function searchPresets(query, list = PRESETS) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  /** @type {Array<{preset: Preset, score: number, index: number}>} */
  const hits = [];
  list.forEach((preset, index) => {
    const name = fold(preset.name);
    const rest = fold(`${preset.words} ${preset.group} ${preset.source} ${preset.slug}`);
    let score = 0;
    for (const w of words) {
      const s = name.startsWith(w)
        ? 4
        : new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}`, "u").test(name)
          ? 3
          : name.includes(w)
            ? 2
            : rest.includes(w)
              ? 1
              : 0;
      if (!s) return;
      score += s;
    }
    hits.push({ preset, score, index });
  });
  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  return hits.map((h) => h.preset);
}

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The preset with this slug, if any.
 *
 * @param {string} slug
 * @returns {Preset | undefined}
 */
export const presetFor = (slug) => PRESETS.find((x) => x.slug === slug);
