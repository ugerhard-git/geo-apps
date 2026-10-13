/**
 * Cleaning and normalising text that comes from outside the page.
 *
 * Everything an API returns is treated as untrusted: it is reduced to plain
 * text before it is shown or drawn, and is never inserted as markup.
 *
 * @module shared/text
 */

/**
 * Control characters and Unicode bidirectional overrides. These can reorder or
 * hide text when it is displayed, so they are replaced with spaces.
 */
export const BIDI_AND_CONTROL =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u001F\u007F-\u009F‎‏؜‪-‮⁦-⁩]/g;

/**
 * Turn arbitrary input into a single tidy line of plain text.
 *
 * @param {unknown} raw
 * @param {number} [max=120] maximum length in UTF-16 code units
 * @returns {string}
 */
export const cleanText = (raw, max) =>
  String(raw || "")
    .replace(BIDI_AND_CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 120);

/**
 * Normalise a string for searching: lower case, accents removed, and only
 * `a-z`, `0-9` and spaces kept. "Côte d’Ivoire" becomes "cote divoire".
 *
 * @param {unknown} s
 * @returns {string}
 */
export const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

/**
 * {@link norm}, with any leading "the" removed, so that Commons' "the United
 * States" and CLDR's "United States" compare equal.
 *
 * @param {unknown} name
 * @returns {string}
 */
export const bareName = (name) => norm(String(name).replace(/^the\s+/i, ""));

/**
 * Turn a display name into a filename-safe slug: "Côte d’Ivoire" → "c-te-d-ivoire".
 *
 * @param {string} name
 * @returns {string}
 */
export const slugify = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Parse an HTML fragment (for example a Commons metadata field) in a detached
 * document and keep only its text. Nothing in `raw` can become markup here.
 *
 * @param {unknown} raw
 * @param {number} [max=80]
 * @returns {string}
 */
export function htmlToText(raw, max) {
  const s = String(raw || "");
  if (!s) return "";
  try {
    const doc = new DOMParser().parseFromString(s, "text/html");
    // textContent includes the contents of script and style elements, which is
    // harmless but ugly; drop them before reading.
    if (doc.querySelectorAll) doc.querySelectorAll("script,style").forEach((n) => n.remove());
    return cleanText(doc.body ? doc.body.textContent : s, max || 80);
  } catch {
    return cleanText(s.replace(/<[^>]*>/g, " "), max || 80);
  }
}
