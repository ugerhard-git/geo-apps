/**
 * OWID chart plotter — the ready-made charts, and searching them.
 *
 * The charts are listed in {@link TABLE}, one line each, under a heading for
 * their group:
 *
 *   slug | name | more search words | source | years
 *
 * - slug: the last part of the chart's address on ourworldindata.org, with
 *   any query it needs ("energy-mix?metric=per_capita&source=total");
 * - name: what the list shows;
 * - more search words: what people might type instead of the name;
 * - source and years: shown under the name. `scripts/owid/preset-info.mjs`
 *   reads both from Our World in Data, to keep them up to date.
 *
 * Adding a chart is one line; the "Check every ready-made chart" tool then
 * confirms it loads, and a unit test that the line is complete.
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
 * @property {string} slug as typed into the address field
 * @property {string} name shown in the list
 * @property {string} group the heading it is listed under
 * @property {string} words more search words, space-separated
 * @property {string} source the data's source, short
 * @property {string} years the years covered, "1950–2023"
 */

export const TABLE = `
# Population
population | Population | people inhabitants size | HYDE, Gapminder, UN | 10,000 BCE–2023
population-growth-rates | Population growth rate | increase | UN | 1950–2023
population-density | Population density | crowded per square kilometre | HYDE, Gapminder, UN | 10,000 BCE–2100
children-born-per-woman | Fertility rate | births babies children | Human Fertility Database, UN | 1891–2023
median-age | Median age | old young ageing | UN | 1950–2023
share-of-population-urban | Urban population share | cities towns rural urbanisation | UN | 1950–2025
life-expectancy | Life expectancy at birth | lifespan longevity | Riley, HMD, UN and others | 1543–2023
sex-ratio-at-birth | Sex ratio at birth | boys girls gender births | UN | 1950–2023
migrant-stock-share | Share of people born abroad | migration immigrants foreign-born | UN | 1990–2024

# Health
child-mortality | Child mortality rate | deaths under five | Gapminder, UN | 1751–2024
infant-mortality | Infant mortality rate | deaths babies | UN | 1931–2024
maternal-mortality | Maternal mortality ratio | mothers childbirth deaths | UN and others | 1751–2020
happiness-cantril-ladder | Self-reported life satisfaction | happiness wellbeing | World Happiness Report | 2011–2025
share-of-adults-defined-as-obese | Adult obesity rate | overweight weight | WHO | 1980–2024
share-of-adults-who-smoke | Adults who smoke | smoking tobacco cigarettes | WHO | 2000–2024
total-alcohol-consumption-per-capita-litres-of-pure-alcohol | Alcohol consumption per adult | drinking beer wine | WHO | 2000–2020
physicians-per-1000-people | Physicians per 1,000 people | doctors medical | WHO, OECD | 1960–2023
total-healthcare-expenditure-gdp | Health spending, share of GDP | healthcare money | WHO | 2000–2023
prevalence-of-undernourishment | Undernourishment | hunger malnutrition food | FAO | 2000–2024

# Economy and work
gdp-per-capita-worldbank | GDP per capita | income wealth rich poor | World Bank | 1990–2025
share-of-population-in-extreme-poverty | Extreme poverty rate | poor income | World Bank | 1963–2026
unemployment-rate | Unemployment rate | jobs jobless work | ILO | 1991–2025
annual-working-hours-per-worker | Annual working hours per worker | jobs time | Penn World Table | 1870–2023
inflation-of-consumer-prices | Consumer price inflation | prices cost of living | IMF | 1960–2025
trade-as-share-of-gdp | Trade, share of GDP | exports imports openness | World Bank, OECD | 1960–2025
international-tourist-trips | Tourist arrivals | tourism travel visitors holidays | UN Tourism | 1995–2024

# Energy
energy-mix?metric=per_capita&source=total | Energy use per person | consumption power | Energy Institute | 1800–2025
electricity-mix?frequency=annual&metric=per_capita&source=total | Electricity generation per person | power production | Ember and others | 1900–2025
share-of-the-population-with-access-to-electricity | Access to electricity | power grid development | World Bank | 1990–2024
share-electricity-renewables | Electricity from renewables | green wind solar hydro clean | Ember and others | 1900–2025

# Climate and environment
co-emissions-per-capita | CO₂ emissions per person | carbon dioxide pollution | Global Carbon Budget | 1750–2024
annual-co2-emissions-per-country | Annual CO₂ emissions | carbon dioxide pollution | Global Carbon Budget | 1750–2024
cumulative-co-emissions | Cumulative CO₂ emissions | carbon dioxide historical | Global Carbon Budget | 1750–2024
total-ghg-emissions | Total greenhouse gas emissions | carbon methane climate | Jones et al. | 1850–2024
methane-emissions | Methane emissions | greenhouse gas livestock | Jones et al. | 1850–2024
temperature-anomaly | Global temperature anomaly | warming climate change heat | Met Office Hadley Centre | 1850–2026
annual-share-of-co2-emissions | Share of global CO₂ emissions | carbon dioxide | Global Carbon Budget | 1750–2024
forest-area-as-share-of-land-area | Forest area, share of land | trees woods | FAO and others | 1000–2025

# Education and research
mean-years-of-schooling-long-run | Mean years of schooling | school education | Barro and Lee, Lee and Lee | 1870–2040
literacy?age_group=adult&sex=both | Adult literacy rate | reading writing | UNESCO | 1970–2024
research-spending-gdp | R&D spending, share of GDP | science research innovation | UNESCO | 1996–2024

# Society and technology
human-development-index | Human Development Index | HDI development | UNDP | 1990–2023
share-of-individuals-using-the-internet | Internet users | online web digital | ITU | 1990–2025
mobile-cellular-subscriptions-per-100-people | Mobile subscriptions per 100 people | phones cellphones | ITU | 1960–2025
share-of-women-in-parliament | Women in parliament | gender politics | V-Dem | 1900–2025
political-regime | Political regime | democracy autocracy politics | V-Dem | 1789–2025
homicide-rate-unodc | Homicide rate | murder crime violence | UNODC | 1990–2024
military-spending-as-a-share-of-gdp-sipri | Military spending, share of GDP | army defence armed forces | SIPRI | 1949–2025

# Food and farming
daily-meat-consumption-per-person | Meat consumption per person | diet food | FAO | 1961–2023
cereal-yield | Cereal yields | crops wheat rice maize farming agriculture | FAO | 1961–2024
fish-and-seafood-consumption-per-capita | Fish and seafood per person | diet fishing | FAO | 1961–2023
cocoa-bean-production | Cocoa bean production | chocolate crops | FAO | 1961–2024
`;

/**
 * Read the table: a "# Heading" line starts a group, every other non-empty
 * line is a chart.
 *
 * @param {string} text
 * @returns {Preset[]}
 */
export function parseTable(text) {
  /** @type {Preset[]} */
  const list = [];
  let group = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      group = line.replace(/^#+\s*/, "");
      continue;
    }
    const [slug = "", name = "", words = "", source = "", years = ""] = line
      .split("|")
      .map((s) => s.trim());
    list.push({ slug, name, group, words, source, years });
  }
  return list;
}

/** Every ready-made chart, in list order. */
export const PRESETS = parseTable(TABLE);

/** The groups, in list order. */
export const GROUPS = [...new Set(PRESETS.map((p) => p.group))];

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
