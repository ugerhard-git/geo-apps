/**
 * Fetching data, and the external sources several apps share.
 * @module shared/net
 */

/** jsDelivr's npm mirror, which serves the CLDR and Natural Earth packages. */
export const NPM_CDN = "https://cdn.jsdelivr.net/npm";

/**
 * The datasets/country-codes table: ISO 3166 alpha-2, alpha-3 and numeric
 * codes, FIPS codes and UN regions for every country, as CSV.
 */
export const URL_COUNTRY_CODES =
  "https://cdn.jsdelivr.net/gh/datasets/country-codes@main/data/country-codes.csv";

/** The Wikidata SPARQL endpoint. */
export const WDQS = "https://query.wikidata.org/sparql";

/**
 * Fetch a URL and parse it as JSON. A non-2xx response throws an `Error`
 * whose message is `"HTTP <status>"` and whose `status` property is set.
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
export async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw httpError(r.status);
  return r.json();
}

/**
 * An `Error` describing a failed HTTP response.
 *
 * @param {number} status
 * @returns {Error & { status: number }}
 */
export function httpError(status) {
  const e = /** @type {Error & { status: number }} */ (new Error("HTTP " + status));
  e.status = status;
  return e;
}

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF).
 *
 * @param {string} text
 * @returns {string[][]} rows of fields
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
