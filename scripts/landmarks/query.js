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
 * The country's Wikidata item(s), bound to ?country. Usually the item with
 * the ISO code; but some codes sit on a wider item — "NL" is on the Kingdom
 * of the Netherlands, while Dutch landmarks name the Netherlands as their
 * country — so a country that is part of the coded item and has no code of
 * its own, and is its own country (P17 itself), counts too. That leaves
 * out Aruba and Curaçao, which have their own codes, and the provinces.
 *
 * @param {string} iso checked by the caller
 */
function countryPattern(iso) {
  return `{ ?country wdt:P297 "${iso}" . }
  UNION
  {
    ?coded wdt:P297 "${iso}" .
    ?country wdt:P361 ?coded .
    ?country wdt:P17 ?country .
    MINUS { ?country wdt:P297 ?own . }
  }`;
}

/**
 * For territories whose landmarks name the parent country as their country
 * (Réunion, Puerto Rico, Hong Kong): candidates located in the territory.
 *
 * @param {string} iso ISO 3166-1 alpha-2, checked here
 * @param {number} limit
 * @returns {string}
 */
export function withinQuery(iso, limit) {
  if (!/^[A-Z]{2}$/.test(iso)) throw new Error("bad country code");
  return `${PREFIXES}SELECT ?item (MAX(?sl0) AS ?sl) WHERE {
  ?t wdt:P297 "${iso}" .
  VALUES ?root0 { ${ROOTS.map(([q]) => "wd:" + q).join(" ")} }
  { ?item wdt:P131+ ?t . } UNION { ?item wdt:P706 ?t . }
  ?item wdt:P31/wdt:P279* ?root0 .
  ?item wikibase:sitelinks ?sl0 .
  ?item wdt:P18 ?img .
}
GROUP BY ?item
ORDER BY DESC(?sl)
LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`;
}

/**
 * The ISO codes of the countries a territory belongs to, so they aren't
 * flagged as "also in": a Réunion landmark's country is France.
 *
 * @param {string} iso checked here
 */
export function parentQuery(iso) {
  if (!/^[A-Z]{2}$/.test(iso)) throw new Error("bad country code");
  return `${PREFIXES}SELECT DISTINCT ?p WHERE { ?t wdt:P297 "${iso}" . ?t wdt:P17 ?c . ?c wdt:P297 ?p . }`;
}

/**
 * Step 1, kept light: the country's candidates and their sitelink counts,
 * best first. The expensive lookups wait for step 2, which only sees these.
 *
 * @param {string} iso ISO 3166-1 alpha-2, checked here
 * @param {number} limit
 * @returns {string}
 */
export function candidateQuery(iso, limit) {
  if (!/^[A-Z]{2}$/.test(iso)) throw new Error("bad country code");
  return `${PREFIXES}SELECT ?item (MAX(?sl0) AS ?sl) WHERE {
  ${countryPattern(iso)}
  {
    VALUES ?root0 { ${ROOTS.map(([q]) => "wd:" + q).join(" ")} }
    ?item wdt:P17 ?country .
    ?item wdt:P31/wdt:P279* ?root0 .
  } UNION {
    ?item wdt:P1435 wd:Q9259 .
    ?item wdt:P17 ?country .
  } UNION {
    ?site0 wdt:P1435 wd:Q9259 .
    ?site0 wdt:P17 ?country .
    ?item wdt:P361 ?site0 .
    ?item wdt:P17 ?country .
  }
  ?item wikibase:sitelinks ?sl0 .
  ?item wdt:P18 ?img .
}
GROUP BY ?item
ORDER BY DESC(?sl)
LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`;
}

/**
 * Step 2: everything the app shows, for the candidates of step 1 only — as
 * several small queries rather than one. A single query with all of this
 * runs past QLever's 30-second limit; each part on its own is a quick lookup.
 * build-data.mjs merges their rows by item.
 *
 * @param {string[]} ids Wikidata ids, checked here
 * @returns {Array<{part: string, query: string}>}
 */
export function detailQueries(ids) {
  const safe = ids.filter((id) => /^Q\d{1,12}$/.test(id));
  if (!safe.length) throw new Error("no ids");
  const values = `VALUES ?item { ${safe.map((id) => "wd:" + id).join(" ")} }`;
  const roots = [...ROOTS, ["Q839954", "arch"]].map(([q, g]) => `(wd:${q} "${g}")`).join(" ");
  const q = (/** @type {string} */ vars, /** @type {string} */ body) =>
    `${PREFIXES}SELECT DISTINCT ?item ${vars} WHERE {\n  ${values}\n  ${body}\n}`;
  return [
    {
      part: "basic",
      query: q(
        "?en ?img ?pt ?category ?fPop ?fClass",
        `?item wdt:P18 ?img .
  OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item wdt:P625 ?pt . }
  OPTIONAL { ?item wdt:P373 ?category . }
  OPTIONAL { ?item wdt:P1082 ?pop . BIND(1 AS ?fPop) }
  OPTIONAL { ?item wdt:P279 ?super . BIND(1 AS ?fClass) }`,
      ),
    },
    {
      part: "types",
      query: q(
        "?typeLabel",
        `?item wdt:P31 ?cls . ?cls rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "en")`,
      ),
    },
    {
      part: "groups",
      query: q("?g", `VALUES (?root ?g) { ${roots} }\n  ?item wdt:P31/wdt:P279* ?root .`),
    },
    { part: "also", query: q("?oiso", `?item wdt:P17 ?oc . ?oc wdt:P297 ?oiso .`) },
    {
      part: "heritage",
      query: q(
        "?site ?siteLabel",
        `{ ?item wdt:P1435 wd:Q9259 . BIND(?item AS ?site) }
  UNION
  { ?item wdt:P361 ?site . ?site wdt:P1435 wd:Q9259 . }
  OPTIONAL { ?site rdfs:label ?siteLabel . FILTER(LANG(?siteLabel) = "en") }`,
      ),
    },
    {
      part: "labels",
      query: q(
        "?lang ?name",
        `?item rdfs:label ?name .
  BIND(LANG(?name) AS ?lang)
  FILTER(?lang IN ("en-gb", "en-us", "mul", "fr", "es", "de", "it", "pt", "nl"))`,
      ),
    },
  ];
}

/**
 * Merge the parts' rows into one row per item, shaped as select.js expects.
 *
 * @param {Array<{part: string, rows: any[]}>} parts
 * @param {Map<string, string>} sitelinks by id, from step 1
 * @returns {any[]}
 */
export function mergeDetails(parts, sitelinks) {
  /** @type {Map<string, any>} */
  const byId = new Map();
  /** @param {any} r */
  const idOf = (r) => (/\/(Q\d+)$/.exec((r && r.item && r.item.value) || "") || [])[1] || "";
  /** @param {any} r @param {string} k */
  const v = (r, k) => (r && r[k] && typeof r[k].value === "string" ? r[k].value : "");
  /** @param {string} id */
  const get = (id) => {
    let m = byId.get(id);
    if (!m)
      byId.set(
        id,
        (m = {
          item: { value: "http://www.wikidata.org/entity/" + id },
          sl: { value: sitelinks.get(id) || "0" },
          _types: new Set(),
          _groups: new Set(),
          _also: new Set(),
          _labels: [],
        }),
      );
    return m;
  };
  /** @param {any} m @param {string} k @param {string} val */
  const setOnce = (m, k, val) => {
    if (val && !m[k]) m[k] = { value: val };
  };
  for (const { part, rows } of parts)
    for (const r of rows) {
      const id = idOf(r);
      if (!id || !sitelinks.has(id)) continue;
      const m = get(id);
      if (part === "basic") {
        setOnce(m, "label", v(r, "en"));
        setOnce(m, "image", v(r, "img"));
        setOnce(m, "coord", v(r, "pt"));
        setOnce(m, "cat", v(r, "category"));
        if (v(r, "fPop") === "1") m.hasPop = { value: "1" };
        if (v(r, "fClass") === "1") m.isClass = { value: "1" };
      } else if (part === "types") m._types.add(v(r, "typeLabel"));
      else if (part === "groups") {
        if (v(r, "g") === "arch") m.arch = { value: "1" };
        else m._groups.add(v(r, "g"));
      } else if (part === "also") m._also.add(v(r, "oiso"));
      else if (part === "heritage") {
        m.whs = { value: "1" };
        const site = v(r, "site");
        if (site && site !== m.item.value) {
          setOnce(m, "site", site);
          setOnce(m, "siteLabel", v(r, "siteLabel"));
        }
      } else if (part === "labels") m._labels.push(v(r, "lang") + "::" + v(r, "name"));
    }
  return [...byId.values()]
    .filter((m) => m.image)
    .map(({ _types, _groups, _also, _labels, ...m }) => ({
      ...m,
      types: { value: [..._types].filter(Boolean).join(" | ") },
      groups: { value: [..._groups].filter(Boolean).join(" ") },
      also: { value: [..._also].filter(Boolean).join(" ") },
      otherLabels: { value: _labels.join(" || ") },
    }));
}
