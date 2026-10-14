/**
 * Landmarks data — the QLever query for one country.
 *
 * QLever (University of Freiburg) serves the same Wikidata as the Wikidata
 * Query Service but answers this kind of question — every item of a country,
 * filtered by a class hierarchy, sorted by sitelinks — in seconds, where the
 * Wikidata Query Service times out for large countries.
 *
 * Two QLever quirks shape the query: there is no label service (labels are
 * read with rdfs:label), and a FILTER on a sitelink count that comes from a
 * join drops every row, so the minimum is applied in select.js instead.
 */

export const QLEVER = "https://qlever.cs.uni-freiburg.de/api/wikidata";

/**
 * What counts as a landmark: anything that is (a subclass of) one of these.
 * The group decides the app's Built / Natural filter.
 */
export const ROOTS = [
  ["Q811979", "built"], // architectural structure
  ["Q4989906", "built"], // monument
  ["Q839954", "built"], // archaeological site
  ["Q33506", "built"], // museum
  ["Q570116", "built"], // tourist attraction
  ["Q271669", "natural"], // landform
  ["Q23397", "natural"], // lake
  ["Q34038", "natural"], // waterfall
  ["Q473972", "natural"], // protected area
  ["Q11292", "natural"], // coral reef
];

const PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`;

/**
 * @param {string} iso ISO 3166-1 alpha-2, checked by the caller
 * @returns {string}
 */
export function landmarkQuery(iso) {
  if (!/^[A-Z]{2}$/.test(iso)) throw new Error("bad country code");
  const roots = ROOTS.map(([q, g]) => `(wd:${q} "${g}")`).join(" ");
  return `${PREFIXES}SELECT ?item (SAMPLE(?en) AS ?label)
  (GROUP_CONCAT(DISTINCT ?other; separator=" || ") AS ?otherLabels)
  (MAX(?sl0) AS ?sl) (SAMPLE(?img) AS ?image) (SAMPLE(?pt) AS ?coord) (SAMPLE(?category) AS ?cat)
  (GROUP_CONCAT(DISTINCT ?g; separator=" ") AS ?groups)
  (GROUP_CONCAT(DISTINCT ?typeLabel; separator=" | ") AS ?types)
  (GROUP_CONCAT(DISTINCT ?oiso; separator=" ") AS ?also)
  (MAX(?w) AS ?whs) (SAMPLE(?site0) AS ?site) (SAMPLE(?siteName) AS ?siteLabel)
  (MAX(?fClass) AS ?isClass) (MAX(?fPop) AS ?hasPop) (MAX(?fArch) AS ?arch)
WHERE {
  ?country wdt:P297 "${iso}" .
  {
    VALUES ?root0 { ${ROOTS.map(([q]) => "wd:" + q).join(" ")} }
    ?item wdt:P17 ?country .
    ?item wdt:P31/wdt:P279* ?root0 .
  } UNION {
    ?item wdt:P1435 wd:Q9259 .
    ?item wdt:P17 ?country .
    BIND(1 AS ?w)
  } UNION {
    ?site0 wdt:P1435 wd:Q9259 .
    ?site0 wdt:P17 ?country .
    ?item wdt:P361 ?site0 .
    ?item wdt:P17 ?country .
    BIND(1 AS ?w)
    OPTIONAL { ?site0 rdfs:label ?siteName . FILTER(LANG(?siteName) = "en") }
  }
  ?item wikibase:sitelinks ?sl0 .
  ?item wdt:P18 ?img .
  OPTIONAL { ?item wdt:P625 ?pt . }
  OPTIONAL { ?item wdt:P373 ?category . }
  OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL {
    ?item rdfs:label ?l2 .
    FILTER(LANG(?l2) IN ("en-gb", "en-us", "mul", "fr", "es", "de", "it", "pt", "nl"))
    BIND(CONCAT(LANG(?l2), "::", STR(?l2)) AS ?other)
  }
  OPTIONAL { VALUES (?root ?g) { ${roots} } ?item wdt:P31/wdt:P279* ?root . }
  OPTIONAL { ?item wdt:P31 ?cls . ?cls rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "en") }
  OPTIONAL { ?item wdt:P17 ?oc . ?oc wdt:P297 ?oiso . }
  OPTIONAL { ?item wdt:P279 ?super . BIND(1 AS ?fClass) }
  OPTIONAL { ?item wdt:P1082 ?pop . BIND(1 AS ?fPop) }
  OPTIONAL { ?item wdt:P31/wdt:P279* wd:Q839954 . BIND(1 AS ?fArch) }
}
GROUP BY ?item
ORDER BY DESC(?sl)
LIMIT 300`;
}
