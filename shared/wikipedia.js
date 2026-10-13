/**
 * Reading facts from an English Wikipedia article's infobox.
 *
 * Values are kept exactly as the article has them; nothing is normalised into
 * a tidier form that could misrepresent what the article says. Nothing from
 * the API response is ever inserted into the page as markup.
 *
 * @module shared/wikipedia
 */

import { mediawiki } from "./commons.js";
import { cleanText } from "./text.js";

export const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

/**
 * Call the English Wikipedia API.
 *
 * @param {Record<string, string>} params
 * @returns {Promise<any>}
 */
export const wikipedia = (params) => mediawiki(params, WIKIPEDIA_API);

/** Footnote markers such as `[3]` or `[citation needed]`. */
const REF_MARK = /\[\s*(\d+|citation needed|clarification needed|note \d+)\s*\]/gi;

/** A control character, so a real middle dot in the data is never touched. */
const MARK = "\u001f";

/** Elements that end a line in an infobox cell. */
const BLOCKISH = new Set([
  "DIV",
  "P",
  "LI",
  "TR",
  "UL",
  "OL",
  "DD",
  "DT",
  "SECTION",
  "TABLE",
  "TBODY",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/**
 * The text of a node with line structure preserved.
 *
 * `textContent` runs adjacent elements together, so "520 mm × 110 mm" and
 * "20.5 in × 4.3 in" arrive as one unreadable string. Walk the node instead,
 * separating block elements and line breaks with {@link MARK}, and keeping a
 * space between adjacent inline elements that would otherwise collide.
 *
 * @param {Node | null} node
 * @returns {string}
 */
export function richText(node) {
  let out = "";
  const kids = node && node.childNodes ? Array.from(node.childNodes) : [];
  for (const child of kids) {
    if (child.nodeType === 3) {
      out += child.nodeValue || "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = String(/** @type {Element} */ (child).tagName || "").toUpperCase();
    if (tag === "BR") {
      out += MARK;
      continue;
    }
    const inner = richText(child);
    if (!inner.trim()) continue;
    if (BLOCKISH.has(tag)) {
      out += MARK + inner + MARK;
    } else {
      if (out && !/\s$/.test(out) && !/^\s/.test(inner)) out += " ";
      out += inner;
    }
  }
  return out;
}

/**
 * Collapse the markers {@link richText} leaves behind into " · " separators
 * and drop footnote markers.
 *
 * @param {string} raw
 * @param {number} max
 * @returns {string}
 */
export function tidy(raw, max) {
  let t = String(raw || "").replace(REF_MARK, " ");
  // eslint-disable-next-line no-control-regex -- MARK is a control character on purpose
  t = t.replace(/[\s\u001f]*\u001f[\s\u001f]*/g, MARK); // runs become one
  // eslint-disable-next-line no-control-regex
  t = t.replace(/^\u001f+|\u001f+$/g, ""); // none at the ends
  // eslint-disable-next-line no-control-regex
  t = t.replace(/\u001f/g, " · ");
  return cleanText(t, max);
}

/**
 * @typedef {object} InfoboxRow
 * @property {string} label as the article shows it, e.g. "Front plate"
 * @property {string} value as the article shows it
 * @property {string} key the label in lower case, for lookups
 */

/**
 * @typedef {object} Infobox
 * @property {string} title the article's title after redirects
 * @property {string} url link to the article
 * @property {InfoboxRow[]} rows label/value pairs, first occurrence of each label
 * @property {Element} table the parsed infobox, for app-specific extras
 */

/**
 * Fetch an article's lead section and read its infobox.
 *
 * @param {string} title
 * @returns {Promise<Infobox | null>} `null` when the article has no infobox
 */
export async function fetchInfobox(title) {
  const data = await wikipedia({
    action: "parse",
    page: title,
    prop: "text",
    section: "0",
    redirects: "1",
    disablelimitreport: "1",
  });
  const html = data && data.parse && typeof data.parse.text === "string" ? data.parse.text : "";
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.querySelectorAll)
    doc.querySelectorAll("script,style,sup.reference").forEach((n) => n.remove());
  const table = doc.querySelector("table.infobox");
  if (!table) return null;

  /** @type {InfoboxRow[]} */
  const rows = [];
  const seen = new Set();
  for (const tr of table.querySelectorAll("tr")) {
    const th = tr.querySelector("th");
    const td = tr.querySelector("td");
    if (!th || !td) continue;
    const label = tidy(richText(th) || th.textContent || "", 42);
    const value = tidy(richText(td) || td.textContent || "", 160);
    if (!label || !value) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ label, value, key });
  }
  const finalTitle = cleanText(data.parse.title || title, 120);
  return {
    title: finalTitle,
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(finalTitle.replace(/ /g, "_")),
    rows,
    table,
  };
}

/** Article titles must be plain: no wiki syntax, no line breaks. */
export const TITLE_OK = /^[^\n\r|#<>[\]{}]{3,120}$/;

/**
 * The first of `candidates` that exists on Wikipedia (following redirects),
 * keeping the candidates' order rather than the API's.
 *
 * @param {string[]} candidates
 * @returns {Promise<string | null>}
 */
export async function firstExistingArticle(candidates) {
  if (!candidates.length) return null;
  const data = await wikipedia({ action: "query", titles: candidates.join("|"), redirects: "1" });
  const pages = (data && data.query && data.query.pages) || [];
  const live = pages.filter(
    (/** @type {any} */ pg) => pg && !pg.missing && typeof pg.title === "string",
  );
  if (!live.length) return null;
  for (const c of candidates) {
    const hit = live.find((/** @type {any} */ pg) => pg.title === c) || null;
    if (hit) return hit.title;
  }
  return live[0].title;
}
