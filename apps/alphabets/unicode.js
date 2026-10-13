/**
 * Alphabets — reading CLDR character sets, detecting scripts and case pairs.
 *
 * Pure functions, with unit tests in tests/unit/alphabets.test.js.
 */

import { MAX_SET, SCRIPT_RANGES } from "./config.js";

/**
 * The script a string is written in, from its first letter that falls in a
 * known range.
 *
 * @param {string} str
 * @returns {string} e.g. "Cyrillic"; "Latin" when nothing matches
 */
export function scriptOf(str) {
  for (const ch of str) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x41) continue; // skip marks, digits, spacing
    for (const [name, ranges] of SCRIPT_RANGES) {
      for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return name;
    }
  }
  return "Latin";
}

/**
 * Read one character (or escape sequence) of a UnicodeSet.
 *
 * @param {string} s
 * @param {number} i
 * @returns {{ch: string, next: number}}
 */
function readAtom(s, i) {
  if (s[i] === "\\") {
    const n = s[i + 1];
    if (n === "u" && /^[0-9a-f]{4}$/i.test(s.slice(i + 2, i + 6)))
      return { ch: String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)), next: i + 6 };
    if (n === "U" && /^[0-9a-f]{8}$/i.test(s.slice(i + 2, i + 10)))
      return { ch: String.fromCodePoint(parseInt(s.slice(i + 2, i + 10), 16)), next: i + 10 };
    return { ch: n === undefined ? "\\" : n, next: i + 2 };
  }
  const cp = /** @type {number} */ (s.codePointAt(i));
  const ch = String.fromCodePoint(cp);
  return { ch, next: i + ch.length };
}

/**
 * Parse a CLDR exemplar set.
 *
 * CLDR writes exemplar sets as "[a á b c-f {ch} \\-]": space separated, with
 * ranges, brace-wrapped multi-character sequences, backslash escapes and
 * \uXXXX literals. Getting this wrong silently drops or invents letters, so
 * it is parsed explicitly rather than by regex.
 *
 * @param {unknown} raw
 * @returns {string[]} the letters, in order, without duplicates
 * @throws on an unterminated `{…}` group
 */
export function parseUnicodeSet(raw) {
  let s = String(raw || "").trim();
  if (s.startsWith("[")) s = s.slice(1);
  if (s.endsWith("]")) s = s.slice(0, -1);
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  /** @param {string} v */
  const push = (v) => {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (out.length >= MAX_SET) break;
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "{") {
      // A multi-character letter.
      const end = s.indexOf("}", i);
      // An unterminated group would otherwise be read as separate letters,
      // inventing entries that aren't in the data. Refuse instead.
      if (end === -1) throw new Error("malformed character set: unterminated group");
      const inner = s.slice(i + 1, end);
      let built = "";
      let j = 0;
      while (j < inner.length) {
        const a = readAtom(inner, j);
        built += a.ch;
        j = a.next;
      }
      push(built);
      i = end + 1;
      continue;
    }
    const first = readAtom(s, i);
    i = first.next;
    if (s[i] === "-" && i + 1 < s.length && s[i + 1] !== " ") {
      // A range.
      const last = readAtom(s, i + 1);
      i = last.next;
      const a = /** @type {number} */ (first.ch.codePointAt(0));
      const b = /** @type {number} */ (last.ch.codePointAt(0));
      if (b >= a) {
        // CJK sets are written as single huge ranges, so expand them, but stop
        // at a ceiling rather than building a set of tens of thousands.
        for (let cp = a; cp <= b && out.length < MAX_SET; cp++) push(String.fromCodePoint(cp));
      } else {
        push(first.ch);
        push(last.ch);
      }
      continue;
    }
    push(first.ch);
  }
  return out;
}

/**
 * @typedef {object} CasePair
 * @property {string} lower
 * @property {string | null} upper `null` when the letter has no single-character capital
 */

/**
 * A letter and its capital.
 *
 * Whether a letter has a distinct capital is decided per character rather
 * than per script, because the exceptions matter: German ß has no
 * single-character capital, and Turkish i must become İ, not I.
 *
 * @param {string} letter
 * @param {string} locale
 * @returns {CasePair}
 */
export function casePair(letter, locale) {
  let upper;
  try {
    upper = letter.toLocaleUpperCase(locale);
  } catch {
    upper = letter.toUpperCase();
  }
  if (upper === letter) return { lower: letter, upper: null };
  if ([...upper].length > [...letter].length) return { lower: letter, upper: null }; // ß → SS
  return { lower: letter, upper };
}
