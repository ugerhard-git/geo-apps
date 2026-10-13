/**
 * OWID chart plotter — turning an Our World in Data CSV into a dataset, and
 * the small formatting helpers around it.
 *
 * Pure functions, with unit tests in tests/unit/owid-chart-plotter.test.js.
 */

import { parseCsv } from "../../shared/net.js";

/**
 * @typedef {object} Dataset
 * @property {string} label indicator name without its unit
 * @property {string} unit e.g. "years", "% of GDP"; "" when none was found
 * @property {string} fullLabel the column header, minus OWID's dimension suffixes
 * @property {Map<string, Map<number, number>>} byEntity entity → year → value
 * @property {number[]} years every year with a value, ascending
 * @property {string[]} entities alphabetical
 * @property {string} source where the CSV came from, for the chart's footer
 * @property {string[]} columns all CSV headers
 * @property {number} valCol index of the charted column
 * @property {string} valColName
 * @property {string[]} numericChoices headers of every numeric column
 * @property {string[]} otherNumeric numeric columns that aren't charted
 */

/**
 * Parse CSV, dropping a byte-order mark and blank lines.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  return parseCsv(text.replace(/^\uFEFF/, "")).filter((r) => r.length > 1 || (r[0] || "").trim() !== "");
}

const UNIT_WORDS =
  /^(years?|months?|days?|hours?|minutes?|percent|people|persons?|tonnes?|tons?|kg|kilograms?|grams?|litres?|liters?|kwh|mwh|twh|gwh|kcal|calories|deaths|births|cases|dollars?|usd|eur|hectares?)$/i;

/**
 * Whether a header's trailing parenthetical reads like a unit.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeUnit(s) {
  const t = (s || "").trim();
  if (!t) return false;
  if (t.includes("%")) return true; // "%", "% of GDP", "annual %"
  if (/\bper\b/i.test(t)) return true; // "per 1,000 people", "tonnes per hectare"
  return UNIT_WORDS.test(t);
}

/**
 * Turn CSV text into a dataset. Throws, with a readable message, on anything
 * unusable.
 *
 * The app and the preset checker both call this, so the check exercises
 * exactly the parsing the app uses.
 *
 * @param {string} text
 * @param {string} sourceLabel
 * @param {string} [preferCol] which value column to chart, by (part of) its name
 * @returns {Dataset}
 */
export function buildData(text, sourceLabel, preferCol) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("That CSV has no data rows.");
  const head = rows[0].map((h) => h.trim());
  const iE = head.findIndex((h) => /^entity$/i.test(h));
  const iY = head.findIndex((h) => /^year$|^date$/i.test(h));
  const entityCol = iE >= 0 ? iE : 0;
  const yearCol = iY >= 0 ? iY : 2;

  // Value columns: those that actually hold numbers. Some grapher exports
  // append a text column (e.g. "World region according to OWID"), so the last
  // column is not reliably the value column.
  const numericCols = [];
  for (let c = 0; c < head.length; c++) {
    if (c === entityCol || c === yearCol) continue;
    if (/^code$/i.test(head[c])) continue;
    let filled = 0;
    let numeric = 0;
    for (let r = 1; r < rows.length; r++) {
      const raw = (rows[r][c] || "").trim();
      if (raw === "") continue;
      filled++;
      if (Number.isFinite(Number(raw))) numeric++;
    }
    if (filled && numeric / filled >= 0.9) numericCols.push(c);
  }
  if (!numericCols.length) {
    throw new Error(
      "No numeric value column found in that CSV. Columns: " +
        head.filter((h, c) => c !== entityCol && c !== yearCol && !/^code$/i.test(h)).join(", ") +
        ".",
    );
  }

  // Default to the FIRST numeric column: OWID puts the chart's primary
  // indicator directly after Year, and anything further right is a secondary
  // dimension (a second indicator on scatter charts, "Population (historical)",
  // a region name). A caller can override that by name — exact match first,
  // then case-insensitive, then substring — which is how a multi-metric chart
  // picks out one series.
  let valCol = numericCols[0];
  if (preferCol) {
    const want = String(preferCol).trim();
    const lower = want.toLowerCase();
    const found =
      numericCols.find((c) => head[c] === want) ??
      numericCols.find((c) => head[c].toLowerCase() === lower) ??
      numericCols.find((c) => head[c].toLowerCase().includes(lower));
    if (found !== undefined) valCol = found;
  }

  /** @type {Map<string, Map<number, number>>} */
  const byEntity = new Map();
  /** @type {Set<number>} */
  const yearSet = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[entityCol] || "").trim();
    const year = parseInt(row[yearCol], 10);
    const raw = (row[valCol] || "").trim();
    if (!name || !Number.isFinite(year) || raw === "") continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    let m = byEntity.get(name);
    if (!m) byEntity.set(name, (m = new Map()));
    m.set(year, v);
    yearSet.add(year);
  }
  if (!byEntity.size) throw new Error("No numeric values found in that CSV.");

  // OWID appends dimension suffixes such as " - Sex: both sexes - Age group:
  // 18+ years". Cut them off so the title and unit come out readable.
  const header = head[valCol].split(/\s+-\s+(?=[^-]*:)/)[0].trim();
  // A trailing parenthetical is often a unit — "(years)", "(% of GDP)" — but
  // just as often a qualifier: "(selected)", "(age-standardized)", "($3 a day)".
  // Only strip it into the unit when it reads like one.
  const unitM = header.match(/\(([^)]+)\)\s*$/);
  const unit = unitM && looksLikeUnit(unitM[1]) ? unitM[1].trim() : "";
  const label = (unit ? header.replace(/\s*\([^)]*\)\s*$/, "") : header).trim() || "Value";
  return {
    label,
    unit,
    fullLabel: header,
    byEntity,
    years: [...yearSet].sort((a, b) => a - b),
    entities: [...byEntity.keys()].sort((a, b) => a.localeCompare(b)),
    source: sourceLabel,
    columns: head,
    valCol,
    valColName: head[valCol],
    numericChoices: numericCols.map((c) => head[c]),
    otherNumeric: numericCols.filter((c) => c !== valCol).map((c) => head[c]),
  };
}

/**
 * One entity's values between two years, in year order.
 *
 * @param {Dataset} data
 * @param {string} entity
 * @param {number} from
 * @param {number} to
 * @returns {Array<{y: number, v: number}>}
 */
export function series(data, entity, from, to) {
  const m = data.byEntity.get(entity);
  if (!m) return [];
  return [...m.entries()]
    .filter(([y]) => y >= from && y <= to)
    .sort((x, y) => x[0] - y[0])
    .map(([y, v]) => ({ y, v }));
}

/**
 * An entity's value in a year, or else its most recent earlier value.
 *
 * @param {Dataset} data
 * @param {string} entity
 * @param {number} year
 * @returns {number | null}
 */
export function valueAt(data, entity, year) {
  const m = data.byEntity.get(entity);
  if (!m) return null;
  const exact = m.get(year);
  if (exact !== undefined) return exact;
  let best = null;
  let bd = Infinity;
  for (const [y, v] of m) {
    const d = Math.abs(y - year);
    if (d < bd && y <= year) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/**
 * Compact number: 1.23B, 4.56M, 12,345, 123, 1.23, 0.0123.
 *
 * @param {number} v
 * @returns {string}
 */
export function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return Math.round(v).toLocaleString("en-US");
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

/**
 * Quote a CSV cell. Spreadsheets treat a cell beginning with = + - @ (or a
 * control character) as a formula and may run it on open; entity names and
 * headers come from the loaded CSV, so a hostile file could smuggle one
 * through the export. Those get an apostrophe in front.
 *
 * @param {unknown} v
 * @returns {string}
 */
export function csvCell(v) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * A dataset reference reduced to something safe in a filename: no query or
 * #Column, a safe character set, and no leading or trailing dots or dashes
 * (so nothing like ".." or "-rf" survives).
 *
 * @param {unknown} v
 * @returns {string}
 */
export function safeName(v) {
  const s = String(v || "")
    .split("?")[0]
    .split("#")[0]
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return s || "owid";
}
