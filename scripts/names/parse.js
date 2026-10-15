/**
 * Baby names — reading Wikipedia's "List of most popular given names" into
 * one record per country and sex.
 *
 * Pure (no files, no network), so the rules can be unit-tested. The runner is
 * build-data.mjs.
 *
 * The page is a set of wikitables, one per region and sex. Each row is
 * "Country (year, notes)" followed by up to ten names, or by one cell
 * spanning several columns: tied names, or (Egypt) an unranked list.
 * Only whole countries are kept — no "England, United Kingdom", "Paris,
 * France" or community lists (Israel's Jewish list, Māori names).
 *
 * Everything is cleaned before it is written to the repository: wiki markup
 * is stripped, text is capped, and only plain names survive.
 */

/** Lists from before this year are flagged as old. */
export const OLD_BEFORE = 2015;

/** Notes that mark a list of one community, not the whole country. */
const GROUP = /\b(coptic|jewish|muslim|christian|druze|citizens|immigrants|m[āa]ori)/i;

/** Notes that mark a list of everyone alive rather than of newborns. */
const POPULATION = /total population|general population|census|most common|overall|adult voters/i;
/** …unless they say the list is of births after all. */
const BIRTHS = /newborn|babies born|births?\b|born\b|for children/i;

/** Sources that are polls or compilations, not registries. */
const UNOFFICIAL = /unofficial|baby ?center/i;

/**
 * Wiki markup to plain text: references, templates, links, bold, tags,
 * comments and entities removed.
 *
 * @param {string} s
 * @returns {string}
 */
export function plain(s) {
  let t = String(s)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  // Templates can nest; peel them from the inside out.
  for (let i = 0; i < 10 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
  t = t
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1") // [[target|label]] → label
    .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, "$1") // [url label] → label
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;/g, "–");
  return t
    .replace(/[\p{Cc}\p{Cf}]/gu, " ") // controls and invisible formatting
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @typedef {object} Cell
 * @property {string} text plain text
 * @property {number} span how many columns it covers
 * @property {string} raw the wikitext, for its references
 */

/**
 * @typedef {object} RawRow
 * @property {string} region the heading above the table ("Europe")
 * @property {"girls" | "boys"} sex
 * @property {string} label the first cell, as plain text
 * @property {string} labelRaw the first cell's wikitext, for its reference
 * @property {Cell[]} cells the name cells
 */

/**
 * Every data row of every name table on the page.
 *
 * @param {string} wikitext
 * @returns {RawRow[]}
 */
export function tableRows(wikitext) {
  /** @type {RawRow[]} */
  const rows = [];
  let region = "";
  /** @type {"girls" | "boys" | ""} */
  let sex = "";
  let inTable = false;
  /** @type {string[] | null} the raw cells of the row being read */
  let cells = null;

  const flush = () => {
    if (cells && sex && cells.length >= 2) {
      const parsed = cells.map(cellOf);
      const [first, ...rest] = parsed;
      if (first.text)
        rows.push({ region, sex, label: first.text, labelRaw: first.raw, cells: rest });
    }
    cells = null;
  };

  for (const line of wikitext.split("\n")) {
    const heading = /^(=+)\s*(.*?)\s*\1\s*$/.exec(line);
    if (heading && !inTable) {
      const title = plain(heading[2]);
      if (heading[1].length === 3) region = title;
      if (heading[1].length === 4)
        sex = /female|girl/i.test(title) ? "girls" : /male|boy/i.test(title) ? "boys" : "";
      continue;
    }
    if (line.startsWith("{|")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith("|}")) {
      flush();
      inTable = false;
      continue;
    }
    if (line.startsWith("|-")) {
      flush();
      cells = [];
      continue;
    }
    if (line.startsWith("!") || line.startsWith("|+")) continue; // header, caption
    if (!cells) cells = [];
    if (line.startsWith("|")) cells.push(...splitCells(line.slice(1)));
    else if (cells.length) cells[cells.length - 1] += "\n" + line; // a cell that runs on
  }
  flush();
  return rows;
}

/**
 * Split a row line into cells at "||", but not inside [[links]],
 * {{templates}} or <ref>s, which can contain "|" too.
 *
 * @param {string} s
 * @returns {string[]}
 */
function splitCells(s) {
  const out = [];
  let depth = 0;
  let inRef = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("<ref", i)) {
      const close = s.indexOf(">", i);
      if (close > 0 && s[close - 1] !== "/") inRef = true; // <ref …/> closes itself
    }
    if (inRef && s.startsWith("</ref>", i)) inRef = false;
    const two = s.slice(i, i + 2);
    if (two === "[[" || two === "{{") depth++;
    if ((two === "]]" || two === "}}") && depth > 0) depth--;
    if (two === "||" && depth === 0 && !inRef) {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

/**
 * A raw cell: its attributes ("colspan=3|…") and its text.
 *
 * @param {string} raw
 * @returns {Cell}
 */
function cellOf(raw) {
  let body = raw;
  let span = 1;
  // "colspan=3|Emma, Jana" or "style="…" colspan="2"|…", but not "[[a|b]]".
  const attr = /^\s*((?:[a-z-]+\s*=\s*(?:"[^"]*"|[^\s|]+)\s*)+)\|(?!\|)/i.exec(body);
  if (attr) {
    const m = /colspan\s*=\s*"?(\d+)/i.exec(attr[1]);
    if (m) span = Math.min(20, parseInt(m[1], 10));
    body = body.slice(attr[0].length);
  }
  return { text: plain(body.replace(/^\s*\|+/, "")), span, raw: body };
}

/**
 * @typedef {object} Name
 * @property {string} n the name in Latin letters
 * @property {string} [s] the same name in its own script, when the page gives it
 */

/**
 * One name cell: "Aleksandar (Александър)", "Ao あお", "Yìchén (奕辰)" or
 * plain "Emma".
 *
 * @param {string} text
 * @returns {Name | null}
 */
export function nameOf(text) {
  let t = text.trim();
  if (!t || /^n\/?a$/i.test(t) || t.length > 60) return null;
  const wrapped = /^\(([^()]+)\)$/.exec(t); // "(欣怡)": only the native spelling
  if (wrapped) t = wrapped[1].trim();
  const nonLatin = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
  const paren = /^(.+?)\s*\(([^()]+)\)$/.exec(t);
  if (paren && nonLatin.test(paren[2]) && !nonLatin.test(paren[1]))
    return { n: paren[1].trim(), s: paren[2].trim() };
  // "Ao あお": Latin, then the native spelling after a space.
  const split = /^([\p{Script=Latin}\s'’\-.]+?)\s+(\S.*)$/u.exec(t);
  if (split && nonLatin.test(split[2]) && !nonLatin.test(split[1]))
    return { n: split[1].trim(), s: split[2].trim() };
  if (nonLatin.test(t) && !/\p{Script=Latin}/u.test(t)) return { n: "", s: t };
  return { n: t };
}

/**
 * @typedef {object} Entry one place in a list
 * @property {number} rank 1 = most popular
 * @property {Name[]} names more than one when tied
 */

/**
 * @typedef {object} NameList
 * @property {string} label the row as Wikipedia gives it, e.g. "Brazil (census, 2010)"
 * @property {string} note what the brackets say, e.g. "census, 2010"
 * @property {number} year the latest year mentioned, 0 when none
 * @property {string} years the years as written ("2021–2024"), "" when none
 * @property {"births" | "population"} basis newborns, or everyone alive
 * @property {boolean} unofficial a poll or compilation rather than a registry
 * @property {boolean} unranked one list without an order (Egypt)
 * @property {boolean} old from before OLD_BEFORE, or of unknown date
 * @property {Entry[]} entries
 * @property {{url: string, title: string} | null} source what Wikipedia cites for the row
 */

/**
 * The country a row's label is about, and the note in its brackets — or
 * null when the row is a region, city or community, not a whole country.
 *
 * @param {string} label e.g. "Israel, (2025), newborn boys, total population"
 * @param {(name: string) => string} codeOf ISO code for a country name, "" if none
 * @returns {{code: string, note: string} | null}
 */
export function countryOf(label, codeOf) {
  const open = label.indexOf("(");
  const place = (open >= 0 ? label.slice(0, open) : label).replace(/[\s,]+$/, "").trim();
  // Everything after the place name, brackets dropped: "2025), newborn boys…".
  const note = (open >= 0 ? label.slice(open) : "")
    .replace(/[()]/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  if (GROUP.test(note)) return null;
  let code = codeOf(place);
  if (!code && place.includes(",")) {
    // "Faroe Islands, Denmark": a territory of its own, then the country it
    // belongs to. "Paris, France" and "Canada, Quebec" are parts of a country.
    const [first, ...rest] = place.split(",").map((p) => p.trim());
    if (codeOf(first) && codeOf(rest.join(", "))) code = codeOf(first);
  }
  return code ? { code, note } : null;
}

/**
 * Turn a row into a list, or null when it holds no names.
 *
 * @param {string} note
 * @param {Cell[]} cells
 * @param {string} label
 * @returns {NameList | null}
 */
export function listOf(note, cells, label) {
  const yearsFound = [...note.matchAll(/\b(1[89]\d\d|20\d\d)\b/g)].map((m) => parseInt(m[1], 10));
  const year = yearsFound.length ? Math.max(...yearsFound) : 0;
  const range = /\b(1[89]\d\ds?|20\d\ds?)(?:\s*[-–]\s*(\d{2,4}s?))?/.exec(note);
  const years = range ? range[0].replace(/\s*-\s*/, "–") : "";
  const basis = BIRTHS.test(note) || !POPULATION.test(note) ? "births" : "population";

  /** @type {Entry[]} */
  const entries = [];
  let rank = 1;
  let unranked = false;
  for (const c of cells) {
    const parts = c.span > 1 || /,/.test(c.text) ? c.text.split(/\s*,\s*/) : [c.text];
    const names = parts.map(nameOf).filter((x) => x !== null);
    if (c.span >= 6 && names.length > c.span) unranked = true; // one long list, no order
    if (names.length) {
      if (unranked) for (const n of names) entries.push({ rank: 0, names: [n] });
      else entries.push({ rank, names });
    }
    rank += c.span;
  }
  if (!entries.length) return null;
  return {
    label: label.slice(0, 160),
    note: note.slice(0, 120),
    year,
    years,
    basis,
    unofficial: UNOFFICIAL.test(label),
    unranked,
    old: !year || year < OLD_BEFORE,
    entries: entries.slice(0, 30),
    source: null,
  };
}

/**
 * @typedef {{url: string, title: string}} Source
 */

/**
 * A citation's address and title, if it has a usable web address.
 *
 * @param {string} cite the inside of a <ref>…</ref>
 * @returns {Source | null}
 */
function citeOf(cite) {
  const url = (/\burl\s*=\s*(https?:\/\/[^\s|}<>"]{1,300})/i.exec(cite) || [])[1];
  if (!url) return null;
  const title = plain((/\btitle\s*=\s*([^|}]{1,300})/i.exec(cite) || [])[1] || "").slice(0, 160);
  const site = plain(
    (/\b(?:website|publisher|work)\s*=\s*([^|}]{1,120})/i.exec(cite) || [])[1] || "",
  ).slice(0, 80);
  return { url, title: title || site || url.replace(/^https?:\/\/([^/]+).*$/, "$1") };
}

/**
 * Every named reference on the page: <ref name="x">…</ref>, so a later
 * <ref name="x"/> can be resolved.
 *
 * @param {string} wikitext
 * @returns {Map<string, Source>}
 */
export function refIndex(wikitext) {
  /** @type {Map<string, Source>} */
  const index = new Map();
  for (const m of wikitext.matchAll(/<ref\s+name\s*=\s*"?([^">/]+?)"?\s*>([\s\S]*?)<\/ref>/gi)) {
    const src = citeOf(m[2]);
    if (src && !index.has(m[1].trim())) index.set(m[1].trim(), src);
  }
  return index;
}

/**
 * The source a row's label cites: its first reference with a web address.
 *
 * @param {string} raw the label cell's wikitext
 * @param {Map<string, Source>} index from {@link refIndex}
 * @returns {Source | null}
 */
export function sourceOf(raw, index) {
  for (const m of raw.matchAll(/<ref([^>]*?)(\/?)>(?:([\s\S]*?)<\/ref>)?/gi)) {
    const name = (/name\s*=\s*"?([^">/]+?)"?\s*$/i.exec(m[1].trim()) || [])[1];
    const src = m[2] === "/" ? (name ? index.get(name.trim()) : null) : citeOf(m[3] || "");
    if (src) return src;
    if (name && index.has(name.trim())) return /** @type {Source} */ (index.get(name.trim()));
  }
  return null;
}

/**
 * The page's lists by country and sex, the best first: births before
 * whole-population lists, official before unofficial, newest first.
 *
 * @param {string} wikitext
 * @param {(name: string) => string} codeOf
 * @returns {{countries: Record<string, {girls: NameList[], boys: NameList[]}>, dropped: string[]}}
 */
export function namesByCountry(wikitext, codeOf) {
  /** @type {Record<string, {girls: NameList[], boys: NameList[]}>} */
  const countries = {};
  /** @type {string[]} */
  const dropped = [];
  const refs = refIndex(wikitext);
  for (const row of tableRows(wikitext)) {
    const where = countryOf(row.label, codeOf);
    if (!where) {
      dropped.push(`${row.sex}: ${row.label}`);
      continue;
    }
    const list = listOf(where.note, row.cells, row.label);
    if (!list) continue;
    list.source = sourceOf(row.labelRaw, refs);
    (countries[where.code] ||= { girls: [], boys: [] })[row.sex].push(list);
  }
  const score = (/** @type {NameList} */ l) =>
    (l.basis === "births" ? 0 : 2) + (l.unofficial ? 1 : 0) + (l.unranked ? 1 : 0);
  for (const c of Object.values(countries))
    for (const k of /** @type {const} */ (["girls", "boys"]))
      c[k].sort((a, b) => score(a) - score(b) || b.year - a.year);
  return { countries, dropped };
}
