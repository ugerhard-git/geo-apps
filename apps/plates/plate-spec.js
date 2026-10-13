/**
 * Licence plates — plate requirements, from the English Wikipedia infobox.
 *
 * Values are shown exactly as the article has them. Coverage is uneven —
 * China states front and rear plainly, Germany omits them, and Italy puts
 * dimensions in the field — so nothing here is normalised into a tidy yes/no
 * that would misrepresent all three.
 */

import { TITLE_OK, fetchInfobox, firstExistingArticle, wikipedia } from "../../shared/wikipedia.js";

/**
 * @typedef {object} PlateSpec
 * @property {string} title
 * @property {string} url
 * @property {import("../../shared/wikipedia.js").InfoboxRow[]} rows
 */

/**
 * @param {{official?: string, name: string}} country
 * @returns {string[]}
 */
function articleCandidates(country) {
  const names = [country.official, country.name].filter(Boolean);
  const out = [];
  for (const n of /** @type {string[]} */ (names)) {
    const bare = n.replace(/^the\s+/i, "");
    out.push(`Vehicle registration plates of ${n}`);
    out.push(`Vehicle registration plates of the ${bare}`);
    out.push(`Vehicle registration plates of ${bare}`);
  }
  return [...new Set(out)].filter((t) => TITLE_OK.test(t)).slice(0, 8);
}

/**
 * The country's "Vehicle registration plates of …" article: the first
 * candidate title that exists, else a title search, else nothing.
 *
 * @param {{official?: string, name: string}} country
 * @returns {Promise<string | null>}
 */
async function findArticle(country) {
  const hit = await firstExistingArticle(articleCandidates(country));
  if (hit) return hit;
  const q = (country.official || country.name || "").replace(/^the\s+/i, "");
  if (!q) return null;
  const found = await wikipedia({
    action: "query",
    list: "search",
    srnamespace: "0",
    srlimit: "5",
    srsearch: `intitle:"Vehicle registration plates of" ${q}`,
  });
  const rows = (found && found.query && found.query.search) || [];
  const first = rows.find(
    (/** @type {any} */ r) =>
      r && typeof r.title === "string" && /^Vehicle registration plates of /i.test(r.title),
  );
  return first ? first.title : null;
}

/**
 * The plate requirements for a country, or `null` when no article or infobox
 * was found.
 *
 * @param {{official?: string, name: string}} country
 * @returns {Promise<PlateSpec | null>}
 */
export async function loadPlateSpec(country) {
  const article = await findArticle(country);
  if (!article) return null;
  const box = await fetchInfobox(article);
  return box && box.rows.length ? { title: box.title, url: box.url, rows: box.rows } : null;
}
