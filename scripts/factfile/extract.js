/**
 * Fact file — reading one World Factbook profile into the record the app
 * shows: cleaned-up texts and numbers for each field, and the names that
 * could give the country away (which the app blacks out).
 *
 * Pure functions, so they can be tested without the archive.
 *
 * Nothing tied to a person or an election is read: no heads of state, no
 * election results, no share of women in parliament. The archive froze in
 * January 2026, and those go stale.
 */

/* ═══════════════════════════════════════════════════════════
   Text
   ═══════════════════════════════════════════════════════════ */

const ENTITIES = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  eth: "ð",
  thorn: "þ",
  rsquo: "’",
  lsquo: "‘",
  ndash: "–",
  mdash: "—",
};
/** The accent each named-entity suffix stands for, as a combining mark. */
const ACCENTS = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  uml: "\u0308",
  tilde: "\u0303",
  cedil: "\u0327",
  ring: "\u030A",
  caron: "\u030C",
};

/**
 * Decode HTML entities: "&eacute;" → "é", "&#233;" → "é". The Factbook
 * writes accented letters this way, so names like "République" depend on it.
 *
 * @param {string} t
 */
function decode(t) {
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z])(acute|grave|circ|uml|tilde|cedil|ring|caron);/g, (_, c, a) =>
      (c + ACCENTS[/** @type {keyof ACCENTS} */ (a)]).normalize("NFC"),
    )
    .replace(/&([a-zA-Z]+);/g, (e, n) => ENTITIES[/** @type {keyof ENTITIES} */ (n)] ?? " ");
}

/**
 * Split on a separator only outside brackets: "1991 (from X; Y renamed Z); notable…"
 * splits once, after the bracket.
 *
 * @param {string} text
 * @param {string} sep one character
 */
export function splitOutside(text, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * Factbook text as plain text: markup removed, notes dropped, years in
 * brackets ("(2023 est.)") taken off, spaces tidied.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function plain(raw) {
  let t = decode(
    String(raw ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  );
  // A note is commentary, never the fact itself.
  t = t.replace(/\bnote(?:\s*\d+)?\s*:[\s\S]*$/i, "");
  t = t.replace(/\(\s*\d{4}(?:\s*est\.?)?\s*\)/g, "").replace(/\(\s*est\.?\s*\)/g, "");
  return t
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\s+([,;.])/g, "$1")
    .trim()
    .replace(/[;,]$/, "")
    .trim();
}

/**
 * A field's text, whether the field is `{text}` or nested one level.
 *
 * @param {any} field
 * @param {string} [key] a sub-field
 */
function textOf(field, key) {
  const f = key ? field?.[key] : field;
  return typeof f?.text === "string" ? f.text : "";
}

/**
 * The first number in a text, commas allowed: "2,106 km" → 2106.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function numberIn(text) {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(text));
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Like numberIn, but reads "1.267 million sq km" as 1,267,000.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function amountIn(text) {
  const n = numberIn(text);
  if (n === null) return null;
  const m = /\d\s+(million|billion)\b/.exec(String(text));
  if (!m) return n;
  return Math.round(n * (m[1] === "million" ? 1e6 : 1e9));
}

/**
 * Cut a long text at a clause boundary, so the card stays a card.
 *
 * @param {string} text
 * @param {number} max characters
 */
export function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf("; "), cut.lastIndexOf(". "));
  return (at > max * 0.4 ? cut.slice(0, at) : cut.replace(/[,;]?\s+\S*$/, "")) + "…";
}

/** "BUDAPEST" → "Budapest"; mixed case is left alone. */
const titleCase = (/** @type {string} */ s) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : s;

/**
 * Names in a "name / other name; note" field.
 *
 * @param {string} text
 * @returns {string[]}
 */
function namesIn(text) {
  return plain(text)
    .split(/[/;]|\bor\b/)
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter((s) => s && !/^none\b/i.test(s) && s.length < 60);
}

/* ═══════════════════════════════════════════════════════════
   Fields
   ═══════════════════════════════════════════════════════════ */

/**
 * Heights in metres: "Kekes 1,014 m" gives the number; the name goes to the
 * names to black out.
 *
 * @param {any} elevation
 * @param {Set<string>} places
 */
function heights(elevation, places) {
  /** @param {string} key */
  const point = (key) => {
    const t = plain(textOf(elevation, key)).replace(/;.*$/, "");
    const m = /^(.*?)\s*(-?[\d,]+)\s*m\b/.exec(t);
    if (!m) return null;
    const name = m[1].replace(/[,-]\s*$/, "").trim();
    if (name) places.add(name);
    return numberIn(m[2]);
  };
  const high = point("highest point");
  const low = point("lowest point");
  const mean = numberIn(plain(textOf(elevation, "mean elevation")));
  if (high === null && low === null && mean === null) return null;
  return { high, low, mean };
}

/**
 * Borders: the lengths, longest first; the neighbours' names are blacked out.
 *
 * @param {any} boundaries
 * @param {Set<string>} neighbours
 */
function borders(boundaries, neighbours) {
  if (!boundaries) return null;
  const total = numberIn(plain(textOf(boundaries, "total")));
  const key = Object.keys(boundaries).find((k) => /^border countries/.test(k));
  /** @type {number[]} */
  const lengths = [];
  for (const part of plain(key ? textOf(boundaries, key) : "").split(/;/)) {
    const m = /^(.*?)\s+([\d,.]+)\s*km/.exec(part.trim());
    if (!m) continue;
    neighbours.add(m[1].replace(/\(.*?\)/g, "").trim());
    const km = numberIn(m[2]);
    if (km !== null) lengths.push(km);
  }
  if (total === null && !lengths.length) return null;
  return {
    total: total ?? lengths.reduce((s, x) => s + x, 0),
    lengths: lengths.sort((a, b) => b - a),
  };
}

/**
 * The biggest city: its population in millions, and whether it is the
 * capital. Every city named goes to the names to black out.
 *
 * @param {string} text "1.778 million BUDAPEST (capital), 3.155 million Milan"
 * @param {Set<string>} places
 */
function biggestCity(text, places) {
  /** @type {{millions: number, capital: boolean} | null} */
  let best = null;
  // Split between entries, never inside a number like "178,000".
  for (const part of plain(text).split(/,\s+(?=[\d.,]+\s*(?:million\s+)?\p{Lu})/u)) {
    const m = /^([\d.,]+)\s*(million)?\s+(.+?)\s*(\(capital\))?\s*$/i.exec(part.trim());
    if (!m) continue;
    const name = titleCase(m[3].replace(/\(.*?\)/g, "").trim());
    if (name) places.add(name);
    const n = numberIn(m[1]);
    if (n === null) continue;
    // The list isn't always largest first: the capital can lead.
    const millions = m[2] ? n : n / 1e6;
    if (!best || millions > best.millions) best = { millions, capital: !!m[4] };
  }
  return best;
}

/**
 * The largest lake: "Lake Balaton - 590 sq km" in the first group listed.
 *
 * @param {any} lakes
 * @param {Set<string>} places
 */
function largestLake(lakes, places) {
  if (!lakes) return null;
  /** @type {{sqkm: number, kind: string} | null} */
  let best = null;
  for (const [kind, v] of Object.entries(lakes)) {
    for (const part of plain(textOf(v)).split(/;|\n/)) {
      const m = /^(.*?)\s*-\s*([\d,]+)\s*sq km/.exec(part.trim());
      if (!m) continue;
      for (const n of namesIn(m[1].replace(/\(shared.*$/i, ""))) places.add(n);
      const sqkm = numberIn(m[2]);
      if (sqkm !== null && (!best || sqkm > best.sqkm))
        best = { sqkm, kind: /salt/i.test(kind) ? "salt water" : "fresh water" };
    }
  }
  return best;
}

/**
 * The longest river: its length, and how many other countries share it.
 *
 * @param {string} text "Duna (Danube) (shared with Germany [s], Austria, …) - 2,888 km"
 * @param {Set<string>} places
 */
function longestRiver(text, places) {
  let best = null;
  for (const part of plain(text).split(/\n|;\s*(?=[A-Z])/)) {
    const m = /^(.*?)\s*-\s*([\d,]+)\s*km/.exec(part.trim());
    if (!m) continue;
    const shared = /\(shared with ([^)]*)\)/i.exec(m[1]);
    const name = m[1].replace(/\(shared with [^)]*\)/i, "").trim();
    for (const n of name.split(/[()]/)) if (n.trim()) places.add(n.trim());
    const km = numberIn(m[2]);
    const others = shared ? shared[1].split(/,|\band\b/).filter((s) => s.trim()).length : 0;
    if (km !== null && (!best || km > best.km)) best = { km, shared: others };
  }
  return best;
}

/**
 * The parliament without names: one or two chambers, seats, how they are
 * filled, and the term. Names like "National Diet" point straight at the
 * country, so they are left out altogether.
 *
 * @param {any} gov the Government section
 */
function parliament(gov) {
  const main = gov["Legislative branch"];
  if (!main) return null;
  const structure = plain(textOf(main, "legislative structure"));
  /** @param {any} chamber */
  const chamberOf = (chamber) => {
    const seats = plain(textOf(chamber, "number of seats")).replace(/;.*$/, "");
    const n = numberIn(seats);
    if (n === null) return null;
    const how = (/\(([^)]*)\)/.exec(seats) || [])[1] || "";
    const term = plain(textOf(chamber, "term in office"));
    return { seats: n, how: how.trim(), term };
  };
  /** @type {Array<{seats: number, how: string, term: string}>} */
  const chambers = [];
  const one = chamberOf(main);
  if (one) chambers.push(one);
  for (const k of ["Legislative branch - lower chamber", "Legislative branch - upper chamber"]) {
    const c = gov[k] && chamberOf(gov[k]);
    if (c) chambers.push(c);
  }
  const count = /bicameral/i.test(structure)
    ? 2
    : /unicameral/i.test(structure)
      ? 1
      : chambers.length;
  if (!count && !chambers.length) return null;
  return { chambers: count, seats: chambers };
}

/**
 * Independence: the date, what happened then, and from whom.
 *
 * @param {string} text "3 August 1960 (from France)"
 */
function independence(text) {
  const t = (splitOutside(plain(text), ";")[0] || "")
    .replace(/^no official date of independence\s*:\s*/i, "")
    .trim();
  if (!t || /^none\b/i.test(t)) return null;
  const m = /^([^()]+?)\s*(?:\((.*)\))?$/.exec(t);
  if (!m) return null;
  const date = m[1].trim();
  if (!/\d/.test(date)) return null;
  const detail = (m[2] || "").trim();
  const from = /\bfrom (?:the )?([^;]+)/i.exec(detail);
  const event = (from ? detail.slice(0, from.index) : splitOutside(detail, ";")[0] || "")
    .replace(/\s*\b(?:declared )?independence\s*$/i, "")
    .trim();
  return { date, event: shorten(event.replace(/[,;]$/, ""), 70), from: from ? from[1].trim() : "" };
}

/**
 * Regions: the counts and kinds only, "19 counties, 25 cities with county
 * rights, and 1 capital city". The region names go to the names to black out.
 *
 * @param {string} text
 * @param {Set<string>} places
 */
function regions(text, places) {
  const t = plain(text).replace(/\([^)]*\)/g, " ");
  const head = t
    .split(/;|\n|:/)[0]
    .replace(/\s+/g, " ")
    .replace(/\*/g, "")
    .trim();
  for (const part of t
    .split(/[;\n:]/)
    .slice(1)
    .join(",")
    .split(",")) {
    const n = part
      .replace(/\([^)]*\)/g, "")
      .replace(/\*/g, "")
      .trim();
    if (n && n.length < 50 && /^\p{Lu}/u.test(n)) places.add(n);
  }
  return /^\d/.test(head) ? head.replace(/\s+,/g, ",") : "";
}

/**
 * The national holiday: its date shows, its name is blacked out.
 *
 * @param {string} text "Saint Stephen's Day, 20 August"
 */
function holiday(text) {
  const t = plain(text)
    .split(";")[0]
    .replace(/\(\d+\)/g, "")
    .trim();
  const m = /^(.*),\s*([^,]+)$/.exec(t);
  if (!m) return null;
  return { name: m[1].trim(), date: m[2].trim() };
}

/**
 * Memberships of the big groupings: what a badge says, by the Factbook's
 * abbreviation. Groupings nearly everyone belongs to say nothing and are
 * left out; observers and partners don't count.
 */
export const MEMBERSHIPS = {
  EU: "EU",
  EMU: "Eurozone",
  "Schengen Convention": "Schengen",
  NATO: "NATO",
  OECD: "OECD",
  "G-7": "G7",
  "G-20": "G20",
  BRICS: "BRICS",
  OPEC: "OPEC",
  OAPEC: "OAPEC",
  GCC: "Gulf Cooperation Council",
  LAS: "Arab League",
  OIC: "Islamic Cooperation",
  AU: "African Union",
  ECOWAS: "ECOWAS",
  SADC: "SADC",
  EAC: "East African Community",
  COMESA: "COMESA",
  CEMAC: "CEMAC",
  WAEMU: "WAEMU",
  ASEAN: "ASEAN",
  SAARC: "SAARC",
  SCO: "Shanghai Cooperation",
  CIS: "CIS",
  EAEU: "Eurasian Economic Union",
  CSTO: "CSTO",
  Mercosur: "Mercosur",
  CAN: "Andean Community",
  Caricom: "CARICOM",
  SICA: "SICA",
  PIF: "Pacific Islands Forum",
  C: "Commonwealth",
  OIF: "Francophonie",
  CPLP: "Portuguese-speaking",
  NC: "Nordic Council",
  Benelux: "Benelux",
};

/**
 * @param {string} text the Factbook's list of memberships
 * @returns {string[]} badge texts, in the order of {@link MEMBERSHIPS}
 */
function memberships(text) {
  const have = new Set(
    plain(text)
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter((s) => s && !s.includes("(")),
  );
  return Object.entries(MEMBERSHIPS)
    .filter(([code]) => have.has(code))
    .map(([, label]) => label);
}

/**
 * A system of government the Factbook itself marks as interim or overtaken
 * by events: shown with a "may have changed" mark.
 */
export const UNSETTLED =
  /\b(?:formerly|transitional|interim|provisional|coup|junta|suspended|in transition)\b/i;

/* ═══════════════════════════════════════════════════════════
   One profile
   ═══════════════════════════════════════════════════════════ */

/**
 * @typedef {object} Names
 * @property {string[]} country the country's own names
 * @property {string[]} people what its people are called
 * @property {string[]} places its cities, peaks, lakes, rivers, regions, holiday
 * @property {string[]} neighbours the countries it borders
 */

/**
 * Read a profile.
 *
 * @param {any} p one Factbook JSON profile
 * @returns {{names: Names, fields: Record<string, any>}}
 */
export function extract(p) {
  const geo = p.Geography || {};
  const ppl = p["People and Society"] || {};
  const eco = p.Economy || {};
  const gov = p.Government || {};
  const mil = p["Military and Security"] || {};

  /** @type {Set<string>} */
  const places = new Set();
  /** @type {Set<string>} */
  const neighbours = new Set();

  const cn = gov["Country name"] || {};
  const country = new Set(
    [
      "conventional long form",
      "conventional short form",
      "local long form",
      "local short form",
      "abbreviation",
    ]
      .flatMap((k) => namesIn(textOf(cn, k)))
      .filter((n) => n.length > 1),
  );
  const nat = ppl.Nationality || {};
  const people = new Set(
    [textOf(nat, "noun"), textOf(nat, "adjective")]
      // "(s)" marks a plural; any other bracket is a remark, dropped first.
      .flatMap((t) =>
        plain(t)
          .replace(/\((?!s\))[^)]*\)/g, "")
          .split(/[,;]|\band\b|\bor\b/),
      )
      .flatMap((t) => {
        const m = /^(.*?)\(s\)$/.exec(t.trim());
        return m ? [m[1].trim(), m[1].trim() + "s"] : [t.trim()];
      })
      .filter((s) => s && s.length > 2 && !/^none$/i.test(s)),
  );
  for (const n of namesIn(textOf(gov.Capital, "name"))) places.add(n);

  /** @type {Record<string, any>} */
  const f = {};
  /** @param {string} key @param {any} value */
  const put = (key, value) => {
    if (value !== null && value !== undefined && value !== "") f[key] = value;
  };

  put("climate", shorten(plain(textOf(geo.Climate)), 220));
  put("terrain", shorten(plain(textOf(geo.Terrain)), 220));
  put(
    "hazards",
    shorten(
      plain(textOf(geo["Natural hazards"])).replace(/\s*volcanism\s*:\s*/i, "; volcanism: "),
      260,
    ),
  );
  put("heights", heights(geo.Elevation, places));
  const coast = plain(textOf(geo.Coastline));
  put("coast", coast ? numberIn(coast) : null);
  put("borders", borders(geo["Land boundaries"], neighbours));
  put("area", amountIn(plain(textOf(geo.Area, "total ") || textOf(geo.Area, "total"))));
  put("lake", largestLake(geo["Major lakes (area sq km)"], places));
  put("river", longestRiver(textOf(geo["Major rivers (by length in km)"]), places));

  put("resources", shorten(plain(textOf(geo["Natural resources"])), 200));
  put("farm", shorten(plain(textOf(eco["Agricultural products"])), 200));
  put("exports", shorten(plain(textOf(eco["Exports - commodities"])), 200));
  put("industries", shorten(plain(textOf(eco.Industries)), 200));

  put("city", biggestCity(textOf(ppl["Major urban areas - population"]), places));
  const langs = ppl.Languages || {};
  put("languages", shorten(plain(textOf(langs.Languages) || textOf(langs)), 200));
  put("religions", shorten(plain(textOf(ppl.Religions)), 200));
  const median = numberIn(plain(textOf(ppl["Median age"], "total")));
  const life = numberIn(plain(textOf(ppl["Life expectancy at birth"], "total population")));
  if (median !== null || life !== null) put("age", { median, life });

  // "formerly, semi-presidential republic" reads better without the comma.
  const system = plain(textOf(gov["Government type"])).replace(/^formerly,\s*/i, "formerly ");
  put("system", system ? { text: shorten(system, 160), unsettled: UNSETTLED.test(system) } : null);
  put("parliament", parliament(gov));
  put("independence", independence(textOf(gov.Independence)));
  put("regions", regions(textOf(gov["Administrative divisions"]), places));
  put("legal", shorten(plain(textOf(gov["Legal system"])), 200));
  put("suffrage", shorten(plain(textOf(gov.Suffrage)), 140));
  const hol = holiday(textOf(gov["National holiday"]));
  if (hol) places.add(hol.name);
  put("holiday", hol);
  put("military", shorten(plain(textOf(mil["Military service age and obligation"])), 200));
  const orgs = memberships(textOf(gov["International organization participation"]));
  put("memberships", orgs.length ? orgs : null);
  put("colours", plain(textOf(gov["National color(s)"])));

  const sorted = (/** @type {Set<string>} */ s) =>
    [...s].filter((x) => x.length > 1).sort((a, b) => b.length - a.length || a.localeCompare(b));
  return {
    names: {
      country: sorted(country),
      people: sorted(people),
      places: sorted(places),
      neighbours: sorted(neighbours),
    },
    fields: f,
  };
}

/**
 * What a country's people are called, for matching neighbours: the
 * conventional short name and the adjective.
 *
 * @param {any} p one Factbook JSON profile
 * @returns {{name: string, adjective: string} | null}
 */
export function demonym(p) {
  const name = plain(textOf(p.Government?.["Country name"], "conventional short form"));
  const adjective = plain(textOf(p["People and Society"]?.Nationality, "adjective"));
  if (!name || /^none$/i.test(name)) return null;
  return { name, adjective: /^none$/i.test(adjective) ? "" : adjective.split(/[,;]/)[0].trim() };
}
