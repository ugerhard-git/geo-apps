/**
 * Baby names — reading data/names.json (built monthly from Wikipedia by
 * scripts/names/build-data.mjs) and describing a list honestly.
 *
 * The file is ours, but it is still checked before use: codes, years and
 * flags must have the right shape, names must be short strings, source links
 * must be plain web addresses, and the file is size-capped. Names only ever
 * reach the page as text.
 */

import { own } from "../../shared/util.js";

/** Far above the real file (about 200 KB). */
export const MAX_BYTES = 2_000_000;

/** Lists from before this year are flagged as old (the build uses the same). */
export const OLD_BEFORE = 2015;

/**
 * @typedef {object} Name
 * @property {string} n in Latin letters ("" when the page gives only the native spelling)
 * @property {string} s in the name's own script ("" when not given)
 */

/**
 * @typedef {object} Entry
 * @property {number} rank 1 = most popular; 0 in an unranked list
 * @property {Name[]} names more than one when tied
 */

/**
 * @typedef {object} NameList
 * @property {string} label the row as Wikipedia gives it
 * @property {string} note what its brackets say
 * @property {number} year latest year mentioned, 0 when none
 * @property {string} years as written ("2021–2024")
 * @property {"births" | "population"} basis
 * @property {boolean} unofficial
 * @property {boolean} unranked
 * @property {boolean} old
 * @property {Entry[]} entries
 * @property {{url: string, title: string} | null} source
 */

/**
 * @typedef {object} NamesData
 * @property {{title: string, url: string, revid: number, licence: string}} source
 * @property {Map<string, {girls: NameList[], boys: NameList[]}>} countries
 */

/** @param {unknown} s @param {number} max */
const str = (s, max) => (typeof s === "string" ? s.slice(0, max) : "");

/** @param {any} n @returns {Name | null} */
function nameOf(n) {
  if (!n || typeof n !== "object") return null;
  const name = { n: str(n.n, 60), s: str(n.s, 60) };
  return name.n || name.s ? name : null;
}

/** @param {any} l @returns {NameList | null} */
function listOf(l) {
  if (!l || typeof l !== "object" || !Array.isArray(l.entries)) return null;
  /** @type {Entry[]} */
  const entries = [];
  for (const e of l.entries.slice(0, 30)) {
    if (!e || !Array.isArray(e.names)) continue;
    const names = e.names
      .slice(0, 30)
      .map(nameOf)
      .filter((x) => x !== null);
    const rank = Number.isInteger(e.rank) && e.rank >= 0 && e.rank <= 50 ? e.rank : 0;
    if (names.length) entries.push({ rank, names });
  }
  if (!entries.length) return null;
  const year = Number.isInteger(l.year) && l.year >= 1800 && l.year <= 2100 ? l.year : 0;
  const url = str(l.source && l.source.url, 300);
  return {
    label: str(l.label, 160),
    note: str(l.note, 120),
    year,
    years: str(l.years, 20),
    basis: l.basis === "population" ? "population" : "births",
    unofficial: l.unofficial === true,
    unranked: l.unranked === true,
    old: !year || year < OLD_BEFORE,
    entries,
    source: /^https?:\/\/[^\s"<>]+$/.test(url)
      ? { url, title: str(l.source.title, 160) || url }
      : null,
  };
}

/**
 * Check and convert the parsed file.
 *
 * @param {any} json
 * @returns {NamesData}
 * @throws when the file doesn't have the expected shape
 */
export function parseData(json) {
  if (!json || typeof json !== "object" || !json.countries)
    throw new Error("unexpected names data");
  /** @type {NamesData["countries"]} */
  const countries = new Map();
  for (const cc of Object.keys(json.countries)) {
    const c = own(json.countries, cc);
    if (!/^[A-Z]{2}$/.test(cc) || !c || typeof c !== "object") continue;
    const girls = (Array.isArray(c.girls) ? c.girls : []).slice(0, 6).map(listOf).filter(Boolean);
    const boys = (Array.isArray(c.boys) ? c.boys : []).slice(0, 6).map(listOf).filter(Boolean);
    if (girls.length || boys.length)
      countries.set(cc, {
        girls: /** @type {NameList[]} */ (girls),
        boys: /** @type {NameList[]} */ (boys),
      });
  }
  if (!countries.size) throw new Error("the names data is empty");
  const s = json.source || {};
  return {
    source: {
      title: str(s.title, 120) || "List of most popular given names",
      url: "https://en.wikipedia.org/wiki/List_of_most_popular_given_names",
      revid: Number.isInteger(s.revid) ? s.revid : 0,
      licence: "CC BY-SA 4.0",
    },
    countries,
  };
}

/**
 * Fetch and check the data.
 *
 * @returns {Promise<NamesData>}
 */
export async function loadData() {
  const r = await fetch("data/names.json");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new Error("the names file is too large");
  return parseData(JSON.parse(text));
}

/* ═══════════════════════════════════════════════════════════
   Describing a list
   ═══════════════════════════════════════════════════════════ */

/**
 * What a list is, briefly: "2025 · newborns" or "2010 census · whole
 * population · unofficial".
 *
 * @param {NameList} l
 */
export function basisText(l) {
  const when = l.years || (l.year ? String(l.year) : "year not given");
  const parts = [when, l.basis === "births" ? "newborns" : "whole population"];
  if (l.unofficial) parts.push("unofficial");
  if (l.unranked) parts.push("unranked");
  return parts.join(" · ");
}

/**
 * Why a list deserves a warning, or "" when it doesn't: old, undated, or not
 * about newborns at all.
 *
 * @param {NameList} l
 */
export function warningOf(l) {
  const w = [];
  if (!l.year) w.push("undated");
  else if (l.year < OLD_BEFORE) w.push(`from ${l.year}`);
  if (l.basis === "population") w.push("names of the whole population, not of newborns");
  return w.join("; ");
}

/**
 * A short label for a list in a dropdown.
 *
 * @param {NameList} l
 */
export function optionLabel(l) {
  const extra = l.note
    .replace(/\b(1[89]\d\d|20\d\d)s?\b/g, "")
    .replace(/[,;\s]+/g, " ")
    .trim();
  return `${basisText(l)}${extra && !/^(unofficial|baby ?center)$/i.test(extra) ? " — " + extra : ""}`;
}

/**
 * A name as shown: Latin, native, or both.
 *
 * @param {Name} n
 * @param {"latin" | "native" | "both"} script
 */
export function shown(n, script) {
  if (script === "native" && n.s) return n.s;
  if (script === "both" && n.s && n.n) return `${n.n} · ${n.s}`;
  return n.n || n.s;
}

/**
 * The entries to show: the first `count` places (ties stay whole).
 *
 * @param {NameList} l
 * @param {number} count
 * @returns {Entry[]}
 */
export function topEntries(l, count) {
  if (l.unranked) return l.entries.slice(0, count);
  return l.entries.filter((e) => e.rank >= 1 && e.rank <= count);
}

/**
 * The lists as plain text, to paste anywhere: what they are, where they come
 * from, then one numbered name per line.
 *
 * @param {string} country
 * @param {Array<{title: string, list: NameList | null}>} columns
 * @param {NamesData["source"]} source
 * @param {number} count
 */
export function plainText(country, columns, source, count) {
  const lines = [`Most popular baby names — ${country}`, ""];
  for (const { title, list } of columns) {
    if (!list) continue;
    lines.push(`${title} (${basisText(list)})`);
    const warning = warningOf(list);
    if (warning) lines.push(`Note: ${warning}.`);
    for (const e of topEntries(list, count)) {
      const names = e.names.map((n) => (n.n && n.s ? `${n.n} (${n.s})` : n.n || n.s)).join(", ");
      lines.push(
        list.unranked ? `- ${names}` : `${e.rank}. ${names}${e.names.length > 1 ? " (tied)" : ""}`,
      );
    }
    if (list.source) lines.push(`Source: ${list.source.title} — ${list.source.url}`);
    else lines.push("Source: none cited on Wikipedia");
    lines.push("");
  }
  lines.push(
    `From Wikipedia, "${source.title}"${source.revid ? ` (revision ${source.revid})` : ""}, ${source.licence}: ${source.url}`,
  );
  return lines.join("\n");
}
